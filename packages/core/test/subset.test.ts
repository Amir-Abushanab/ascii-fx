// subsetProfile: a derived profile must carry each glyph's raster data
// exactly and match identically to a profile built directly from the subset.
import { describe, expect, it } from 'vitest'
import { matchFrame, subsetProfile } from '@ascii-fx/core'
import { G_BOTTOM, G_FULL, G_LEFT, G_RIGHT, G_SPACE, G_TOP, STANDARD_SIX, makeChromaticProfile, makeProfile, randomImage, solid } from './synthetic.js'

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
    expect(() => subsetProfile(full, ' Q')).toThrow(/no glyph matching "Q" \(position 1\)/)
    expect(() => subsetProfile(full, [' ', 'Q'])).toThrow(/no glyph "Q"/)
  })
})

// The string form is segmented by the profile's own glyph strings (greedy
// longest match), which is what lets it express the multi-code-point emoji
// glyphs chromatic palettes contain — Array.from would split a VS16 heart
// into a heart and an invisible selector.
describe('subsetProfile string form (grapheme glyphs)', () => {
  const HEART = '❤️' // U+2764 U+FE0F
  const SUN = '☀️' // U+2600 U+FE0F
  const WAVE = '🌊'
  const FAMILY = '👨‍👩‍👧' // ZWJ sequence, 8 code units
  const row = (bits: string): string[] => Array(8).fill(bits)
  const emoji = makeProfile([
    { char: ' ', rows: row('00000000') },
    { char: HEART, rows: row('11111111') },
    { char: SUN, rows: row('11110000') },
    { char: WAVE, rows: row('00001111') },
    { char: FAMILY, rows: [...Array(4).fill('11111111'), ...Array(4).fill('00000000')] },
  ])

  it('selects multi-code-point glyphs by longest match, in string order', () => {
    const sub = subsetProfile(emoji, `${FAMILY}${HEART}${WAVE}`)
    expect(sub.glyphs).toEqual([FAMILY, HEART, WAVE])
  })

  it('is identical to the array form', () => {
    const viaArray = subsetProfile(emoji, [HEART, SUN])
    const viaString = subsetProfile(emoji, `${HEART}${SUN}`)
    expect(viaString.glyphs).toEqual(viaArray.glyphs)
    expect(viaString.structural.masksLo).toEqual(viaArray.structural.masksLo)
    expect(viaString.fingerprint).toBe(viaArray.fingerprint)
  })

  it('rejects duplicates by glyph, not by code point', () => {
    // Two VS16 emoji share U+FE0F; per-code-point splitting called that a
    // duplicate of an invisible character. As glyphs they are distinct.
    expect(subsetProfile(emoji, `${HEART}${SUN}`).glyphCount).toBe(2)
    expect(() => subsetProfile(emoji, `${HEART}${SUN}${HEART}`)).toThrow(/duplicate character/)
  })

  it('rejects unmatchable input with position context', () => {
    expect(() => subsetProfile(emoji, `${HEART}X`)).toThrow(/no glyph matching "X" \(position 2\)/)
    // A bare heart without the variation selector is not the stored glyph.
    expect(() => subsetProfile(emoji, '❤')).toThrow(/no glyph matching/)
  })

  it('prefers the longest glyph when one is a prefix of another', () => {
    const p = makeProfile([
      { char: 'a', rows: row('10000000') },
      { char: 'ab', rows: row('11000000') },
      { char: 'b', rows: row('01000000') },
    ])
    expect(subsetProfile(p, 'ab').glyphs).toEqual(['ab'])
    expect(subsetProfile(p, 'ba').glyphs).toEqual(['b', 'a'])
  })

  it('gives distinct fingerprints to subsets whose glyphs share a first code point', () => {
    const skin = makeProfile([
      { char: '👍🏻', rows: row('11111111') },
      { char: '👍🏿', rows: row('00001111') },
      { char: ' ', rows: row('00000000') },
    ])
    const a = subsetProfile(skin, ['👍🏻', ' '])
    const b = subsetProfile(skin, ['👍🏿', ' '])
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('narrows a chromatic palette via the string form, samples in lockstep', () => {
    const p = makeChromaticProfile([solid(HEART, 200, 30, 30), solid(WAVE, 30, 90, 200), solid(' ', 0, 0, 0, 0)])
    const sub = subsetProfile(p, `${WAVE}${HEART}`)
    expect(sub.glyphs).toEqual([WAVE, HEART])
    const idOf = (g: string): number => p.glyphs.indexOf(g)
    const expected = new Uint8Array(2 * 256)
    expected.set(p.chromatic!.samples.subarray(idOf(WAVE) * 256, idOf(WAVE) * 256 + 256), 0)
    expected.set(p.chromatic!.samples.subarray(idOf(HEART) * 256, idOf(HEART) * 256 + 256), 256)
    expect(sub.chromatic!.samples).toEqual(expected)
  })
})
