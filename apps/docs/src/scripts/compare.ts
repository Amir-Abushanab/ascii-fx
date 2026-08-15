import { compositeFrame, loadProfile, matchFrame, type MatcherKind, type RawImage } from '@ascii-fx/core'
import profileRef from 'virtual:ascii-profile/default'
import { makeSceneCanvas } from './scene'

async function mount(): Promise<void> {
  const host = document.querySelector('[data-compare]')
  if (!host) return
  try {
    const profile = await loadProfile(profileRef)
    const scene = makeSceneCanvas(480, 270)
    const sctx = scene.getContext('2d')!
    const img = sctx.getImageData(0, 0, scene.width, scene.height)
    const raw: RawImage = { width: img.width, height: img.height, data: img.data }

    const original = host.querySelector<HTMLCanvasElement>('[data-variant="original"]')
    if (original) {
      original.width = scene.width
      original.height = scene.height
      original.getContext('2d')!.drawImage(scene, 0, 0)
    }

    for (const matcher of ['structural', 'shape6', 'ramp'] as MatcherKind[]) {
      const canvas = host.querySelector<HTMLCanvasElement>(`[data-variant="${matcher}"]`)
      const label = host.querySelector<HTMLElement>(`[data-ms="${matcher}"]`)
      if (!canvas) continue
      const t0 = performance.now()
      // Mono at 40 columns: glyph CHOICE is what this strip compares, and it
      // needs cells big enough on screen for the glyphs to be legible.
      const frame = matchFrame(raw, { profile, columns: 40, color: 'mono', matcher })
      const ms = performance.now() - t0
      const out = compositeFrame(frame)
      canvas.width = out.width
      canvas.height = out.height
      const data = new Uint8ClampedArray(out.data.buffer as ArrayBuffer, out.data.byteOffset, out.data.length)
      canvas.getContext('2d')!.putImageData(new ImageData(data, out.width, out.height), 0, 0)
      if (label) label.textContent = `${ms.toFixed(1)}ms CPU`
    }
  } catch (err) {
    console.error('[docs] compare demo failed:', err)
  }
}

void mount()
