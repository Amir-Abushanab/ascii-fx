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
}

export function loadFont(bytes: Uint8Array): LoadedFont {
  const create =
    (FK as { create?: typeof FK.create }).create ??
    (FK as { default?: { create: typeof FK.create } }).default?.create
  if (!create) throw new Error('fontkit did not expose create(); incompatible fontkit version.')
  const font = create(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  if (font.fonts && font.fonts.length > 0) {
    throw new Error('Font collections (.ttc/.otc) are not supported; extract a single face first.')
  }
  return {
    font,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    lineGap: font.lineGap,
    familyName: font.familyName ?? font.postscriptName,
    weight: font['OS/2']?.usWeightClass,
  }
}
