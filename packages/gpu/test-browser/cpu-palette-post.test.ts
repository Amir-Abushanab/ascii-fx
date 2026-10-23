// palette-v1 and the post stage on the CPU backend: the palette reaches the exported frame, a
// palette change repaints without rematching, and both compositors draw the post effects.
import { describe, expect, it } from 'vitest'
import type { RGB } from '@ascii-fx/core'
import { matchFrame, quantizeFrame } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import type { PostOptions } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile, randomImage } from '../../core/test/synthetic.js'

const GAMEBOY: RGB[] = [
  [15, 56, 15],
  [48, 98, 48],
  [139, 172, 15],
  [155, 188, 15],
]
const profile = makeProfile(STANDARD_SIX)
const image = randomImage(160, 96, 21)

const readPixels = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)
  return ctx.getImageData(0, 0, out.width, out.height).data
}

async function draw(
  compositor: 'auto' | 'canvas2d',
  post: PostOptions | null,
): Promise<Uint8ClampedArray> {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 192
  const renderer = await createAsciiRenderer({
    canvas,
    profile,
    backend: 'cpu',
    columns: 20,
    color: 'full',
    workers: false,
    compositor,
    post,
  })
  renderer.setSource(image)
  renderer.render()
  const data = readPixels(canvas)
  renderer.destroy()
  return data
}

describe('palette-v1 on the CPU backend', () => {
  it('captureFrame returns the snapped frame', async () => {
    const renderer = await createAsciiRenderer({
      canvas: document.createElement('canvas'),
      profile,
      backend: 'cpu',
      columns: 20,
      color: 'full',
      workers: false,
      palette: { colors: GAMEBOY, dither: 'bayer4' },
    })
    renderer.setSource(image)
    const frame = await renderer.captureFrame()
    const expected = quantizeFrame(matchFrame(image, { profile, columns: 20, color: 'full' }), {
      colors: GAMEBOY,
      dither: 'bayer4',
    })
    expect(frame.foreground).toEqual(expected.foreground)
    expect(frame.background).toEqual(expected.background)
    renderer.destroy()
  })

  it('a palette change repaints the frame it already has', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 192
    const renderer = await createAsciiRenderer({
      canvas,
      profile,
      backend: 'cpu',
      columns: 20,
      color: 'full',
      workers: false,
    })
    renderer.setSource(image)
    renderer.render()
    const before = await renderer.captureFrame()
    renderer.setOptions({ palette: { colors: GAMEBOY } })
    renderer.render()
    const after = await renderer.captureFrame()
    // Same glyph array object: nothing was matched again, only re-coloured.
    expect(after.glyphIds).toBe(before.glyphIds)
    expect(after.foreground).not.toEqual(before.foreground)
    renderer.destroy()
  })

  it('rejects a malformed palette when it is set, not on a later frame', async () => {
    const renderer = await createAsciiRenderer({
      canvas: document.createElement('canvas'),
      profile,
      backend: 'cpu',
      workers: false,
    })
    expect(() => renderer.setOptions({ palette: { colors: [] } })).toThrow(/1\.\.256/)
    renderer.destroy()
  })
})

describe('post stage on the CPU backend', () => {
  for (const compositor of ['auto', 'canvas2d'] as const) {
    // Canvas2D has no per-pixel sampling, so it draws only these three.
    const effects =
      compositor === 'auto'
        ? (['scanlines', 'vignette', 'curvature', 'aberration', 'bloom', 'grain'] as const)
        : (['scanlines', 'vignette', 'bloom'] as const)
    it(`${compositor === 'auto' ? 'webgl2' : 'canvas2d'} draws ${effects.join(', ')}`, async () => {
      const base = await draw(compositor, null)
      for (const effect of effects) {
        const withFx = await draw(compositor, { [effect]: 1 })
        let diff = 0
        for (let i = 0; i < base.length; i++) diff += Math.abs(base[i] - withFx[i])
        expect(diff, effect).toBeGreaterThan(0)
      }
    })
  }
})
