// subsetProfile: a derived profile must carry each glyph's raster data
// exactly and match identically to a profile built directly from the subset.
import { describe, expect, it } from 'vitest'
import { matchFrame, subsetProfile } from '@ascii-fx/core'
import { G_BOTTOM, G_FULL, G_LEFT, G_RIGHT, G_SPACE, G_TOP, STANDARD_SIX, makeProfile, randomImage } from './synthetic.js'

const tile = (p: ReturnType<typeof makeProfile>, id: number): Uint8Array => {
  const { atlas } = p
  const out = new Uint8Array(atlas.pitchWidth * atlas.pitchHeight)
  const sx = (id % atlas.columns) * atlas.pitchWidth
  const sy = Math.floor(id / atlas.columns) * atlas.pitchHeight
  for (let y = 0; y < atlas.pitchHeight; y++) {
    out.set(atlas.data.subarray((sy + y) * atlas.width + sx, (sy + y) * atlas.width + sx + atlas.pitchWidth), y * atlas.pitchWidth)
  }
  return out
}

describe('subsetProfile', () => {
  const full = makeProfile(STANDARD_SIX)

  it('remaps ids in the given order and carries raster data exactly', () => {
    const sub = subsetProfile(full, [' ', '▐', '▀'].join(''))
    expect(sub.glyphs).toEqual([' ', '▐', '▀'])
    expect(sub.glyphCount).toBe(3)
    const oldIds = [' ', '▐', '▀'].map((c) => full.glyphs.indexOf(c))
    oldIds.forEach((oldId, i) => {
      expect(sub.structural.masksLo[i]).toBe(full.structural.masksLo[oldId])
      expect(sub.structural.masksHi[i]).toBe(full.structural.masksHi[oldId])
      expect(sub.structural.coverage[i]).toBe(full.structural.coverage[oldId])
      expect(tile(sub, i)).toEqual(tile(full, oldId))
    })
    expect(sub.fingerprint).not.toBe(full.fingerprint)
    expect(sub.metrics).toEqual(full.metrics)
  })

  it('matches bit-identically to a profile built directly from the subset', () => {
    const chars = [G_SPACE, G_TOP, G_BOTTOM]
    const direct = makeProfile(chars)
    const sub = subsetProfile(full, chars.map((g) => g.char).join(''))
    const src = randomImage(64, 32, 7)
    const a = matchFrame(src, { profile: direct, columns: 8, color: 'full' })
    const b = matchFrame(src, { profile: sub, columns: 8, color: 'full' })
    expect(b.glyphIds).toEqual(a.glyphIds)
    expect(b.foreground).toEqual(a.foreground)
    expect(b.background).toEqual(a.background)
    expect(b.flags).toEqual(a.flags)
  })

  it('only emits allowed glyphs', () => {
    const sub = subsetProfile(full, [G_FULL.char, G_LEFT.char, G_RIGHT.char].join(''))
    const frame = matchFrame(randomImage(96, 48, 3), { profile: sub, columns: 12, color: 'foreground' })
    for (const id of frame.glyphIds) expect(id).toBeLessThan(3)
  })

  it('rejects empty, duplicate, and unknown characters', () => {
    expect(() => subsetProfile(full, '')).toThrow(/empty/)
    expect(() => subsetProfile(full, '▀▀')).toThrow(/duplicate/)
    expect(() => subsetProfile(full, ' Q')).toThrow(/no glyph "Q"/)
  })
})
