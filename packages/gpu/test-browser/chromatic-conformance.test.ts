// CPU <-> GPU conformance for chromatic-v1 (ALGORITHM.md §C). The CPU matcher
// is the oracle; the WebGPU path must agree on every cell, bit-for-bit. The
// chromatic shader parallelises over glyphs rather than samples and reduces the
// winner in two passes, so a disagreement here is exactly the class of bug that
// arrangement risks: a lost tie-break, or an early exit that changed a result.
import { describe, expect, it } from 'vitest'
import type { AsciiFrame, RGB } from '@ascii-fx/core'
import { matchFrame } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { makeChromaticProfile, randomImage, solid } from '../../core/test/synthetic.js'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator ? (await navigator.gpu.requestAdapter()) !== null : false

function expectFramesEqual(gpu: AsciiFrame, cpu: AsciiFrame, label: string): void {
  expect(gpu.columns, `${label} columns`).toBe(cpu.columns)
  expect(gpu.rows, `${label} rows`).toBe(cpu.rows)
  expect(gpu.colorMode, `${label} colorMode`).toBe(cpu.colorMode)
  expect(gpu.glyphIds, `${label} glyphIds`).toEqual(cpu.glyphIds)
  expect(gpu.flags, `${label} flags`).toEqual(cpu.flags)
  expect(gpu.foreground, `${label} foreground`).toBeUndefined()
  expect(gpu.background, `${label} background`).toBeUndefined()
}

const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296)

/** Random colour glyphs with real sub-cell structure and varied alpha. */
function randomChromaticProfile(count: number, seed: number) {
  const rnd = lcg(seed)
  const glyphs = Array.from({ length: count }, (_, i) => {
    const base = [rnd() * 256, rnd() * 256, rnd() * 256]
    const alt = [rnd() * 256, rnd() * 256, rnd() * 256]
    const alpha = i % 5 === 0 ? Math.floor(rnd() * 256) : 255
    const split = Math.floor(rnd() * 8)
    return {
      char: String.fromCodePoint(0x1f300 + i),
      at: (x: number, y: number): [number, number, number, number] => {
        const c = x + y > split * 2 ? base : alt
        return [c[0] | 0, c[1] | 0, c[2] | 0, alpha]
      },
    }
  })
  return makeChromaticProfile(glyphs)
}

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('chromatic conformance skipped — no adapter in this browser', () => {
    expect(gpuAvailable).toBe(false)
  })
})

describe.runIf(gpuAvailable)('chromatic-v1 GPU <-> CPU conformance', () => {
  // The backdrop is part of the objective (§C3), so it is swept: a bug in the
  // host-side composite would only show up on a non-black one.
  const BACKDROPS: Array<[string, RGB]> = [
    ['black', [0, 0, 0]],
    ['white', [255, 255, 255]],
    ['site bg', [11, 11, 15]],
  ]

  async function conform(profile: ReturnType<typeof makeChromaticProfile>, seed: number, columns: number, label: string) {
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile,
      backend: 'webgpu',
    })
    expect(renderer.backend).toBe('webgpu')
    try {
      const image = randomImage(80, 48, seed)
      for (const [name, background] of BACKDROPS) {
        renderer.setOptions({ columns, matcher: 'chromatic', background, alpha: 'ignore' })
        renderer.setSource(image)
        const gpuFrame = await renderer.captureFrame()
        const cpuFrame = matchFrame(image, {
          profile,
          columns,
          matcher: 'chromatic',
          background,
          alpha: 'ignore',
        })
        expectFramesEqual(gpuFrame, cpuFrame, `${label} / ${name}`)
      }
    } finally {
      renderer.destroy()
    }
  }

  it('agrees on a tiny hand-built palette', async () => {
    const profile = makeChromaticProfile([
      solid('r', 200, 20, 20),
      solid('g', 20, 200, 20),
      solid('b', 20, 20, 200),
      solid('w', 240, 240, 240),
      solid('h', 255, 255, 255, 128),
    ])
    await conform(profile, 31, 10, 'tiny')
  })

  it('agrees on a 40-glyph random palette', async () => {
    await conform(randomChromaticProfile(40, 5), 32, 10, 'rand40')
  })

  // 100 is the size curation showed matches a full 1301-glyph pool, so it is
  // the configuration worth proving rather than an arbitrary stress size.
  it('agrees on a 100-glyph random palette', async () => {
    await conform(randomChromaticProfile(100, 9), 33, 12, 'rand100')
  })

  it('agrees on a 300-glyph palette, where threads cover several glyphs each', async () => {
    await conform(randomChromaticProfile(300, 17), 34, 8, 'rand300')
  })

  it('agrees on transparent cells', async () => {
    const profile = makeChromaticProfile([solid('r', 200, 20, 20), solid('b', 20, 20, 200)])
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile,
      backend: 'webgpu',
    })
    try {
      const image = randomImage(64, 64, 44, true)
      renderer.setOptions({ columns: 8, matcher: 'chromatic', alpha: 'mask' })
      renderer.setSource(image)
      const gpuFrame = await renderer.captureFrame()
      const cpuFrame = matchFrame(image, { profile, columns: 8, matcher: 'chromatic', alpha: 'mask' })
      expectFramesEqual(gpuFrame, cpuFrame, 'transparent')
    } finally {
      renderer.destroy()
    }
  })

  // Hysteresis reads the previous frame out of the cells buffer, and unlike
  // exact temporal reuse it is biased toward the incumbent, so it does not
  // self-correct. Before the reset, switching source left the old image ghosted
  // into wherever the new one was ambiguous — which at h=0.4 is most of a flat
  // region, since a challenger has to be 40% better to win.
  it('does not carry the previous source across a setSource with hysteresis on', async () => {
    const profile = randomChromaticProfile(40, 3)
    const paint = (fn: (ctx: OffscreenCanvasRenderingContext2D) => void): OffscreenCanvas => {
      const c = new OffscreenCanvas(240, 160)
      fn(c.getContext('2d') as OffscreenCanvasRenderingContext2D)
      return c
    }
    const a = paint((x) => {
      x.fillStyle = '#c81414'
      x.fillRect(0, 0, 240, 160)
      x.fillStyle = '#1414c8'
      x.fillRect(0, 0, 120, 80)
    })
    const b = paint((x) => {
      x.fillStyle = '#14c814'
      x.fillRect(0, 0, 240, 160)
      x.fillStyle = '#e8e8c8'
      x.fillRect(120, 80, 120, 80)
    })
    const opts = { columns: 20, matcher: 'chromatic' as const, background: [11, 11, 15] as RGB, alpha: 'ignore' as const, hysteresis: 0.4 }

    const switched = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, ...opts })
    const fresh = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, ...opts })
    try {
      switched.setSource(a)
      await switched.captureFrame()
      switched.setSource(b)
      const after = await switched.captureFrame()

      // A renderer that only ever saw b is the ground truth for "no ghost".
      fresh.setSource(b)
      const clean = await fresh.captureFrame()
      expect(after.glyphIds).toEqual(clean.glyphIds)
    } finally {
      switched.destroy()
      fresh.destroy()
    }
  })

  // The CPU backend builds its own matchFrame options, so `matcher` reaching it
  // is a separate wire from the WebGPU path. Missing it does not fail loudly:
  // an emoji profile silently matches under structural-v1, which fits one ink
  // colour per cell and renders the palette in greyscale.
  it('CPU backend honours matcher: chromatic rather than falling back to structural', async () => {
    const profile = randomChromaticProfile(24, 77)
    const image = randomImage(64, 48, 88)
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile,
      backend: 'cpu',
    })
    try {
      expect(renderer.backend).toBe('cpu')
      renderer.setOptions({ columns: 8, matcher: 'chromatic', background: [11, 11, 15], alpha: 'ignore' })
      renderer.setSource(image)
      const frame = await renderer.captureFrame()
      expect(frame.colorMode).toBe('glyph')
      expect(frame.foreground).toBeUndefined()
      const cpu = matchFrame(image, {
        profile,
        columns: 8,
        matcher: 'chromatic',
        background: [11, 11, 15],
        alpha: 'ignore',
      })
      expect(frame.glyphIds).toEqual(cpu.glyphIds)
    } finally {
      renderer.destroy()
    }
  })

  it('refuses a profile with no chromatic data instead of rendering garbage', async () => {
    const { makeProfile, STANDARD_SIX } = await import('../../core/test/synthetic.js')
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile: makeProfile(STANDARD_SIX),
      backend: 'webgpu',
    })
    try {
      expect(() => renderer.setOptions({ columns: 8, matcher: 'chromatic' })).toThrow(
        /no chromatic glyph data/,
      )
    } finally {
      renderer.destroy()
    }
  })
})
