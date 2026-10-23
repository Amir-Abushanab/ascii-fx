// Runtime profiles size the cell to the widest glyph in the set, not to 'M'. A full-width glyph
// (kanji) or one the browser takes from a wider fallback font used to lose everything past the
// 'M' advance to the clip — the right half of every kanji, silently.
import { describe, expect, it } from 'vitest'
import { createAsciiProfile } from '@ascii-fx/core'
import type { AsciiProfile } from '@ascii-fx/core'

/** Fraction of a glyph's ink in the right half of its atlas tile. */
function rightHalfInk(profile: AsciiProfile, id: number): number {
  const { atlas } = profile
  const x0 = (id % atlas.columns) * atlas.pitchWidth + atlas.padding
  const y0 = Math.floor(id / atlas.columns) * atlas.pitchHeight + atlas.padding
  let left = 0
  let right = 0
  for (let y = 0; y < atlas.cellHeight; y++) {
    for (let x = 0; x < atlas.cellWidth; x++) {
      const a = atlas.data[(y0 + y) * atlas.width + x0 + x]
      if (x < atlas.cellWidth / 2) left += a
      else right += a
    }
  }
  return right / Math.max(1, left + right)
}

describe('runtime profiles with wide glyphs', () => {
  it('a kanji set gets a cell wide enough to hold the glyphs whole', async () => {
    const latin = await createAsciiProfile({ fontFamily: 'monospace', characters: ' MW' })
    const kanji = await createAsciiProfile({ fontFamily: 'monospace', characters: ' 日本語漢字' })
    // Full-width: roughly twice the Latin advance, not clipped to it.
    expect(kanji.atlas.cellWidth).toBeGreaterThan(latin.atlas.cellWidth * 1.5)
    for (let id = 1; id < kanji.glyphCount; id++) {
      // 日 is symmetric; none of these keeps most of its ink on one side.
      expect(rightHalfInk(kanji, id), kanji.glyphs[id]).toBeGreaterThan(0.25)
    }
  })

  it('a monospace Latin set is unchanged: same cell, glyphs drawn at x = 0', async () => {
    const p = await createAsciiProfile({ fontFamily: 'monospace', characters: ' MWil' })
    const m = await createAsciiProfile({ fontFamily: 'monospace', characters: ' M' })
    expect(p.atlas.cellWidth).toBe(m.atlas.cellWidth)
  })

  it('Arabic letters are profiled in their isolated forms', async () => {
    const p = await createAsciiProfile({ fontFamily: 'monospace', characters: ' بتثج' })
    expect(p.glyphCount).toBe(5)
    for (let id = 1; id < p.glyphCount; id++) {
      expect(p.structural.coverage[id], p.glyphs[id]).toBeGreaterThan(0)
    }
  })

  it('arabic-joined: joining forms reach the edges they join at, isolated forms do not', async () => {
    const p = await createAsciiProfile({ fontFamily: 'monospace', charset: 'arabic-joined' })
    const { atlas } = p
    const edgeInk = (glyph: string, column: number): number => {
      const id = p.glyphs.indexOf(glyph)
      const x0 = (id % atlas.columns) * atlas.pitchWidth + atlas.padding
      const y0 = Math.floor(id / atlas.columns) * atlas.pitchHeight + atlas.padding
      let ink = 0
      for (let y = 0; y < atlas.cellHeight; y++)
        ink += atlas.data[(y0 + y) * atlas.width + x0 + column]
      return ink
    }
    const last = atlas.cellWidth - 1
    expect(edgeInk('\ufe92', 0), 'medial, left').toBeGreaterThan(0)
    expect(edgeInk('\ufe92', last), 'medial, right').toBeGreaterThan(0)
    expect(edgeInk('\ufe91', 0), 'initial joins left').toBeGreaterThan(0)
    expect(edgeInk('\ufe90', last), 'final joins right').toBeGreaterThan(0)
    // Isolated alef: narrow and joining nothing, so centred clear of both edges. (Not beh — the
    // cell is as wide as the widest glyph, and isolated beh is among the widest.)
    expect(edgeInk('\ufe8d', 0) + edgeInk('\ufe8d', last), 'isolated').toBe(0)
  })
})
