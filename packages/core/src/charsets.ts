const ASCII = (() => {
  let s = ''
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c)
  return s
})()

// Halves, full and shades first, then the ten quadrant blocks.
const BLOCKS = '▀▄█▌▐░▒▓▖▗▘▙▚▛▜▝▞▟'

const range = (from: number, to: number): string => {
  let s = ''
  for (let c = from; c <= to; c++) s += String.fromCodePoint(c)
  return s
}

// Space, then the whole Block Elements block in code-point order: eighths,
// halves, shades and quadrants. A mosaic look with no letterforms in it.
const BLOCK_ELEMENTS = ' ' + range(0x2580, 0x259f)

// All 256 eight-dot patterns. U+2800 is the empty pattern and stands in for
// space, so none is added: each dot sits in a 2×4 grid that the 8×8 mask
// resolves exactly, which is what makes this set read as fine detail.
const BRAILLE = range(0x2800, 0x28ff)

// Arabic, from Presentation Forms-B: each letter's shapes as separate code points, so a cell holds
// one specific form and a text viewer shows it as written instead of re-shaping it against its
// neighbours (which would also change it from what the canvas drew). Fonts that leave this block
// unmapped get it from the browser's fallback at runtime, and fail the compiler's coverage check.
//
// Isolated forms only: letters that never join. The first form of each letter's group.
const ARABIC_ISOLATED = [
  0xfe80, 0xfe81, 0xfe83, 0xfe85, 0xfe87, 0xfe89, 0xfe8d, 0xfe8f, 0xfe93, 0xfe95, 0xfe99, 0xfe9d,
  0xfea1, 0xfea5, 0xfea9, 0xfeab, 0xfead, 0xfeaf, 0xfeb1, 0xfeb5, 0xfeb9, 0xfebd, 0xfec1, 0xfec5,
  0xfec9, 0xfecd, 0xfed1, 0xfed5, 0xfed9, 0xfedd, 0xfee1, 0xfee5, 0xfee9, 0xfeed, 0xfeef, 0xfef1,
  0xfef5, 0xfef7, 0xfef9, 0xfefb,
]
  .map((c) => String.fromCodePoint(c))
  .join('')

// Every positional form, isolated, final, initial and medial (U+FE80..U+FEFC), plus tatweel, the
// bare joining stroke. With forms that reach the cell edges available, the matcher can pick ones
// whose strokes run into their neighbours: joined script where the picture calls for it.
const ARABIC_JOINED = '\u0640' + range(0xfe80, 0xfefc)

export const BUILTIN_CHARSETS: Readonly<Record<string, string>> = {
  ascii: ASCII,
  'ascii-blocks': ASCII + BLOCKS,
  blocks: BLOCK_ELEMENTS,
  braille: BRAILLE,
  arabic: ' ' + ARABIC_ISOLATED,
  'arabic-joined': ' ' + ARABIC_JOINED,
}

export interface ResolvedCharset {
  name: string
  glyphs: string[]
}

/**
 * A string's glyphs: its extended grapheme clusters (UAX #29), so that what a reader sees as one
 * character is one glyph — a Devanagari conjunct, a letter with a combining mark, an emoji with
 * its modifier. Falls back to code points where Intl.Segmenter is missing.
 */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter().segment(text), (s) => s.segment)
  }
  return Array.from(text)
}

/**
 * Resolve a built-in charset name or custom characters into glyphs (ALGORITHM.md §12). A string
 * is split into grapheme clusters; an array's elements are taken whole, one glyph each, which is
 * how to give a glyph a segmenter would split or join differently — a letter with a ZERO WIDTH
 * JOINER before it, say. Duplicates are an error (spec §43).
 */
export function resolveCharset(
  charset?: string,
  characters?: string | readonly string[],
): ResolvedCharset {
  if (characters !== undefined) {
    const glyphs = typeof characters === 'string' ? graphemes(characters) : [...characters]
    if (glyphs.some((g) => g === '')) throw new Error('Custom character set has an empty glyph.')
    if (glyphs.length === 0) throw new Error('Custom character set is empty.')
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const g of glyphs) {
      if (seen.has(g)) dupes.add(g)
      seen.add(g)
    }
    if (dupes.size > 0) {
      throw new Error(
        `Character set contains duplicate glyphs: ${[...dupes]
          .map((c) => JSON.stringify(c))
          .join(', ')}`,
      )
    }
    return { name: 'custom', glyphs }
  }
  const name = charset ?? 'ascii'
  const set = BUILTIN_CHARSETS[name]
  if (set === undefined) {
    throw new Error(
      `Unknown charset ${JSON.stringify(name)}. Built-ins: ${Object.keys(BUILTIN_CHARSETS).join(', ')}. ` +
        'Pass `characters` for a custom set.',
    )
  }
  return { name, glyphs: Array.from(set) }
}
