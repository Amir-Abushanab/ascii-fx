import { describe, expect, it } from 'vitest'
import type { AsciiProfile } from '@ascii-fx/core'
import {
  computeShape6,
  matchFrame,
  quantizeShape6,
  shape6BucketCenter,
} from '@ascii-fx/core'
import { STANDARD_SIX, makeCell, makeProfile, mulberry32, randomImage } from './synthetic.js'

/** Synthetic glyph vectors: identical formulas over mask bits × 255. */
const withShape6 = (base: AsciiProfile, lut = false): AsciiProfile => {
  const n = base.glyphCount
  const vectors6 = new Float32Array(n * 6)
  const pl = new Uint8Array(64)
  const desc = new Int32Array(6)
  for (let g = 0; g < n; g++) {
    for (let k = 0; k < 64; k++) {
      const bit = k < 32 ? (base.structural.masksLo[g] >>> k) & 1 : (base.structural.masksHi[g] >>> (k - 32)) & 1
      pl[k] = bit ? 255 : 0
    }
    computeShape6(pl, desc)
    for (let c = 0; c < 6; c++) vectors6[g * 6 + c] = desc[c]
  }
  let lut3: Uint16Array | undefined
  if (lut) {
    lut3 = new Uint16Array(8 ** 6)
    const center = new Float64Array(6)
    for (let idx = 0; idx < lut3.length; idx++) {
      shape6BucketCenter(idx, center)
      let best = 0
      let bestD = Infinity
      for (let g = 0; g < n; g++) {
        let d = 0
        for (let c = 0; c < 6; c++) {
          const e = center[c] - vectors6[g * 6 + c]
          d += e * e
        }
        if (d < bestD) {
          bestD = d
          best = g
        }
      }
      lut3[idx] = best
    }
  }
  return { ...base, shape6: { vectors6, lut3 } }
}

const profile6 = withShape6(makeProfile(STANDARD_SIX))
const topDarkBottomLight = makeCell((_, j) => (j < 4 ? [10, 10, 10] : [240, 240, 240]))

describe('shape6-v1 (ALGORITHM.md §18)', () => {
  it('bucket centers quantize back to their own index', () => {
    const center = new Float64Array(6)
    const centerI = new Int32Array(6)
    const rnd = mulberry32(5)
    for (let t = 0; t < 500; t++) {
      const idx = Math.floor(rnd() * 8 ** 6)
      shape6BucketCenter(idx, center)
      for (let c = 0; c < 6; c++) centerI[c] = center[c]
      expect(quantizeShape6(centerI), `index ${idx}`).toBe(idx)
    }
  })

  it('requires compiled shape6 data with a remediation message', () => {
    const bare = makeProfile(STANDARD_SIX)
    expect(() =>
      matchFrame(topDarkBottomLight, { profile: bare, columns: 1, rows: 1, matcher: 'shape6' }),
    ).toThrow(/shape6: true|--shape6/)
  })

  it('matches directional structure in full mode', () => {
    const frame = matchFrame(topDarkBottomLight, {
      profile: profile6,
      columns: 1,
      rows: 1,
      matcher: 'shape6',
      color: 'full',
    })
    const cell = frame.getCell(0, 0)
    expect(cell.glyphId).toBe(3) // '▄': ink-bright space puts ink on the bright bottom
    expect(cell.foreground).toEqual([240, 240, 240, 255])
    expect(cell.background).toEqual([10, 10, 10, 255])
  })

  it('derives polarity from the palette like the exact matcher', () => {
    const frame = matchFrame(topDarkBottomLight, {
      profile: profile6,
      columns: 1,
      rows: 1,
      matcher: 'shape6',
      color: 'mono',
      foreground: [0, 0, 0],
      background: [255, 255, 255],
    })
    expect(frame.getCell(0, 0).glyphId).toBe(2) // '▀': dark ink where the source is dark
  })

  it('keeps exact flat and transparent semantics', () => {
    const flat = matchFrame(
      makeCell(() => [128, 128, 128]),
      { profile: profile6, columns: 1, rows: 1, matcher: 'shape6', color: 'full' },
    )
    expect(flat.getCell(0, 0).glyphId).toBe(0)
    expect(flat.getCell(0, 0).foreground).toEqual([128, 128, 128, 255])
    const clear = matchFrame(
      makeCell(() => [10, 10, 10, 0]),
      { profile: profile6, columns: 1, rows: 1, matcher: 'shape6', color: 'full' },
    )
    expect(clear.getCell(0, 0).flags & 2).toBe(2)
  })

  it('LUT path stays close to brute force and is deterministic', () => {
    const withLut = withShape6(makeProfile(STANDARD_SIX), true)
    const img = randomImage(80, 48, 31)
    const brute = matchFrame(img, { profile: profile6, columns: 10, matcher: 'shape6', color: 'full' })
    const lut = matchFrame(img, { profile: withLut, columns: 10, matcher: 'shape6', color: 'full' })
    const lut2 = matchFrame(img, { profile: withLut, columns: 10, matcher: 'shape6', color: 'full' })
    expect(lut2.glyphIds).toEqual(lut.glyphIds)
    let agree = 0
    for (let i = 0; i < brute.glyphIds.length; i++) if (brute.glyphIds[i] === lut.glyphIds[i]) agree++
    expect(agree / brute.glyphIds.length).toBeGreaterThan(0.85)
  })
})

describe('ramp-v1 (ALGORITHM.md §19)', () => {
  it('maps mean luma to coverage regardless of structure', () => {
    const frame = matchFrame(
      makeCell((i) => (i < 4 ? [20, 20, 20] : [235, 235, 235])),
      { profile: profile6, columns: 1, rows: 1, matcher: 'ramp', color: 'mono' },
    )
    const cell = frame.getCell(0, 0)
    expect(cell.flags & 1).toBe(0) // genuinely non-flat cell
    expect(cell.glyphId).toBe(2) // meanL≈128 → coverage 32768, first at id 2
  })

  it('is deterministic and works in full color', () => {
    const img = randomImage(64, 64, 9)
    const a = matchFrame(img, { profile: profile6, columns: 8, matcher: 'ramp', color: 'full' })
    const b = matchFrame(img, { profile: profile6, columns: 8, matcher: 'ramp', color: 'full' })
    expect(b.glyphIds).toEqual(a.glyphIds)
    expect(b.foreground).toEqual(a.foreground)
  })
})
