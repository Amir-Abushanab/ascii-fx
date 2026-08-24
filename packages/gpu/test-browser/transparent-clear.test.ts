// A clearColor with alpha < 1 has to actually present transparent — in every colour
// mode, on both backends, and inside the grid, not just in the letterbox.
//
// This regressed in two halves. First the canvas: alphaMode was keyed on
// `color === 'foreground'`, so in mono/full the compositor discarded the alpha channel
// on present. 0.3.0 fixed that by keying alphaMode on the output (outputCanBeTransparent),
// but left the frame itself opaque: the base composite still baked mono's background
// plane into every cell, so a mono overlay presented as a slab that was transparent only
// in the letterbox — the canvas said "see-through" while no in-grid pixel was. Both
// decisions now key on the same predicate. `full` is the deliberate exception: its
// background plane is per-cell sampled content, not a backdrop, so its cells stay opaque
// and transparency comes from `alpha: 'mask'` cells and the letterbox alone.
import { describe, expect, it } from 'vitest'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import type { AsciiRendererOptions } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile } from '../../core/test/synthetic.js'

/** Flat opaque gray-level source: luma 0 picks the blank glyph, luma 255 the full block. */
const flatSource = (n: number, v: number) => ({
  width: n,
  height: n,
  data: new Uint8Array(n * n * 4).map((_, i) => (i % 4 === 3 ? 255 : v)),
})

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

/** The known light page the canvas is composited over — visible wherever it is transparent. */
const PAGE = [250, 250, 249] as const

// 160×48 canvas, square source, 8 columns of 8px cells → the 64×64 grid contains to
// 48×48 of 6px screen cells at x∈[56,104]. (83, 27) is the CENTER of a cell — (80, 24)
// would sit on a 4-cell corner, where the GPU's mip-sampled tile edge legitimately
// anti-aliases. (4, 24) is letterbox.
const IN_GRID = [83, 27] as const
const LETTERBOX = [4, 24] as const

interface Presented {
  /** RGB after compositing over the PAGE color, as the browser would. */
  overPage: (x: number, y: number) => number[]
  /** Alpha as presented, no page underneath. */
  alpha: (x: number, y: number) => number
  minAlpha: number
}

async function present(
  options: Partial<AsciiRendererOptions>,
  sourceLuma: number,
): Promise<Presented> {
  const canvas = new OffscreenCanvas(160, 48)
  const renderer = await createAsciiRenderer({
    canvas,
    profile: makeProfile(STANDARD_SIX),
    columns: 8,
    ...options,
  })
  try {
    renderer.setSource(flatSource(64, sourceLuma))
    renderer.render()
    await new Promise((r) => requestAnimationFrame(r))
    const read = (prefill: boolean): ImageData => {
      const probe = new OffscreenCanvas(canvas.width, canvas.height)
      const ctx = probe.getContext('2d') as OffscreenCanvasRenderingContext2D
      if (prefill) {
        ctx.fillStyle = `rgb(${PAGE[0]} ${PAGE[1]} ${PAGE[2]})`
        ctx.fillRect(0, 0, probe.width, probe.height)
      }
      ctx.drawImage(canvas, 0, 0)
      return ctx.getImageData(0, 0, probe.width, probe.height)
    }
    const composited = read(true)
    const bare = read(false)
    let minAlpha = 255
    for (let i = 3; i < bare.data.length; i += 4)
      if (bare.data[i] < minAlpha) minAlpha = bare.data[i]
    return {
      overPage: (x, y) => {
        const p = (y * composited.width + x) * 4
        return [composited.data[p], composited.data[p + 1], composited.data[p + 2]]
      },
      alpha: (x, y) => bare.data[(y * bare.width + x) * 4 + 3],
      minAlpha,
    }
  } finally {
    renderer.destroy()
  }
}

const expectNear = (got: number[], want: readonly number[], tol: number, label: string): void => {
  for (let c = 0; c < 3; c++) {
    expect(
      Math.abs(got[c] - want[c]),
      `${label} channel ${c}: got ${got}, want ${[...want]}`,
    ).toBeLessThanOrEqual(tol)
  }
}

function transparentClearSuite(backend: 'webgpu' | 'cpu'): void {
  const CLEAR0 = [0, 0, 0, 0] as const

  it('mono: a transparent clearColor drops the ground inside the grid, not just the letterbox', async () => {
    const p = await present({ backend, color: 'mono', clearColor: CLEAR0 }, 0)
    // Every cell is the blank glyph, so the page must show through the whole canvas.
    expectNear(p.overPage(...IN_GRID), PAGE, 1, 'in-grid over page')
    expectNear(p.overPage(...LETTERBOX), PAGE, 1, 'letterbox over page')
    expect(p.minAlpha, 'whole canvas presents transparent').toBe(0)
  })

  it('mono: glyph ink still draws opaque in the fixed foreground over the transparent ground', async () => {
    const p = await present(
      { backend, color: 'mono', clearColor: CLEAR0, foreground: [0, 255, 128] },
      255,
    )
    // Luma 255 picks the full block: solid ink in the grid, page in the letterbox.
    expectNear(p.overPage(...IN_GRID), [0, 255, 128], 1, 'ink over page')
    expect(p.alpha(...IN_GRID), 'ink is opaque').toBe(255)
    expectNear(p.overPage(...LETTERBOX), PAGE, 1, 'letterbox over page')
  })

  it('full: cells keep their per-cell sampled background — content, not a backdrop', async () => {
    const p = await present({ backend, color: 'full', clearColor: CLEAR0 }, 0)
    expectNear(p.overPage(...IN_GRID), [0, 0, 0], 1, 'sampled black cell stays opaque')
    expect(p.alpha(...IN_GRID)).toBe(255)
    expectNear(p.overPage(...LETTERBOX), PAGE, 1, 'letterbox over page')
  })

  it('foreground: transparent by definition, with or without clearColor', async () => {
    const p = await present({ backend, color: 'foreground', clearColor: CLEAR0 }, 0)
    expectNear(p.overPage(...IN_GRID), PAGE, 1, 'in-grid over page')
    expect(p.minAlpha).toBe(0)
  })

  it('mono: no clearColor keeps the fully opaque canvas (the fast path)', async () => {
    const p = await present({ backend, color: 'mono' }, 0)
    expect(p.minAlpha, 'no pixel may present transparent').toBe(255)
    expectNear(p.overPage(...IN_GRID), [0, 0, 0], 1, 'default black background')
  })
}

describe.runIf(gpuAvailable)('transparent clearColor (webgpu)', () => {
  transparentClearSuite('webgpu')
})

describe('transparent clearColor (cpu)', () => {
  transparentClearSuite('cpu')
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('webgpu transparent clearColor skipped — no adapter', () => {
    expect(gpuAvailable).toBe(false)
  })
})
