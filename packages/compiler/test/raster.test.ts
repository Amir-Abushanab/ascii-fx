import { describe, expect, it } from 'vitest'
import type { FontPathCommand } from 'fontkit'
import { deriveMask, flattenCommands, maskTotals, rasterizeGlyph } from '@ascii-fx/compiler'

// Identity mapping: args are already 26.6 pixel-space (64 units = 1px).
const fx = { x: (v: number) => v, y: (v: number) => v }

const rect = (x0: number, y0: number, x1: number, y1: number, reverse = false): FontPathCommand[] => {
  const pts: Array<[number, number]> = reverse
    ? [
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
      ]
    : [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]
  return [
    { command: 'moveTo', args: pts[0] },
    { command: 'lineTo', args: pts[1] },
    { command: 'lineTo', args: pts[2] },
    { command: 'lineTo', args: pts[3] },
    { command: 'closePath', args: [] },
  ]
}

describe('raster-v1 scanline rasterizer', () => {
  it('full-cell square covers every pixel and mask bit', () => {
    const edges = flattenCommands(rect(0, 0, 512, 512), fx)
    const r = rasterizeGlyph(edges, 8, 8)
    expect(r.hits.every((h) => h === 16)).toBe(true)
    expect(r.totalHits).toBe(8 * 8 * 16)
    const mask = deriveMask(r.maskHits, maskTotals(8, 8))
    expect(mask.lo).toBe(0xffffffff)
    expect(mask.hi).toBe(0xffffffff)
  })

  it('left half-square produces the ▌ mask', () => {
    const edges = flattenCommands(rect(0, 0, 256, 512), fx)
    const r = rasterizeGlyph(edges, 8, 8)
    const mask = deriveMask(r.maskHits, maskTotals(8, 8))
    expect(mask.lo).toBe(0x0f0f0f0f)
    expect(mask.hi).toBe(0x0f0f0f0f)
    expect(r.totalHits).toBe(4 * 8 * 16)
  })

  it('opposite-winding inner contour cuts a hole (non-zero rule)', () => {
    const edges = flattenCommands([...rect(0, 0, 512, 512), ...rect(128, 128, 384, 384, true)], fx)
    const r = rasterizeGlyph(edges, 8, 8)
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const inHole = px >= 2 && px < 6 && py >= 2 && py < 6
        expect(r.hits[py * 8 + px], `pixel (${px},${py})`).toBe(inHole ? 0 : 16)
      }
    }
  })

  it('same-winding inner contour stays filled (winding 2)', () => {
    const edges = flattenCommands([...rect(0, 0, 512, 512), ...rect(128, 128, 384, 384)], fx)
    const r = rasterizeGlyph(edges, 8, 8)
    expect(r.hits.every((h) => h === 16)).toBe(true)
  })

  it('empty path rasterizes to nothing', () => {
    const r = rasterizeGlyph([], 8, 8)
    expect(r.totalHits).toBe(0)
    const mask = deriveMask(r.maskHits, maskTotals(8, 8))
    // all-zero hits with tie rule 2·0 ≥ 0 would set bits — totals are never 0
    expect(mask.lo).toBe(0)
    expect(mask.hi).toBe(0)
  })

  it('curve flattening is deterministic and hits exact endpoints', () => {
    const cmds: FontPathCommand[] = [
      { command: 'moveTo', args: [0, 0] },
      { command: 'quadraticCurveTo', args: [256, 512, 512, 0] },
      { command: 'closePath', args: [] },
    ]
    const a = flattenCommands(cmds, fx)
    const b = flattenCommands(cmds, fx)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    // last flattened segment ends exactly at (512, 0); the closing edge back to
    // (0,0) is horizontal and therefore dropped
    expect(a[a.length - 2]).toBe(512)
    expect(a[a.length - 1]).toBe(0)
  })
})
