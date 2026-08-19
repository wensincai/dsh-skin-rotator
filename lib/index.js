/**
 * dsh-skin-rotator — host half.
 *
 * Exposes the skin's local images directory over the dsh web server so the
 * browser half can rotate backgrounds without any local-file access:
 *
 *   GET /skin-rotator/images            → JSON { images: string[], rotateMs }
 *   GET /skin-rotator/files/<name>      → the image file itself
 *
 * Images directory resolution order:
 *   1. cordis.yml config `imagesDir`
 *   2. env `DSH_SKIN_IMAGES_DIR`
 *   3. default: <package>/images (drop new images there; no restart needed —
 *      the list is re-read from disk on every request)
 *
 * Rotation interval is exposed in the list response so the client stays in
 * sync with `rotateMs` (default 30000, config `rotateMs` or env
 * `DSH_SKIN_ROTATE_MS`).
 *
 * @module dsh-skin-rotator
 */

import { createReadStream, existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-skin-rotator'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

const DEFAULT_ROTATE_MS = 5 * 60 * 1000
const DEFAULT_OVERLAY_OPACITY = 0.35

function imagesDir(config) {
  if (config?.imagesDir !== undefined && config.imagesDir !== '') return String(config.imagesDir)
  if (process.env.DSH_SKIN_IMAGES_DIR !== undefined && process.env.DSH_SKIN_IMAGES_DIR.trim() !== '') {
    return process.env.DSH_SKIN_IMAGES_DIR.trim()
  }
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'images')
}

function rotateMs(config) {
  const fromEnv = Number(process.env.DSH_SKIN_ROTATE_MS)
  const value = config?.rotateMs ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_ROTATE_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ROTATE_MS
}

/** Black overlay opacity over the background image (0 = none, 1 = opaque). */
function overlayOpacity(config) {
  const fromEnv = Number(process.env.DSH_SKIN_OVERLAY_OPACITY)
  const value = config?.overlayOpacity ?? (Number.isFinite(fromEnv) ? fromEnv : DEFAULT_OVERLAY_OPACITY)
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_OVERLAY_OPACITY
}

/** List image files in the directory, sorted by name; missing dir yields []. */
async function listImages(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && IMAGE_EXTS.has(extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  } catch {
    return []
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function send404(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

/** Resolve the requested filename under the images dir, or null on any traversal. */
function resolveImageName(requestUrl) {
  const rest = String(requestUrl ?? '').split('?')[0].slice('/skin-rotator/files'.length).replace(/^\/+/, '')
  const name = decodeURIComponent(rest)
  if (name === '' || name.includes('/') || name.includes('\\') || name.includes('\0')) return null
  if (!IMAGE_EXTS.has(extname(name).toLowerCase())) return null
  return name
}

export function apply(ctx, config = {}) {
  ctx.inject(['webServer'], (host) => {
    const dir = imagesDir(config)
    const interval = rotateMs(config)
    const overlay = overlayOpacity(config)
    host.effect(() => {
      const disposers = [
        host.webServer.register({
          kind: 'exact',
          path: '/skin-rotator/images',
          handler: async (request, response) => {
            const images = await listImages(dir)
            sendJson(response, 200, { images, rotateMs: interval, overlay, dir })
          },
        }),
        host.webServer.register({
          kind: 'prefix',
          path: '/skin-rotator/files',
          handler: (request, response) => {
            const name = resolveImageName(request.url)
            if (name === null) return send404(response)
            const file = join(dir, name)
            if (!existsSync(file)) return send404(response)
            const type = MIME_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
            response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
            createReadStream(file).pipe(response)
          },
        }),
      ]
      return () => disposers.forEach((dispose) => dispose?.())
    }, 'dsh-skin-rotator: routes')
  })
}
