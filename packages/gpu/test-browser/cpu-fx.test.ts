// CPU-backend interactions: the Canvas2D implementations (shader math at cell
// granularity) must visibly affect the output without ever touching the
// matcher (spec §9/§35 semantics preserved).
import { describe, expect, it, vi } from 'vitest'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import type { AsciiRenderer } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile, randomImage } from '../../core/test/synthetic.js'

const frame2 = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/** Works whichever context the renderer took: 2d, or webgl2 via the compositor. */
const pixels = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)
  return ctx.getImageData(0, 0, out.width, out.height).data
}

const diffCount = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let d = 0
  for (let i = 0; i < a.length; i += 401) if (a[i] !== b[i]) d++
  return d
}

/** Exact per-pixel diff restricted to columns x ≥ x0. */
const regionDiffCount = (
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  x0: number,
): number => {
  let d = 0
  for (let i = 0; i < a.length; i += 4) {
    if ((i >> 2) % width < x0) continue
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
      d++
  }
  return d
}

async function mkCpu(): Promise<{ renderer: AsciiRenderer; canvas: HTMLCanvasElement }> {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const renderer = await createAsciiRenderer({
    canvas,
    profile: makeProfile(STANDARD_SIX),
    backend: 'cpu',
    columns: 16,
    color: 'full',
  })
  renderer.setSource(randomImage(128, 72, 91))
  renderer.render()
  return { renderer, canvas }
}

describe('cpu backend interactions', () => {
  it('cancels the old video callback when a running renderer changes source', async () => {
    const renderer = await createAsciiRenderer({
      canvas: document.createElement('canvas'),
      profile: makeProfile(STANDARD_SIX),
      backend: 'cpu',
    })
    const first = document.createElement('video')
    const second = document.createElement('video')
    const firstCancel = vi.fn()
    let staleCallback: VideoFrameRequestCallback | undefined
    const firstRequest = vi.fn((callback: VideoFrameRequestCallback) => {
      staleCallback = callback
      return 11
    })
    const secondRequest = vi.fn(() => 22)
    Object.defineProperties(first, {
      requestVideoFrameCallback: { value: firstRequest },
      cancelVideoFrameCallback: { value: firstCancel },
    })
    Object.defineProperties(second, {
      requestVideoFrameCallback: { value: secondRequest },
      cancelVideoFrameCallback: { value: vi.fn() },
    })
    try {
      renderer.setSource(first)
      renderer.start()
      renderer.setSource(second)
      expect(firstCancel).toHaveBeenCalledWith(11)
      expect(secondRequest).toHaveBeenCalledOnce()
      staleCallback?.(0, {} as VideoFrameCallbackMetadata)
      expect(firstRequest).toHaveBeenCalledOnce()
      expect(secondRequest).toHaveBeenCalledOnce()
    } finally {
      renderer.destroy()
    }
  })

  it('reveal, magnify, color, and original-mix visibly change the composite', async () => {
    const { renderer, canvas } = await mkCpu()
    try {
      const baseline = pixels(canvas)
      const cpuFrame = await renderer.captureFrame()
      for (const type of ['reveal', 'resolution', 'color', 'original-mix'] as const) {
        renderer.setInteraction({ type, radius: 0.4, feather: 0.15, intensity: 1 })
        renderer.pointer.set(0.5, 0.5)
        await frame2()
        const now = pixels(canvas)
        expect(diffCount(baseline, now), `${type} should change pixels`).toBeGreaterThan(8)
      }
      // interactions are composite-only: the matched frame is untouched
      renderer.setInteraction({ type: 'reveal', radius: 0.4 })
      const after = await renderer.captureFrame()
      expect(after.glyphIds).toEqual(cpuFrame.glyphIds)
    } finally {
      renderer.destroy()
    }
  })

  it('wave animates over time without rematching', async () => {
    const { renderer, canvas } = await mkCpu()
    try {
      renderer.setInteraction({ type: 'wave', intensity: 1.5 })
      await frame2()
      const a = pixels(canvas)
      await new Promise((r) => setTimeout(r, 250))
      const b = pixels(canvas)
      expect(diffCount(a, b), 'wave must keep moving while static').toBeGreaterThan(8)
    } finally {
      renderer.destroy()
    }
  })

  it('warp and glyph effects change pixels near the pointer, none far away', async () => {
    const { renderer, canvas } = await mkCpu()
    try {
      const baseline = pixels(canvas)
      // pointer at x=80; influence radius (0.25 + 0.05) · 180 = 54px, and the
      // cell engine may redraw one extra cell of margin → x ≥ 168 is far.
      const FAR_X = 168
      for (const type of [
        'push',
        'resolution',
        'displace',
        'glyph-scale',
        'glyph-rotate',
      ] as const) {
        renderer.setInteraction({ type, radius: 0.25, feather: 0.05, intensity: 2 })
        renderer.pointer.set(0.25, 0.5)
        await frame2()
        const now = pixels(canvas)
        expect(diffCount(baseline, now), `${type} should change pixels`).toBeGreaterThan(4)
        expect(
          regionDiffCount(baseline, now, canvas.width, FAR_X),
          `${type} must leave cells outside its radius untouched`,
        ).toBe(0)
        renderer.setInteraction(null)
        await frame2()
      }
    } finally {
      renderer.destroy()
    }
  })
})

/** Grey, with the left or right half brightened — motion moves between them. */
const halfLit = (litRight: boolean) => {
  const w = 128
  const h = 72
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const v = x >= w / 2 === litRight ? 230 : 30
      data[p] = v
      data[p + 1] = v
      data[p + 2] = v
      data[p + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

const mkMotion = async (type = 'reveal' as const) => {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const renderer = await createAsciiRenderer({
    canvas,
    profile: makeProfile(STANDARD_SIX),
    backend: 'cpu',
    columns: 16,
    color: 'full',
    interaction: { type, source: 'motion', intensity: 1 },
  })
  return { renderer, canvas }
}

// `source: 'motion'` (ALGORITHM.md §21) swaps the pointer's radial falloff for
// the per-cell motion field, so the effect has to land where the source moved
// and nowhere else. These assert on *where* the pixels changed, since an effect
// applied uniformly would pass a plain "something changed" check.
describe('motion-driven interactions', () => {
  it('does nothing on a still source and something once it moves', async () => {
    const { renderer, canvas } = await mkMotion()
    renderer.setSource(halfLit(false))
    renderer.render()
    await frame2()
    const first = pixels(canvas)

    // Same frame again: nothing moved, so the field is flat and so is the effect.
    renderer.setSource(halfLit(false))
    renderer.render()
    await frame2()
    expect(diffCount(first, pixels(canvas))).toBe(0)

    // The lit half swaps sides — every cell changes, so the effect appears.
    renderer.setSource(halfLit(true))
    renderer.render()
    await frame2()
    expect(diffCount(first, pixels(canvas))).toBeGreaterThan(0)
    renderer.destroy()
  })

  it('lands only where the source actually moved', async () => {
    // A source whose right half alone changes: the field should be lit there
    // and dark on the left, so the effect must be confined to the right.
    const base = halfLit(false)
    const changedRight = { width: 128, height: 72, data: new Uint8Array(base.data) }
    for (let y = 0; y < 72; y++) {
      for (let x = 64; x < 128; x++) {
        const p = (y * 128 + x) * 4
        changedRight.data[p] = 120
        changedRight.data[p + 1] = 120
        changedRight.data[p + 2] = 120
      }
    }

    // Reference: the same two frames with no interaction at all, so any
    // difference below is the cells changing rather than the effect.
    const plainCanvas = document.createElement('canvas')
    plainCanvas.width = 320
    plainCanvas.height = 180
    const plain = await createAsciiRenderer({
      canvas: plainCanvas,
      profile: makeProfile(STANDARD_SIX),
      backend: 'cpu',
      columns: 16,
      color: 'full',
    })
    plain.setSource(base)
    plain.render()
    await frame2()
    plain.setSource(changedRight)
    plain.render()
    await frame2()
    const plainPixels = pixels(plainCanvas)

    const { renderer, canvas } = await mkMotion()
    renderer.setSource(base)
    renderer.render()
    await frame2()
    renderer.setSource(changedRight)
    renderer.render()
    await frame2()
    const withMotion = pixels(canvas)

    // Left half: nothing moved, so motion adds nothing over the plain render.
    expect(
      regionDiffCount(plainPixels, withMotion, 320, 0) -
        regionDiffCount(plainPixels, withMotion, 320, 160),
    ).toBe(0)
    // Right half: it did, so it does.
    expect(regionDiffCount(plainPixels, withMotion, 320, 160)).toBeGreaterThan(0)
    plain.destroy()
    renderer.destroy()
  })

  it('works on the Canvas2D composite too, not just the shader one', async () => {
    // Canvas2D approximates the shader at cell granularity, and the field is
    // per cell, so this is the one effect where the two should agree closely.
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const renderer = await createAsciiRenderer({
      canvas,
      profile: makeProfile(STANDARD_SIX),
      backend: 'cpu',
      compositor: 'canvas2d',
      columns: 16,
      color: 'full',
      interaction: { type: 'reveal', source: 'motion', intensity: 1 },
    })
    renderer.setSource(halfLit(false))
    renderer.render()
    await frame2()
    const still = pixels(canvas)

    renderer.setSource(halfLit(false))
    renderer.render()
    await frame2()
    expect(diffCount(still, pixels(canvas))).toBe(0)

    renderer.setSource(halfLit(true))
    renderer.render()
    await frame2()
    expect(diffCount(still, pixels(canvas))).toBeGreaterThan(0)
    renderer.destroy()
  })

  it('refuses the kinds a field cannot drive', async () => {
    for (const type of ['wave', 'push', 'resolution'] as const) {
      await expect(
        createAsciiRenderer({
          canvas: document.createElement('canvas'),
          profile: makeProfile(STANDARD_SIX),
          backend: 'cpu',
          interaction: { type, source: 'motion' },
        }),
      ).rejects.toThrow(/nothing to act on/)
    }
  })
})
