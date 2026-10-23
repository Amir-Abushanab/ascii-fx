import { Buffer } from 'node:buffer'
import * as FK from 'fontkit'
import type { Font } from 'fontkit'

export interface LoadedFont {
  font: Font
  unitsPerEm: number
  ascent: number
  descent: number
  lineGap: number
  familyName?: string
  weight?: number
  /** Set when the face came out of a collection: the bytes alone no longer identify the font. */
  collectionFace?: string
}

/**
 * Parse a font. A collection (.ttc/.otc) holds several faces, and CJK and Arabic system fonts
 * ship that way almost without exception, so `face` picks one: a PostScript name, or an index
 * into the collection. It is required for a collection, which has no meaningful default.
 */
export function loadFont(bytes: Uint8Array, face?: string | number): LoadedFont {
  const create =
    (FK as { create?: typeof FK.create }).create ??
    (FK as { default?: { create: typeof FK.create } }).default?.create
  if (!create) throw new Error('fontkit did not expose create(); incompatible fontkit version.')
  let font = create(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  let collectionFace: string | undefined
  if (font.fonts && font.fonts.length > 0) {
    const faces = font.fonts
    const list = faces.map((f, i) => `${i}: ${f.postscriptName ?? '(unnamed)'}`).join(', ')
    if (face === undefined) {
      throw new Error(
        `This is a font collection with ${faces.length} faces; pick one with \`face\` ` +
          `(a PostScript name or an index). Faces: ${list}.`,
      )
    }
    const picked =
      typeof face === 'number' ? faces[face] : faces.find((f) => f.postscriptName === face)
    if (!picked)
      throw new Error(`No face ${JSON.stringify(face)} in this collection. Faces: ${list}.`)
    font = picked
    collectionFace = picked.postscriptName ?? String(faces.indexOf(picked))
  } else if (face !== undefined && face !== 0 && face !== font.postscriptName) {
    throw new Error(
      `\`face\` ${JSON.stringify(face)} was given, but this is a single font ` +
        `(${font.postscriptName ?? 'unnamed'}), not a collection.`,
    )
  }
  return {
    collectionFace,
    font,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    lineGap: font.lineGap,
    familyName: font.familyName ?? font.postscriptName,
    weight: font['OS/2']?.usWeightClass,
  }
}
