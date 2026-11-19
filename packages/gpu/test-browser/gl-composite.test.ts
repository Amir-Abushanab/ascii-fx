// WebGL2 compositor (spec §12) against the Canvas2D one it replaces. The two
// filter differently — Canvas2D builds the grid at native cell size and scales
// down, WebGL samples a mipped atlas the way the WebGPU backend does — so this
// is a closeness bound, not equality. What it catches is a port that is wrong:
// a flipped y, a mis-indexed atlas tile, a cell lookup off by a row.
import { describe, expect, it } from 'vitest'
import type { ColorMode } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { GlCompositor } from '../src/glCompositor.js'
import {
  STANDARD_SIX,
  makeChromaticProfile,
  makeProfile,
  randomImage,
} from '../../core/test/synthetic.js'

const settle = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

const readPixels = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)
  return ctx.getImageData(0, 0, out.width, out.height).data
}

const source = randomImage(160, 96, 31)

async function draw(
  compositor: 'auto' | 'canvas2d',
  color: ColorMode,
  extra: Record<string, unknown> = {},
  size: { width: number; height: number } = { width: 320, height: 192 },
): Promise<{ canvas: HTMLCanvasElement; data: Uint8ClampedArray }> {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const renderer = await createAsciiRenderer({
    canvas,
    profile: makeProfile(STANDARD_SIX),
    backend: 'cpu',
    columns: 20,
    color,
    workers: false,
    compositor,
    ...extra,
  })
  renderer.setSource(source)
  renderer.render()
  await settle()
  renderer.render()
  const data = readPixels(canvas)
  renderer.destroy()
  return { canvas, data }
}

const meanAbsDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let sum = 0
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    n += 3
  }
  return sum / n
}

describe('webgl2 compositor', () => {
  it('is what the CPU backend takes by default', async () => {
    const { canvas } = await draw('auto', 'full')
    // A canvas is bound to its first context type, so this is proof of which
    // one the renderer asked for.
    expect(canvas.getContext('2d')).toBeNull()
  })

  it('honours compositor: canvas2d', async () => {
    const { canvas } = await draw('canvas2d', 'full')
    expect(canvas.getContext('2d')).not.toBeNull()
  })

  for (const color of ['mono', 'foreground', 'full'] as const) {
    it(`matches the Canvas2D composite closely (${color})`, async () => {
      const gl = await draw('auto', color)
      const c2d = await draw('canvas2d', color)
      // Real divergence from a port bug lands in the tens; filtering alone is ~1.
      expect(meanAbsDiff(gl.data, c2d.data)).toBeLessThan(8)
    })
  }

  // A chromatic frame is 'glyph' whatever `color` says, and `color` is unset in the usual
  // call. Drawn as the mono default, each emoji came out as its alpha silhouette in the
  // foreground colour: the right shapes in the wrong picture, which nothing but pixels shows.
  it('draws chromatic glyphs in their own colours, as Canvas2D does', async () => {
    const hues: Array<[number, number, number]> = [
      [220, 40, 40],
      [40, 200, 60],
      [50, 80, 230],
      [230, 200, 30],
    ]
    const chromatic = makeChromaticProfile(
      hues.map((c, i) => ({
        char: String.fromCodePoint(0x1f300 + i),
        at: (x: number, y: number): [number, number, number, number] =>
          (x + y + i) % 3 === 0 ? [c[2], c[0], c[1], 255] : [c[0], c[1], c[2], 255],
      })),
    )
    const options = { profile: chromatic, matcher: 'chromatic', background: [11, 11, 15] }
    const gl = await draw('auto', 'mono', options)
    const c2d = await draw('canvas2d', 'mono', options)
    expect(meanAbsDiff(gl.data, c2d.data)).toBeLessThan(8)
  })

  it('paints something rather than an empty canvas', async () => {
    const { data } = await draw('auto', 'full')
    let lit = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++
    expect(lit).toBeGreaterThan(data.length / 4 / 2)
  })

  it('leaves the letterbox transparent in foreground mode', async () => {
    // 20 columns of a 4×8 cell over a 160×96 source derives a 20×6 grid, which
    // at 320×192 fills the canvas exactly. A taller canvas leaves 32px of
    // letterbox top and bottom, which is what this samples.
    const { data } = await draw('auto', 'foreground', {}, { width: 320, height: 256 })
    expect(data[3]).toBe(0) // top-left corner, in the letterbox
    const mid = ((256 >> 1) * 320 + 160) * 4
    expect(data[mid + 3]).toBeGreaterThan(0) // middle of the grid, painted
  })

  // The canvas is bound to WebGL, so there is no 2D context to fall back to while the
  // context is lost: presenting used to reach for one anyway and throw.
  it('survives a lost context and repaints once it is restored', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 192
    const renderer = await createAsciiRenderer({
      canvas,
      profile: makeProfile(STANDARD_SIX),
      backend: 'cpu',
      columns: 20,
      color: 'full',
      workers: false,
    })
    renderer.setSource(source)
    renderer.render()
    const before = readPixels(canvas)

    const lose = (canvas.getContext('webgl2') as WebGL2RenderingContext).getExtension(
      'WEBGL_lose_context',
    )!
    lose.loseContext()
    await new Promise((r) => setTimeout(r, 50))
    expect(() => renderer.render()).not.toThrow()
    expect(() => renderer.resize(320, 192)).not.toThrow()
    expect(renderer.pipeline.compositor).toBe('webgl2')

    lose.restoreContext()
    await new Promise((r) => setTimeout(r, 100))
    // Nothing asked for a render: the restore repainted the still by itself.
    expect(meanAbsDiff(readPixels(canvas), before)).toBeLessThan(1)
    renderer.destroy()
  })

  // Most presents are of a frame already on the GPU: a pointer move, a tick of a time-based
  // effect. Each used to repack every cell and push the whole source image up again.
  it('uploads nothing for a pointer move over an unchanged frame', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 192
    const renderer = await createAsciiRenderer({
      canvas,
      profile: makeProfile(STANDARD_SIX),
      backend: 'cpu',
      columns: 20,
      color: 'full',
      workers: false,
      interaction: { type: 'reveal', radius: 0.3 },
      // Bloom has a texture of its own, recomputed per frame and not per present.
      post: { bloom: 1 },
    })
    renderer.setSource(source)
    renderer.render()

    const proto = WebGL2RenderingContext.prototype
    const originals = { texImage2D: proto.texImage2D, texSubImage2D: proto.texSubImage2D }
    let uploads = 0
    proto.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      uploads++
      return (originals.texImage2D as (...a: unknown[]) => void).apply(this, args)
    } as typeof proto.texImage2D
    proto.texSubImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      uploads++
      return (originals.texSubImage2D as (...a: unknown[]) => void).apply(this, args)
    } as typeof proto.texSubImage2D
    try {
      renderer.pointer.set(0.2, 0.5)
      await settle()
      const left = readPixels(canvas)
      renderer.pointer.set(0.8, 0.5)
      await settle()
      // It did repaint — the revealed disc moved — without sending anything up.
      expect(meanAbsDiff(readPixels(canvas), left)).toBeGreaterThan(1)
      expect(uploads).toBe(0)

      // A new source is new pixels, a new frame and a new bloom field: all three go up.
      renderer.setSource(randomImage(160, 96, 32))
      renderer.render()
      expect(uploads).toBeGreaterThanOrEqual(3)
    } finally {
      proto.texImage2D = originals.texImage2D
      proto.texSubImage2D = originals.texSubImage2D
      renderer.destroy()
    }
  })

  it('reports unavailable after the context is lost', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const comp = GlCompositor.tryCreate(canvas, makeProfile(STANDARD_SIX))!
    expect(comp).toBeDefined()
    expect(comp.unavailable).toBe(false)
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    await new Promise((r) => setTimeout(r, 50))
    expect(comp.unavailable).toBe(true)
    comp.destroy()
  })
})
