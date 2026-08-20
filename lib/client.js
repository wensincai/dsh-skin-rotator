/**
 * dsh-skin-rotator — client half (browser).
 *
 * Wire format required by dsh client-modules: the served bundle must call
 * `window.__ModuleLoader__.load({ id, factory })` and the factory must return
 * the plugin module exports (`name` / `inject` / `apply`).
 *
 * The plugin fetches the image list from the host half, renders one image on
 * its own fixed full-viewport layer (darkened by a semi-transparent black
 * overlay so foreground text stays readable), and rotates every `rotateMs`
 * (host decides; default 5 minutes). The list is re-fetched on every tick, so
 * images dropped into the images folder appear within one interval — no
 * restart.
 *
 * Rendering notes (learned from the DSH shell + the Aqua glass theme):
 * - The background lives on a dedicated fixed layer (z-index -1), not on
 *   `body`, so shell surfaces that repaint over the viewport can never cover
 *   it, and the layer fades in/out independently of the page.
 * - The next image is preloaded (new Image) before the swap, so rotation
 *   never flashes the old image or an empty body.
 * - The black veil sits on the layer's ::after, driven by a CSS variable the
 *   host overlay value writes each tick; dark theme swaps it for a near-black
 *   navy so it stays in the palette family.
 * - A MutationObserver re-seals transparent surfaces after React remounts
 *   (class-name seams can otherwise reappear opaque mid-session).
 */
window.__ModuleLoader__.load({
  id: 'dsh-skin-rotator',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const name = 'dsh-skin-rotator'
    const inject = []
    const FALLBACK_INTERVAL = 5 * 60 * 1000
    const FALLBACK_OVERLAY = 0.35

    // The DSH shell paints opaque surfaces over the viewport (they consume
    // the --dsw-alias-bg-* tokens), so a bare background never shows. The
    // skin makes those surfaces transparent and switches the shell to its
    // dark palette (body[data-ds-dark-theme]) so the wallpaper reads through
    // with light, readable text on top.
    const SURFACE_CSS = `
      :root, html, body, #root {
        --dsw-alias-bg-base: transparent !important;
        --dsw-alias-bg-layer-1: transparent !important;
        --dsw-alias-bg-layer-2: transparent !important;
        --dsw-alias-bg-base-strong: transparent !important;
        --dsw-specific-sidebar-fill: transparent !important;
        --ds-color-bg: transparent !important;
        background-color: transparent !important;
      }
      body[class] { background-color: transparent !important; }
      [class*="scrollBody"], [class*="sidebar"], [class*="explorer"],
      [class*="contentArea"], [class*="composerSeat"],
      [class*="railIn"], [class*="quietBars"], [class*="sidebarCol"] {
        background-color: transparent !important;
        background: transparent !important;
      }
    `

    // The wallpaper layer: a dedicated fixed element below the page content
    // (z-index -1, like the Aqua glass theme's ambient layer) with its own
    // fade transition. The black veil is painted on ::after so it fades with
    // the image instead of snapping; its alpha comes from the host's overlay
    // value through --dsh-skin-rotator-veil.
    const BG_CSS = `
      .dsh-skin-rotator-bg {
        position: fixed;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        opacity: 0;
        transition: opacity 0.5s ease;
      }
      .dsh-skin-rotator-bg.dsh-skin-rotator-bg-visible { opacity: 1; }
      .dsh-skin-rotator-bg::after {
        content: '';
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, var(--dsh-skin-rotator-veil, 0.6));
      }
      body[data-ds-dark-theme] .dsh-skin-rotator-bg::after {
        background: rgb(8 12 20 / var(--dsh-skin-rotator-veil, 0.6));
      }
    `

    function apply(ctx) {
      ctx.effect(() => {
        let images = []
        let index = -1
        let timer = null
        let overlay = FALLBACK_OVERLAY
        let swapping = false

        function ensureChrome() {
          if (document.getElementById('dsh-skin-rotator-chrome') !== null) return
          const style = document.createElement('style')
          style.id = 'dsh-skin-rotator-chrome'
          style.textContent = SURFACE_CSS + BG_CSS
          document.head.appendChild(style)
          // Dark palette: light text stays readable over the wallpaper.
          document.body.setAttribute('data-ds-dark-theme', '')
          const bg = document.createElement('div')
          bg.id = 'dsh-skin-rotator-bg'
          bg.className = 'dsh-skin-rotator-bg'
          bg.setAttribute('aria-hidden', 'true')
          document.body.prepend(bg)
          sealSurfaces()
          sealObserver()
        }

        /** Re-apply transparent backgrounds to shell surfaces (idempotent). */
        function sealSurfaces() {
          const selector = '[class*="scrollBody"], [class*="sidebar"], [class*="explorer"], ' +
            '[class*="contentArea"], [class*="composerSeat"], [class*="railIn"], ' +
            '[class*="quietBars"], [class*="sidebarCol"]'
          for (const el of document.querySelectorAll(selector)) {
            el.style.setProperty('background-color', 'transparent', 'important')
            el.style.setProperty('background', 'transparent', 'important')
          }
        }

        let sealObserverInstance = null

        /** Keep surfaces sealed as React remounts nodes (class seams move). */
        function sealObserver() {
          if (sealObserverInstance !== null) return
          sealObserverInstance = new MutationObserver(() => { sealSurfaces() })
          sealObserverInstance.observe(document.body, { childList: true, subtree: true })
        }

        /** Preload one image URL; resolves regardless (a failed load just
         *  skips the fade-in change, and the next tick retries). */
        function preloadImage(url) {
          return new Promise((resolve) => {
            const img = new Image()
            img.onload = () => resolve(true)
            img.onerror = () => resolve(false)
            img.src = url
          })
        }

        /** Swap the background layer to `url` with a cross-fade: drop the
         *  visible class, switch the image halfway through the fade, bring it
         *  back up. Never flashes an empty/old frame. */
        function fadeTo(url) {
          const bg = document.getElementById('dsh-skin-rotator-bg')
          if (bg === null) return
          bg.style.setProperty('--dsh-skin-rotator-veil', String(overlay))
          bg.classList.remove('dsh-skin-rotator-bg-visible')
          window.setTimeout(() => {
            bg.style.backgroundImage = `url("${url}")`
            // Force a reflow so the transition re-arms before re-adding.
            void bg.offsetWidth
            bg.classList.add('dsh-skin-rotator-bg-visible')
          }, 250)
        }

        async function rotate() {
          if (images.length === 0 || swapping) return
          swapping = true
          try {
            const next = (index + 1) % images.length
            const url = `${location.origin}/skin-rotator/files/${encodeURIComponent(images[next])}?t=${Date.now()}`
            const ok = await preloadImage(url)
            if (!ok) return
            index = next
            fadeTo(url)
          } finally {
            swapping = false
          }
        }

        async function refresh() {
          try {
            const res = await fetch(`${location.origin}/skin-rotator/images`, { cache: 'no-store' })
            if (!res.ok) return
            const data = await res.json()
            const next = Array.isArray(data.images) ? data.images : []
            if (next.length === 0) return
            const interval = Number.isFinite(data.rotateMs) && data.rotateMs > 0 ? data.rotateMs : FALLBACK_INTERVAL
            const hostOverlay = Number(data.overlay)
            if (Number.isFinite(hostOverlay) && hostOverlay >= 0 && hostOverlay <= 1) overlay = hostOverlay
            images = next
            if (timer !== null) clearInterval(timer)
            timer = setInterval(() => { void rotate() }, interval)
            await rotate()
          } catch {
            // transient fetch failure: retry on the next interval
          }
        }

        ensureChrome()
        refresh()
        return () => {
          if (timer !== null) clearInterval(timer)
          sealObserverInstance?.disconnect()
          sealObserverInstance = null
          document.getElementById('dsh-skin-rotator-bg')?.remove()
          document.body.removeAttribute('data-ds-dark-theme')
          document.getElementById('dsh-skin-rotator-chrome')?.remove()
        }
      }, 'dsh-skin-rotator: rotation')
    }

    module.exports = { name, inject, apply }
    return module.exports
  },
})
