// CPU-backend interactions: the Canvas2D implementations (shader math at cell
// granularity) must visibly affect the output without ever touching the
// matcher (spec §9/§35 semantics preserved).
import { describe, expect, it, vi } from 'vitest'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import type { AsciiRenderer } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile, randomImage } from '../../core/test/synthetic.js'

const frame2 = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

const pixels = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
  const ctx = canvas.getContext('2d')!
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data
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
