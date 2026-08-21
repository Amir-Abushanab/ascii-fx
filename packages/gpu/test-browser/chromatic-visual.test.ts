// Pixel-truth for chromatic compositing: what §C3 matched against must be what
// is drawn. The glyph-id conformance suite cannot see this — it compares
// captureFrame output, never canvas pixels — which is how the backdrop
// uniforms shipped unwired (matched over the backdrop, drawn over black).
import { describe, expect, it } from 'vitest'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { makeChromaticProfile, solid } from '../../core/test/synthetic.js'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator ? (await navigator.gpu.requestAdapter()) !== null : false

const GLYPH = [200, 40, 40, 128] as const // straight-alpha red, half transparent
const BACKDROP = [40, 80, 120] as const

/** The §C3 integer rule compositeFrame uses; GPU float math may differ by ~1. */
const over = (c: number, b: number): number => Math.round((c * GLYPH[3] + b * (255 - GLYPH[3])) / 255)

function grayImage(): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(32 * 32 * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128
    data[i + 1] = 128
    data[i + 2] = 128
    data[i + 3] = 255
  }
  return { width: 32, height: 32, data }
}

async function probePixels(canvas: OffscreenCanvas, prefill?: string): Promise<ImageData> {
  const probe = new OffscreenCanvas(canvas.width, canvas.height)
  const ctx = probe.getContext('2d') as OffscreenCanvasRenderingContext2D
  if (prefill) {
    ctx.fillStyle = prefill
    ctx.fillRect(0, 0, probe.width, probe.height)
  }
  ctx.drawImage(canvas, 0, 0)
  return ctx.getImageData(0, 0, probe.width, probe.height)
}

const px = (img: ImageData, x: number, y: number): number[] => {
  const p = (y * img.width + x) * 4
  return [img.data[p], img.data[p + 1], img.data[p + 2]]
}

const expectNear = (got: number[], want: number[], tol: number, label: string): void => {
  for (let c = 0; c < 3; c++) {
    expect(Math.abs(got[c] - want[c]), `${label} channel ${c}: got ${got}, want ${want}`).toBeLessThanOrEqual(tol)
  }
}

describe.runIf(gpuAvailable)('chromatic compositing draws the backdrop it matched against', () => {
  // Single-glyph palette: every non-transparent cell is that glyph, so cell
  // interiors are a known composite. Grid 4×4 of 8px cells centered on a
  // 64×32 canvas → letterbox columns at both sides show the clear color.
  it('opaque mode: cells blend over options.background and the letterbox is the backdrop', async () => {
    const profile = makeChromaticProfile([solid('o', GLYPH[0], GLYPH[1], GLYPH[2], GLYPH[3])])
    const canvas = new OffscreenCanvas(64, 32)
    const renderer = await createAsciiRenderer({
      canvas,
      profile,
      backend: 'webgpu',
      columns: 4,
      matcher: 'chromatic',
      alpha: 'ignore',
      background: [BACKDROP[0], BACKDROP[1], BACKDROP[2]],
    })
    try {
      renderer.setSource(grayImage())
      renderer.render()
      await (renderer as unknown as { device: GPUDevice }).device.queue.onSubmittedWorkDone()
      const img = await probePixels(canvas)
      const want = [over(GLYPH[0], BACKDROP[0]), over(GLYPH[1], BACKDROP[1]), over(GLYPH[2], BACKDROP[2])]
      expectNear(px(img, 32, 16), want, 3, 'cell interior')
      expectNear(px(img, 4, 16), [...BACKDROP], 2, 'letterbox')
    } finally {
      renderer.destroy()
    }
  })

  it("color: 'foreground' emits the glyph's own alpha for the page to composite", async () => {
    const profile = makeChromaticProfile([solid('o', GLYPH[0], GLYPH[1], GLYPH[2], GLYPH[3])])
    const canvas = new OffscreenCanvas(64, 32)
    const renderer = await createAsciiRenderer({
      canvas,
      profile,
      backend: 'webgpu',
      columns: 4,
      matcher: 'chromatic',
      color: 'foreground',
      alpha: 'ignore',
    })
    try {
      renderer.setSource(grayImage())
      renderer.render()
      await (renderer as unknown as { device: GPUDevice }).device.queue.onSubmittedWorkDone()
      const img = await probePixels(canvas, 'rgb(0 255 0)')
      const a = GLYPH[3] / 255
      const want = [
        Math.round(GLYPH[0] * a),
        Math.round(GLYPH[1] * a + 255 * (1 - a)),
        Math.round(GLYPH[2] * a),
      ]
      expectNear(px(img, 32, 16), want, 4, 'cell over page green')
      expectNear(px(img, 4, 16), [0, 255, 0], 2, 'letterbox stays the page')
    } finally {
      renderer.destroy()
    }
  })
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('chromatic visual test skipped — no adapter in this browser', () => {
    expect(gpuAvailable).toBe(false)
  })
})
