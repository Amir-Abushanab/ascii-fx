// Pixel-truth test: the composite must draw glyph SHAPES, not solid blocks.
// A dense ASCII glyph covers ~10–25% of its cell; a block-rendering bug lights
// ~100%. Asserts on real canvas pixels with the real Geist Mono atlas.
import { describe, expect, it } from 'vitest'
import { decodeProfile } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import profileUrl from '../../../fixtures/profiles/default.asciip?url'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator ? (await navigator.gpu.requestAdapter()) !== null : false

describe.runIf(gpuAvailable)('composite renders glyph shapes (not blocks)', () => {
  it('mono cells show partial ink coverage and internal structure', async () => {
    const res = await fetch(profileUrl)
    const profile = decodeProfile(new Uint8Array(await res.arrayBuffer()))

    // 32×16 source, left half black, right half white → grid 4×1 in mono:
    // black cells → space, white cells → the densest glyph.
    const data = new Uint8Array(32 * 16 * 4)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const v = x < 16 ? 0 : 255
        const p = (y * 32 + x) * 4
        data[p] = v
        data[p + 1] = v
        data[p + 2] = v
        data[p + 3] = 255
      }
    }

    const canvas = new OffscreenCanvas(480, 256)
    const renderer = await createAsciiRenderer({
      canvas,
      profile,
      backend: 'webgpu',
      columns: 4,
      color: 'mono',
      fit: 'contain',
    })
    try {
      renderer.setSource({ width: 32, height: 16, data })
      renderer.render()
      await (renderer as unknown as { device: GPUDevice }).device.queue.onSubmittedWorkDone()

      const probe = new OffscreenCanvas(480, 256)
      const ctx = probe.getContext('2d')!
      ctx.drawImage(canvas, 0, 0)
      const img = ctx.getImageData(0, 0, 480, 256)

      const grid = renderer.grid()!
      expect(grid).toEqual({ columns: 4, rows: 1 })
      const cellW = 480 / 4
      const litFraction = (cell: number): number => {
        let lit = 0
        let total = 0
        for (let y = 8; y < 248; y += 2) {
          for (let x = cell * cellW + 8; x < (cell + 1) * cellW - 8; x += 2) {
            total++
            if (img.data[(y * 480 + Math.floor(x)) * 4] > 128) lit++
          }
        }
        return lit / total
      }
      const dark = litFraction(0)
      const bright = litFraction(3)
      expect(dark, 'black source cell should be near-empty').toBeLessThan(0.02)
      expect(bright, 'white source cell must not be a solid block').toBeLessThan(0.6)
      expect(bright, 'white source cell must contain visible ink').toBeGreaterThan(0.04)

      // Internal structure: a horizontal scan through the bright cell must
      // cross ink↔background edges several times (a block has ~0 transitions).
      let transitions = 0
      const y = 128
      let prev = img.data[(y * 480 + Math.floor(3 * cellW + 8)) * 4] > 128
      for (let x = 3 * cellW + 8; x < 4 * cellW - 8; x++) {
        const cur = img.data[(y * 480 + Math.floor(x)) * 4] > 128
        if (cur !== prev) transitions++
        prev = cur
      }
      expect(transitions, 'glyph edges inside the cell').toBeGreaterThanOrEqual(2)
    } finally {
      renderer.destroy()
    }
  })
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('visual suite skipped — no adapter', () => {
    expect(gpuAvailable).toBe(false)
  })
})
