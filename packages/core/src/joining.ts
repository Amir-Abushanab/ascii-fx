import { ARABIC_PRESENTATION_CONTEXT } from './arabicForms.js'

// Which side of its cell a glyph joins its neighbour on, for scripts whose letters connect. A
// glyph is centred in its cell (ALGORITHM.md §13); a joining form is pushed to the edge it joins
// at instead, so its connecting stroke reaches the next cell and adjacent forms meet.

const ZWJ = '\u200d'
const TATWEEL = '\u0640'

/** Scripts whose joining runs right to left, so a form joining "before" joins on its right. */
const RTL_JOINING =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mandaic}\p{Script=Adlam}]/u

/**
 * The visual side(s) of its cell a glyph joins on: 'left', 'right', 'both', or null for a glyph
 * that stands alone. A presentation form says so through its shaping context; any other
 * right-to-left glyph says so directly with ZERO WIDTH JOINER — before the letter joins the preceding letter, which sits to the
 * right; after it joins the following one, to the left.
 */
export function joiningSide(glyph: string): 'left' | 'right' | 'both' | null {
  if (glyph === TATWEEL) return 'both'
  const text = shapingText(glyph)
  if (!RTL_JOINING.test(text)) return null
  const before = text.startsWith(ZWJ)
  const after = text.endsWith(ZWJ)
  return before && after ? 'both' : before ? 'right' : after ? 'left' : null
}

/**
 * The text that shapes to a glyph: an Arabic presentation form's base letter in joining context,
 * anything else as it is. Drawing this instead of the presentation-form code point keeps the
 * form in the profile's own font even when that font leaves the presentation block unmapped.
 */
export function shapingText(glyph: string): string {
  return (glyph.length === 1 && ARABIC_PRESENTATION_CONTEXT.get(glyph.charCodeAt(0))) || glyph
}

/**
 * The text drawn for a glyph that joins: the glyph with `count` tatweels (kashida, the stroke
 * Arabic calligraphy stretches to justify a line) on each side it joins, so its connecting stroke
 * runs past the cell edge and is clipped there, meeting the stroke of the next cell. Tatweel goes
 * before the letter for a join on the right, since right is where a right-to-left script's
 * preceding letter sits; after it for a join on the left. A glyph that joins nothing is returned
 * as it is, and tatweel itself becomes a run of tatweel, a bare stroke across the whole cell.
 */
export function kashidaText(glyph: string, count: number): string {
  const side = joiningSide(glyph)
  if (side === null || count <= 0) return glyph
  const k = TATWEEL.repeat(count)
  if (glyph === TATWEEL) return k + TATWEEL + k
  return side === 'right' ? k + glyph : side === 'left' ? glyph + k : k + glyph + k
}

/**
 * Where to start drawing a glyph in its cell, in the units the widths are in.
 *
 * `bodyWidth` is the glyph alone; `runWidth` is what is actually drawn, which for a joining
 * glyph under kashidaText includes its tatweels. A glyph that joins nothing is centred. One that
 * joins on its left sits flush right, with any tatweel running out past the left edge; one that
 * joins on its right mirrors that, except without tatweel it has to sit flush right itself for
 * its stroke to reach the edge. Medial forms keep their letter centred and overflow both ways.
 * Floored, so a glyph as wide as its cell starts at 0 whichever it is.
 */
export function glyphOffset(
  glyph: string,
  bodyWidth: number,
  cellWidth: number,
  runWidth = bodyWidth,
): number {
  const side = joiningSide(glyph)
  const extended = runWidth > bodyWidth
  if (side === 'left') return Math.floor(cellWidth - runWidth)
  if (side === 'right') return extended ? 0 : Math.floor(cellWidth - bodyWidth)
  if (side === 'both' && extended) {
    return Math.floor((cellWidth - bodyWidth) / 2) - Math.floor((runWidth - bodyWidth) / 2)
  }
  return Math.floor((cellWidth - bodyWidth) / 2)
}
