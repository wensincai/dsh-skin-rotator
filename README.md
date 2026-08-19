# dsh-skin-rotator

[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

DSH Web 的动态背景皮肤：把本地 `images/` 目录里的图片，**每 5 分钟自动轮播**一张作为全屏背景（叠加半透明黑色蒙版保证文字可读）。换图 = 复制文件进目录，无需重启。

> ⚠️ 本仓库**不含任何背景图**：图片是你的运行时数据，部署后把图片复制进 `images/` 即可（见 [images/README.md](images/README.md)）。

本 README 除了使用说明，还完整解释了两件事（都以真实源码为依据）：

1. **DSH 皮肤是怎么做出来的**（皮肤制作原理）
2. **皮肤市场插件 `dsh-skin-market` 是怎么运作的**（市场原理）

---

## 一、快速使用

### 安装（任意一种）

```powershell
# 从 GitHub 安装（源码模式用 pnpm dsh）
dsh plugin --profile web add 'github:wensincai/dsh-skin-rotator'
# 或本地 checkout
dsh plugin --profile web add 'link:E:\dsh\plugins\dsh-skin-rotator'
```

重启 DSH Web 后生效。然后：

```powershell
# 1. 把图片复制进 images/ 目录（支持 jpg/jpeg/png/webp/gif/avif）
# 2. 背景每 5 分钟轮播一张，并叠加 35% 黑色蒙版；新图下一轮自动出现，无需重启
```

可选环境变量（启动 client 前设置）：

| 变量 | 作用 | 默认 |
|---|---|---|
| `DSH_SKIN_IMAGES_DIR` | 换图片目录（绝对路径） | 本包 `images/` |
| `DSH_SKIN_ROTATE_MS` | 轮播间隔（毫秒） | `300000`（5 分钟） |
| `DSH_SKIN_OVERLAY_OPACITY` | 黑色蒙版透明度（0 = 不加，1 = 全黑） | `0.35` |

详细用法见 [`images/README.md`](images/README.md)。

本包结构：

```
dsh-skin-rotator/
├── package.json        # dsh.bundle + dsh.client 声明
├── cordis.patch.yml    # 唯一职责：把 skin-rotator 行插入 loader
├── lib/
│   ├── index.js        # host 半：把 images/ 目录暴露为 HTTP 路由
│   └── client.js       # client 半：拉清单、设背景+蒙版、5 分钟轮播
└── images/             # ★ 你的图片目录（改图只动这里）
```

---

## 二、皮肤制作原理

### 2.1 皮肤的本质：覆盖 CSS 令牌

DSH Web UI 的全部外观由 **CSS 自定义属性（令牌）** 驱动，主要是两类：

- `--dsw-alias-*` —— 皮肤兼容层令牌（皮肤系统覆盖的对象）
- `--ds-*` —— 基础令牌

一个"皮肤"就是**往页面注入一段覆盖这些令牌的 CSS/JS**。例如本包 `lib/client.js` 做的事情就是：

```js
document.body.style.backgroundImage = `url("...")`   // 覆盖背景
document.body.style.backgroundSize = 'cover'
```

参考已收录皮肤（如 Glass Theme）的写法：

```css
:root { --dsw-mask-blur: blur(18px) saturate(160%); }        /* 覆盖 DSH 令牌 */
body[data-ds-dark-theme] { background-image: ...; }          /* 暗色模式单独处理 */
```

> 令牌清单以 DSH 的 `dsh-client-ui-theme` / `dsh-theme` 相关包为准；最快的学习方式是装一个现成皮肤，在 DevTools 里看它覆盖了哪些变量。

### 2.2 皮肤 = 一个带 `dsh.client` 声明的插件

皮肤在 DSH 里就是一个插件包，关键在 `package.json` 的两个声明：

```jsonc
{
  "name": "dsh-skin-rotator",
  "main": "lib/index.js",                  // host 半入口（Node）
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js"          // ★ client 半入口（浏览器）
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // ① 带 bundle：loader 行自己声明
    "client": { "platform": "web", "inject": [] }  // ② 纯前端皮肤只需 client 声明
  }
}
```

DSH 的 `client-modules` 扫描器（`packages/client/modules`）会：

1. 扫描 Loader 条目中声明了 `dsh.client` 的包；
2. 通过 `exports["./client"]` 找到浏览器端 bundle；
3. 在 `/plugins/<包名>/client.js` 下发，并把条目组装进 `window.__DSH_BOOT__`。

### 2.3 client bundle 的硬性格式（必须遵守）

浏览器侧加载的 bundle 必须调用 `window.__ModuleLoader__.load`，且 factory 返回插件模块导出：

```js
window.__ModuleLoader__.load({
  id: 'dsh-skin-rotator',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const name = 'dsh-skin-rotator'
    const inject = []            // 需要哪些 client 服务就列哪些（如 'slots'）
    function apply(ctx) {        // 挂载时执行；可返回清理函数 / 用 ctx.effect
      /* 皮肤本体 */
    }
    module.exports = { name, inject, apply }
    return module.exports
  },
})
```

### 2.4 两种皮肤形态（决定要不要 cordis.patch.yml）

| 形态 | 声明 | loader 行来源 | 直接 `dsh plugin add` 后 |
|---|---|---|---|
| **完整插件** | `dsh.bundle` + `dsh.client` | 自己 `cordis.patch.yml` 的 insert（如本包、Glass Theme） | 立即可用 |
| **纯前端** | 只有 `dsh.client` | 由**皮肤市场**安装时自动写入 `rowId` | 没有 loader 行，需市场注册才生效 |

`cordis.patch.yml` 唯一职责是插入 loader 行：

```yaml
- insert:
    - id: skin-rotator
      name: dsh-skin-rotator
```

### 2.5 皮肤切换 = 启停 loader 条目

皮肤市场 client 侧切换皮肤的本质（`dsh-skin-market/src/client/index.ts`）：

```js
async setActive(packageName, active) {
  const entry = [...loader.entries()].find(e => e.options.name === packageName)
  await entry.update({ disabled: active ? null : true }, ...)  // 启用=null，停用=true
}
```

换肤 = 把目标皮肤的 loader 条目设为启用、其它皮肤设为禁用，皮肤互斥。

### 2.6 动态皮肤的关键：host 半代读本地文件

**浏览器无法读本地文件系统**，所以"读 `images/` 目录"必须由 host 半（Node 进程）完成：

- host 半通过 `webServer.register({ kind, path, handler })` 挂路由，把目录暴露成 HTTP；
- client 半用 `fetch(location.origin + ...)` 拉取——同源、无需额外端口/鉴权。

本包 host 半注册的两个路由：

```
GET /skin-rotator/images          → { images: [...], rotateMs: 300000, overlay: 0.35 }
GET /skin-rotator/files/<名字>     → 图片文件本身（带 MIME、路径穿越防护）
```

每次请求实时读盘，所以**复制新图进去，下一轮轮播（≤5 分钟）自动出现**，无需重启。

背景图片上方会叠加一层可配置的半透明黑（`DSH_SKIN_OVERLAY_OPACITY`，默认 0.35）——用 `linear-gradient(rgba(0,0,0,α), rgba(0,0,0,α)), url(...)` 直接压暗图片本身，不需要额外 DOM 元素，前景文字因此更清晰。

---

## 三、皮肤市场插件 `dsh-skin-market` 的原理

市场插件（`E:\dsh\plugins\dsh-skin-market`，v0.1.24）本质是一个**"皮肤包生命周期管理器"**：浏览目录、安装、启用/停用、更新、卸载社区皮肤。它自己也是一个双半插件。

### 3.1 目录（catalog）是怎么来的

```
registry/skins/<作者>__<皮肤名>.yml   ← 社区 PR 提交的"唯一事实来源"（每个皮肤一个 YAML）
        │  scripts/build-registry.mjs（校验 + 生成）
        ▼
data/catalog.json                    ← 生成产物（不入 PR，合并后自动重建）
        │
        ├─ 插件内置一份（离线兜底）
        ├─ Host 从 GitHub Pages 拉最新版（打开时 / 每 5 分钟 / 窗口聚焦时）
        └─ 浏览器 IndexedDB 缓存一份（先展示缓存，后台校验在线）
```

一个皮肤条目（`registry/skins/*.yml`）的关键字段，见 `registry/skin.schema.json`：

| 字段 | 含义 |
|---|---|
| `id` / `name`(zh/en) / `author` / `description` | 展示信息 |
| `package` / `rowId` | 安装的 npm 包名 / loader 行 id |
| `install.target` | `github:owner/repo#<40位commit>` —— **固定 commit，禁止 main/HEAD** |
| `compatibility` / `modes` | 兼容的 dsh 版本 / light-dark 模式 |
| `screenshots` / `license` / `featuredRank` / `starsSnapshot` | 预览、授权、排序 |

### 3.2 双半架构

- **host 半**（`src/index.ts` → `mountRoutes`）：注入 `webServer/loader/agents`，挂 REST 路由：
  - `GET /dsh-skin-market/catalog`（目录）、`GET /dsh-skin-market/state`（安装状态）
  - `POST /dsh-skin-market/{install|activate|deactivate|update|uninstall|restart}`（操作）
  - 执行操作时调用 DSH 的 profile 插件管理器（pnpm / `dsh plugin add`）真正装包
- **client 半**（`src/client/index.ts`）：注入 `slots/locale/loader`，在 DSH **设置页注册「皮肤市场」分区**（`settings.section` slot），渲染 React UI（搜索/排序/详情/一键操作）。

### 3.3 安装/卸载 = 改 profile 文件（`src/profile.ts`）

| 情况 | 动作 |
|---|---|
| 完整插件（带 `dsh.bundle`） | pnpm 装 `github:...#commit` → `ensureSkinRegistration` 只加 profile 层 override（行 id=rowId），loader 行由皮肤自己的补丁声明 |
| 纯前端皮肤（只有 `dsh.client`） | `ensureSkinRegistration` 直接在 profile 的 `cordis.patch.yml` **insert** `{ id: rowId, name: package }`（幂等）；卸载时 `removeSkinRegistration` 移除 |
| 需要构建的包 | `ensureBuildAllowed` 自动把包名写进 `pnpm-workspace.yaml` 的 `allowBuilds`（对应 FAQ 里手动改的那个操作） |

配套的安全与可靠性机制：

- 操作前**快照 profile manifest/patch**，失败自动恢复（半安装状态清理）；
- 操作端点要求 **same-origin**，且只接受目录里的 `skinId`（浏览器不能提交任意命令/地址）；
- 有 Agent 在跑时**拒绝重启类操作**（`waitForRestartSafety`）；
- `dsh-skin-market-reset --profile web` 一键停用全部皮肤、恢复默认外观。

### 3.4 在线市场网站

- `site/`（React + Vite）读取同一份 catalog 生成**纯静态浏览站**，`.github/workflows/pages.yml` 自动部署到 GitHub Pages；
- **只能浏览，不能安装**——安装必须装市场插件后，从 DSH 设置页操作；
- 收录流水线自动化：社区 PR 加 YAML → 合并后自动重建 catalog 并部署；另有定时任务同步已收录仓库、抓 stars、补实机截图、校验兼容性。

### 3.5 收录你自己的皮肤（提交市场）

1. 皮肤仓库 push 到 GitHub，**记录完整 40 位 commit**；
2. 按 `registry/skin.schema.json` 在 `registry/skins/` 加一个 YAML；
3. 向 `kingOfSoySauce/dsh-skin-market` 提 PR（标题 `feat(registry): add <皮肤名>`），合并后自动上架；
4. 市场 README 提供了一段"收录你的皮肤"提示词，可直接交给 Agent 代劳。

---

## 四、本包与市场的关系

- 本包（`dsh-skin-rotator`）是**独立皮肤**，不依赖市场插件即可使用；
- 本包带 `dsh.bundle`，属于"完整插件"形态，loader 行自己声明（rowId: `skin-rotator`，package: `dsh-skin-rotator`）；
- 动态背景类皮肤可参考已收录的 `dsh-any-background`、`dsh-wallpaper-rotator-enhanced` 等条目。

### 提交到皮肤市场（`kingOfSoySauce/dsh-skin-market`）

本皮肤满足市场的收录要求（公开仓库、带 `dsh.bundle` + `dsh.client`、固定 commit 安装），可按下述流程提交：

1. 记录仓库当前 **完整 40 位 commit**（`git rev-parse HEAD`）；
2. 在 `dsh-skin-market` 仓库的 `registry/skins/` 新增 `wensincai__dsh-skin-rotator.yml`（字段见 `registry/skin.schema.json`），核心字段：

   ```yaml
   id: wensincai.dsh-skin-rotator
   name: { zh: 动态背景轮播皮肤, en: dsh-skin-rotator }
   author: wensincai
   repo: https://github.com/wensincai/dsh-skin-rotator
   package: dsh-skin-rotator
   rowId: skin-rotator
   category: background
   install:
     target: 'github:wensincai/dsh-skin-rotator#<40位commit>'
     version: 0.1.0
     commit: '<40位commit>'
   compatibility: { dsh: 0.1.0-rc.6, platform: [web] }
   ```

3. 向 `kingOfSoySauce/dsh-skin-market` 提 PR（标题 `feat(registry): add dsh-skin-rotator`），合并后自动重建目录并上架；
4. 市场 README 也提供了一段"收录你的皮肤"提示词，可直接复制给 Agent 代劳。

> 注意：市场要求**真实界面截图**做预览。本皮肤目前以 `review.preview: repository-card` 提交（无截图）；上架后若想升级预览，可在 DSH 里启用本皮肤后截图，把图片提交到本仓库并在市场条目里补充 `screenshots`。

## License

MIT。
