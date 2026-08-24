// A clearColor with alpha < 1 has to actually present transparent, in every colour mode.
//
// It used to only work in color: 'foreground'. The canvas was configured
// `alphaMode: color === 'foreground' ? 'premultiplied' : 'opaque'`, so in mono/full the
// compositor was told the canvas is opaque and the alpha channel was discarded on
// present — a documented option silently ignored in three of four modes. The renderer now
// configures from whether the output can be transparent, not from the colour mode.
import { describe, expect, it } from 'vitest'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile } from '../../core/test/synthetic.js'

/** Solid black: every cell is flat at luma 0, so every cell picks the blank glyph. */
const blackSource = (n: number) => ({
  width: n,
  height: n,
  data: new Uint8Array(n * n * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)),
})

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

/** Alpha of the presented canvas, read back through a 2D context. */
async function presentedAlpha(color: 'mono' | 'full' | 'foreground'): Promise<number> {
  const canvas = document.createElement('canvas')
  // Deliberately a different aspect from the square source: with fit 'contain' that
  // pillarboxes, and the bars are clear-colour only. In mono and full every *cell* carries
  // an opaque background by construction, so the letterbox is the only place clearColor is
  // visible — which is exactly the region an opaque canvas used to paint black.
  canvas.width = 160
  canvas.height = 48
  const renderer = await createAsciiRenderer({
    canvas,
    profile: makeProfile(STANDARD_SIX),
    columns: 8,
    color,
    clearColor: [0, 0, 0, 0],
  })
  try {
    renderer.setSource(blackSource(64))
    renderer.render()
    await new Promise((r) => requestAnimationFrame(r))
    // Minimum alpha over the whole canvas. An opaque context reports 255 everywhere by
    // definition, so anything below it proves the alpha channel actually survived present.
    const probe = document.createElement('canvas')
    probe.width = canvas.width
    probe.height = canvas.height
    const ctx = probe.getContext('2d')!
    ctx.clearRect(0, 0, probe.width, probe.height)
    ctx.drawImage(canvas, 0, 0)
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height)
    let min = 255
    for (let i = 3; i < data.length; i += 4) if (data[i] < min) min = data[i]
    return min
  } finally {
    renderer.destroy()
  }
}

describe.runIf(gpuAvailable)('transparent clearColor', () => {
  it('presents transparent in foreground mode', async () => {
    expect(await presentedAlpha('foreground')).toBeLessThan(255)
  })

  it('presents transparent in mono mode too', async () => {
    expect(await presentedAlpha('mono')).toBeLessThan(255)
  })

  it('presents transparent in full mode too', async () => {
    expect(await presentedAlpha('full')).toBeLessThan(255)
  })
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('transparent clearColor skipped — no adapter', () => {
    expect(gpuAvailable).toBe(false)
  })
})
