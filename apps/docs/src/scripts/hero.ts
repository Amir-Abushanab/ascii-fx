import { loadProfile } from '@ascii-fx/core'
import { createAsciiRenderer, type AsciiRenderer, type InteractionType } from '@ascii-fx/gpu'
import profileRef from 'virtual:ascii-profile/default'
import { drawScene, makeSceneCanvas } from './scene'

const canvas = document.querySelector<HTMLCanvasElement>('[data-hero]')
const status = document.querySelector<HTMLElement>('[data-hero-status]')
const chips = document.querySelectorAll<HTMLButtonElement>('[data-interaction]')

async function mount(): Promise<void> {
  if (!canvas || !status) return
  try {
    const profile = await loadProfile(profileRef)
    const scene = makeSceneCanvas()
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round((rect.width * 9) / 16 * dpr)

    // 'foreground' at ~96 columns is the classic ASCII look: fitted glyph
    // colors over the page background, cells large enough to read. ('full'
    // reconstructs the image itself and reads like a mosaic at small cells.)
    const renderer: AsciiRenderer = await createAsciiRenderer({
      canvas,
      profile,
      backend: 'auto',
      columns: 96,
      color: 'foreground',
      fit: 'contain',
      interaction: { type: 'reveal', radius: 0.2, feather: 0.08 },
    })
    renderer.setSource(scene)
    renderer.start()

    const t0 = performance.now()
    let frames = 0
    let fps = 0
    let windowStart = t0
    const tick = (): void => {
      drawScene(scene, (performance.now() - t0) / 1000)
      frames++
      const now = performance.now()
      if (now - windowStart > 800) {
        fps = (frames * 1000) / (now - windowStart)
        frames = 0
        windowStart = now
        const grid = renderer.grid()
        status.innerHTML =
          `<span class="badge">backend <b>${renderer.backend}</b></span>` +
          `<span class="badge">grid <b>${grid?.columns}×${grid?.rows}</b></span>` +
          `<span class="badge"><b>${fps.toFixed(0)}</b> fps</span>`
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect()
      renderer.pointer.set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
    })
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.removeAttribute('data-active'))
        chip.setAttribute('data-active', '')
        const value = chip.dataset.interaction!
        renderer.setInteraction(
          value === 'none' ? null : { type: value as InteractionType, radius: 0.2, feather: 0.08 },
        )
      })
    })
  } catch (err) {
    status.textContent = `demo unavailable here: ${err instanceof Error ? err.message : String(err)}`
  }
}

void mount()
