/**
 * dsh-skin-rotator — client half (browser).
 *
 * Wire format required by dsh client-modules: the served bundle must call
 * `window.__ModuleLoader__.load({ id, factory })` and the factory must return
 * the plugin module exports (`name` / `inject` / `apply`).
 *
 * The plugin fetches the image list from the host half, applies one image as
 * a fixed full-viewport background (darkened by a semi-transparent black
 * overlay so foreground text stays readable), and rotates every `rotateMs`
 * (host decides; default 5 minutes). The list is re-fetched on every tick, so
 * images dropped into the images folder appear within one interval — no
 * restart.
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

    function apply(ctx) {
      ctx.effect(() => {
        let images = []
        let index = -1
        let timer = null
        let overlay = FALLBACK_OVERLAY

        function applyImage() {
          if (images.length === 0) return
          index = (index + 1) % images.length
          const url = `${location.origin}/skin-rotator/files/${encodeURIComponent(images[index])}?t=${Date.now()}`
          // Black overlay sits between the image and the page content: a
          // translucent black gradient composited over the picture darkens the
          // image itself, so text above stays readable without any extra DOM.
          const veil = `rgba(0, 0, 0, ${overlay})`
          document.body.style.backgroundImage = `linear-gradient(${veil}, ${veil}), url("${url}")`
          document.body.style.backgroundSize = 'cover'
          document.body.style.backgroundPosition = 'center'
          document.body.style.backgroundAttachment = 'fixed'
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
            timer = setInterval(refresh, interval)
            applyImage()
          } catch {
            // transient fetch failure: retry on the next interval
          }
        }

        refresh()
        return () => {
          if (timer !== null) clearInterval(timer)
          document.body.style.backgroundImage = ''
        }
      }, 'dsh-skin-rotator: rotation')
    }

    module.exports = { name, inject, apply }
    return module.exports
  },
})
