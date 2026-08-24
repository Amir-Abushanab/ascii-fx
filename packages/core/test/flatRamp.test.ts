// §6 flat path: mean luma maps onto glyph ink coverage, and the ceiling of that ramp has
// to be the densest glyph the profile actually has.
//
// It used to be a fixed 65535 — the coverage a fully-inked cell would score. No ASCII
// glyph is fully inked: '@' in Geist Mono covers 16906/65535 (26%). So every flat cell
// above ~26% luma targeted a coverage no glyph could reach and clamped to '@', collapsing
// roughly two thirds of the luma range onto one glyph. These pin that the ramp spans the
// range the profile can actually express.
import { describe, expect, it } from 'vitest'
import { matchFrame } from '@ascii-fx/core'
import { makeCell, makeProfile } from './synthetic.js'

/**
 * A charset shaped like a real ASCII one: the densest glyph is nowhere near fully inked.
 * Rows of n set bits give n/8 coverage, so this tops out at 16/64 = 25% — almost exactly
 * where Geist Mono's '@' lands (16906/65535). A block charset would hide the bug, because
 * '█' covers the full 65535 and the old fixed ceiling happened to be correct for it.
 */
const SPARSE = [
  { char: ' ', rows: Array(8).fill('00000000') },
  { char: '.', rows: [...Array(7).fill('00000000'), '10000000'] },
  {
    char: ':',
    rows: [...Array(3).fill('00000000'), '10000000', ...Array(3).fill('00000000'), '10000000'],
  },
  { char: '-', rows: [...Array(4).fill('00000000'), '11110000', ...Array(3).fill('00000000')] },
  { char: '+', rows: [...Array(3).fill('00100000'), '11111000', ...Array(4).fill('00100000')] },
  { char: '#', rows: Array(8).fill('10100000') },
  { char: '@', rows: Array(8).fill('11000000') },
]

const flat = (v: number) => makeCell(() => [v, v, v])

/** The glyph a flat cell of this luma matches, in mono. */
const pickAt = (profile: ReturnType<typeof makeProfile>, v: number): string => {
  const frame = matchFrame(flat(v), { profile, columns: 1, rows: 1, color: 'mono' })
  return profile.glyphs[frame.getCell(0, 0).glyphId]
}

describe('flat path ramp (§6)', () => {
  const profile = makeProfile(SPARSE)

  it('uses the whole glyph range rather than saturating on the densest one', () => {
    const picks = [0, 32, 64, 96, 128, 160, 192, 224, 255].map((v) => pickAt(profile, v))
    // The bug: everything above the ceiling collapsed onto the densest glyph.
    const densest = picks.at(-1)
    expect(picks.filter((g) => g === densest).length).toBeLessThan(picks.length - 2)
    expect(new Set(picks).size).toBeGreaterThan(2)
  })

  it('is monotonic in luma: brighter never picks less ink', () => {
    const { coverage } = profile.structural
    const inkOf = (v: number): number => {
      const frame = matchFrame(flat(v), { profile, columns: 1, rows: 1, color: 'mono' })
      return coverage[frame.getCell(0, 0).glyphId]
    }
    let prev = -1
    for (let v = 0; v <= 255; v += 15) {
      const ink = inkOf(v)
      expect(ink).toBeGreaterThanOrEqual(prev)
      prev = ink
    }
  })

  it('reaches the densest glyph at full luma and the blank at zero', () => {
    const { coverage } = profile.structural
    let densestId = 0
    for (let g = 0; g < profile.glyphCount; g++) {
      if (coverage[g] > coverage[densestId]) densestId = g
    }
    expect(pickAt(profile, 255)).toBe(profile.glyphs[densestId])
    expect(coverage[profile.glyphs.indexOf(pickAt(profile, 0))]).toBe(0)
  })
})
