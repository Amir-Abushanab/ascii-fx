import type { AsciiProfile } from './types.js'

/** Blank glyph per ALGORITHM.md §6: space if present, else minimum coverage (ties → lowest id). */
export function blankGlyphId(profile: AsciiProfile): number {
  const space = profile.glyphs.indexOf(' ')
  if (space >= 0) return space
  const { coverage } = profile.structural
  let best = 0
  for (let g = 1; g < profile.glyphCount; g++) {
    if (coverage[g] < coverage[best]) best = g
  }
  return best
}
