import type { AsciiProfile } from './types.js'
import { align4, bytesToHex, hexToBytes } from './util.js'

export const PROFILE_FORMAT_VERSION = 1
const HEADER_FIXED = 172

const SECTION = {
  glyphTable: 1,
  masks: 3,
  coverage: 4,
  atlas: 6,
  shape6Vectors: 7,
  shape6Lut: 8,
  metadata: 9,
  chromaticSamples: 10,
  atlasRgba: 11,
} as const

interface Section {
  type: number
  bytes: Uint8Array
}

interface StoredSection {
  type: number
  offset: number
  data: Uint8Array
}

const corruptProfile = (detail: string): Error => new Error(`Corrupt ASCII FX profile: ${detail}`)

const exactProduct = (label: string, a: number, b: number): number => {
  const value = a * b
  if (!Number.isSafeInteger(value)) throw corruptProfile(`${label} is too large.`)
  return value
}

const readStoredSections = (
  bytes: Uint8Array,
  view: DataView,
  sectionCount: number,
): StoredSection[] => {
  const maxSections = Math.floor((bytes.length - HEADER_FIXED) / 12)
  if (sectionCount > maxSections) throw corruptProfile('section table is truncated.')
  const tableEnd = HEADER_FIXED + sectionCount * 12
  const seen = new Set<number>()
  const sections: StoredSection[] = []
  for (let s = 0; s < sectionCount; s++) {
    const base = HEADER_FIXED + s * 12
    const type = view.getUint32(base, true)
    const offset = view.getUint32(base + 4, true)
    const length = view.getUint32(base + 8, true)
    if (offset < tableEnd || offset + length > bytes.length) {
      throw corruptProfile(`section ${type} points outside the file.`)
    }
    if (seen.has(type)) throw corruptProfile(`section ${type} appears more than once.`)
    const end = offset + length
    for (const section of sections) {
      const sectionEnd = section.offset + section.data.byteLength
      if (length > 0 && section.data.byteLength > 0 && offset < sectionEnd && end > section.offset) {
        throw corruptProfile(`section ${type} overlaps section ${section.type}.`)
      }
    }
    seen.add(type)
    sections.push({ type, offset, data: bytes.subarray(offset, end) })
  }
  return sections
}

/** Serialize a profile to asciip/1 bytes (ALGORITHM.md §14). Deterministic. */
export function encodeProfile(profile: AsciiProfile): Uint8Array {
  const enc = new TextEncoder()
  const sections: Section[] = []

  {
    const glyphBytes = profile.glyphs.map((g) => enc.encode(g))
    const blobLen = glyphBytes.reduce((n, b) => n + b.length, 0)
    const bytes = new Uint8Array(4 + 4 * (profile.glyphCount + 1) + blobLen)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, profile.glyphCount, true)
    let off = 0
    for (let i = 0; i < glyphBytes.length; i++) {
      view.setUint32(4 + i * 4, off, true)
      off += glyphBytes[i].length
    }
    view.setUint32(4 + profile.glyphCount * 4, off, true)
    let p = 4 + 4 * (profile.glyphCount + 1)
    for (const b of glyphBytes) {
      bytes.set(b, p)
      p += b.length
    }
    sections.push({ type: SECTION.glyphTable, bytes })
  }

  {
    const bytes = new Uint8Array(profile.glyphCount * 8)
    const view = new DataView(bytes.buffer)
    for (let g = 0; g < profile.glyphCount; g++) {
      view.setUint32(g * 8, profile.structural.masksLo[g], true)
      view.setUint32(g * 8 + 4, profile.structural.masksHi[g], true)
    }
    sections.push({ type: SECTION.masks, bytes })
  }

  {
    const bytes = new Uint8Array(profile.glyphCount * 2)
    const view = new DataView(bytes.buffer)
    for (let g = 0; g < profile.glyphCount; g++) {
      view.setUint16(g * 2, profile.structural.coverage[g], true)
    }
    sections.push({ type: SECTION.coverage, bytes })
  }

  sections.push({ type: SECTION.atlas, bytes: profile.atlas.data })

  if (profile.atlas.rgba) sections.push({ type: SECTION.atlasRgba, bytes: profile.atlas.rgba })
  if (profile.chromatic) sections.push({ type: SECTION.chromaticSamples, bytes: profile.chromatic.samples })

  if (profile.shape6) {
    const v = profile.shape6.vectors6
    const bytes = new Uint8Array(v.length * 4)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < v.length; i++) view.setFloat32(i * 4, v[i], true)
    sections.push({ type: SECTION.shape6Vectors, bytes })
    if (profile.shape6.lut3) {
      const lut = profile.shape6.lut3
      const lutBytes = new Uint8Array(lut.length * 2)
      const lutView = new DataView(lutBytes.buffer)
      for (let i = 0; i < lut.length; i++) lutView.setUint16(i * 2, lut[i], true)
      sections.push({ type: SECTION.shape6Lut, bytes: lutBytes })
    }
  }

  {
    const m = profile.metadata
    const json: Record<string, unknown> = { id: m.id, charset: m.charset }
    if (m.fontFamily !== undefined) json.fontFamily = m.fontFamily
    if (m.fontWeight !== undefined) json.fontWeight = m.fontWeight
    json.compilerVersion = m.compilerVersion
    sections.push({ type: SECTION.metadata, bytes: enc.encode(JSON.stringify(json)) })
  }

  // §14: the section table is in ascending type order. The pushes above are
  // grouped by feature, so order at emit — that also keeps any future section
  // type correct by construction rather than by push placement.
  sections.sort((a, b) => a.type - b.type)

  const tableOffset = HEADER_FIXED
  let cursor = align4(tableOffset + sections.length * 12)
  const placed = sections.map((s) => {
    const offset = cursor
    cursor = align4(cursor + s.bytes.length)
    return { ...s, offset }
  })

  const out = new Uint8Array(cursor)
  const view = new DataView(out.buffer)
  out[0] = 0x41 // A
  out[1] = 0x53 // S
  out[2] = 0x43 // C
  out[3] = 0x49 // I
  view.setUint32(4, PROFILE_FORMAT_VERSION, true)
  view.setUint32(8, sections.length, true)
  view.setUint32(12, profile.glyphCount, true)
  view.setUint32(16, profile.atlas.width, true)
  view.setUint32(20, profile.atlas.height, true)
  view.setUint32(24, profile.atlas.pitchWidth, true)
  view.setUint32(28, profile.atlas.pitchHeight, true)
  view.setUint32(32, profile.atlas.cellWidth, true)
  view.setUint32(36, profile.atlas.cellHeight, true)
  view.setUint32(40, profile.atlas.padding, true)
  view.setUint32(44, profile.atlas.columns, true)
  view.setUint32(48, profile.metrics.baseline, true)
  view.setUint32(52, profile.atlas.cellHeight, true)
  view.setInt32(56, profile.metrics.unitsPerEm, true)
  view.setInt32(60, profile.metrics.ascent, true)
  view.setInt32(64, profile.metrics.descent, true)
  view.setInt32(68, profile.metrics.lineGap, true)
  view.setInt32(72, profile.metrics.advanceUnits, true)
  out.set(hexToBytes(profile.charsetHash), 76)
  out.set(hexToBytes(profile.fontHash), 108)
  out.set(hexToBytes(profile.fingerprint), 140)
  placed.forEach((s, i) => {
    view.setUint32(tableOffset + i * 12, s.type, true)
    view.setUint32(tableOffset + i * 12 + 4, s.offset, true)
    view.setUint32(tableOffset + i * 12 + 8, s.bytes.length, true)
    out.set(s.bytes, s.offset)
  })
  return out
}

/** Decode asciip/1 bytes. Unknown section types are skipped (forward compatibility). */
export function decodeProfile(bytes: Uint8Array): AsciiProfile {
  if (bytes.length < HEADER_FIXED || bytes[0] !== 0x41 || bytes[1] !== 0x53 || bytes[2] !== 0x43 || bytes[3] !== 0x49) {
    throw new Error('Not an ASCII FX profile: bad magic. Expected a .asciip file built by @ascii-fx/compiler.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const formatVersion = view.getUint32(4, true)
  if (formatVersion !== PROFILE_FORMAT_VERSION) {
    throw new Error(
      `Profile was generated with schema v${formatVersion}; this runtime supports v${PROFILE_FORMAT_VERSION}. ` +
        'Rebuild the profile with @ascii-fx/compiler.',
    )
  }
  const sectionCount = view.getUint32(8, true)
  const glyphCount = view.getUint32(12, true)
  if (glyphCount === 0 || glyphCount > 0x10000) {
    throw corruptProfile(`glyph count ${glyphCount} is outside the supported range 1..65536.`)
  }
  const atlas: AsciiProfile['atlas'] = {
    width: view.getUint32(16, true),
    height: view.getUint32(20, true),
    pitchWidth: view.getUint32(24, true),
    pitchHeight: view.getUint32(28, true),
    cellWidth: view.getUint32(32, true),
    cellHeight: view.getUint32(36, true),
    padding: view.getUint32(40, true),
    columns: view.getUint32(44, true),
    data: new Uint8Array(0),
  }
  const positiveAtlasValues = {
    width: atlas.width,
    height: atlas.height,
    pitchWidth: atlas.pitchWidth,
    pitchHeight: atlas.pitchHeight,
    cellWidth: atlas.cellWidth,
    cellHeight: atlas.cellHeight,
    columns: atlas.columns,
  }
  for (const [name, value] of Object.entries(positiveAtlasValues)) {
    if (!Number.isInteger(value) || value <= 0) throw corruptProfile(`atlas ${name} must be a positive integer.`)
  }
  if (!Number.isInteger(atlas.padding) || atlas.padding < 0) throw corruptProfile('atlas padding must be non-negative.')
  const minimumPitchWidth = atlas.cellWidth + atlas.padding * 2
  const minimumPitchHeight = atlas.cellHeight + atlas.padding * 2
  if (atlas.pitchWidth < minimumPitchWidth || atlas.pitchHeight < minimumPitchHeight) {
    throw corruptProfile('atlas pitch is smaller than its cell plus padding.')
  }
  if (exactProduct('atlas row width', atlas.columns, atlas.pitchWidth) > atlas.width) {
    throw corruptProfile('atlas columns do not fit within its width.')
  }
  if (exactProduct('atlas rows', Math.ceil(glyphCount / atlas.columns), atlas.pitchHeight) > atlas.height) {
    throw corruptProfile('atlas does not have enough rows for every glyph.')
  }
  const expectedAtlasBytes = exactProduct('atlas byte length', atlas.width, atlas.height)
  const metrics = {
    baseline: view.getUint32(48, true),
    unitsPerEm: view.getInt32(56, true),
    ascent: view.getInt32(60, true),
    descent: view.getInt32(64, true),
    lineGap: view.getInt32(68, true),
    advanceUnits: view.getInt32(72, true),
    cellWidth: atlas.cellWidth,
    cellHeight: atlas.cellHeight,
  }
  if (metrics.baseline > metrics.cellHeight || metrics.unitsPerEm <= 0 || metrics.advanceUnits <= 0) {
    throw corruptProfile('font metrics are invalid.')
  }
  const charsetHash = bytesToHex(bytes.subarray(76, 108))
  const fontHash = bytesToHex(bytes.subarray(108, 140))
  const fingerprint = bytesToHex(bytes.subarray(140, 172))

  let glyphs: string[] | undefined
  let masksLo: Uint32Array | undefined
  let masksHi: Uint32Array | undefined
  let coverage: Uint16Array | undefined
  let vectors6: Float32Array | undefined
  let lut3: Uint16Array | undefined
  let atlasRgba: Uint8Array | undefined
  let chromaticSamples: Uint8Array | undefined
  let metadata: AsciiProfile['metadata'] | undefined

  const dec = new TextDecoder('utf-8', { fatal: true })
  const storedSections = readStoredSections(bytes, view, sectionCount)
  for (const { type, data } of storedSections) {
    switch (type) {
      case SECTION.glyphTable: {
        if (data.byteLength < 8) throw corruptProfile('glyph table is truncated.')
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const count = sv.getUint32(0, true)
        if (count !== glyphCount) {
          throw corruptProfile(`glyph table contains ${count} entries; header declares ${glyphCount}.`)
        }
        const blobStart = 4 + 4 * (count + 1)
        if (blobStart > data.byteLength) throw corruptProfile('glyph offset table is truncated.')
        const blobLength = data.byteLength - blobStart
        glyphs = []
        let previous = 0
        for (let i = 0; i < count; i++) {
          const a = sv.getUint32(4 + i * 4, true)
          const b = sv.getUint32(4 + (i + 1) * 4, true)
          if (a !== previous || b < a || b > blobLength) {
            throw corruptProfile('glyph offsets are not contiguous and in bounds.')
          }
          const glyph = dec.decode(data.subarray(blobStart + a, blobStart + b))
          if (glyph.length === 0) throw corruptProfile(`glyph ${i} is empty.`)
          glyphs.push(glyph)
          previous = b
        }
        if (previous !== blobLength) throw corruptProfile('glyph table has unreferenced trailing bytes.')
        break
      }
      case SECTION.masks: {
        if (data.byteLength !== glyphCount * 8) throw corruptProfile('mask section has the wrong length.')
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        masksLo = new Uint32Array(glyphCount)
        masksHi = new Uint32Array(glyphCount)
        for (let g = 0; g < glyphCount; g++) {
          masksLo[g] = sv.getUint32(g * 8, true)
          masksHi[g] = sv.getUint32(g * 8 + 4, true)
        }
        break
      }
      case SECTION.coverage: {
        if (data.byteLength !== glyphCount * 2) throw corruptProfile('coverage section has the wrong length.')
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        coverage = new Uint16Array(glyphCount)
        for (let g = 0; g < glyphCount; g++) coverage[g] = sv.getUint16(g * 2, true)
        break
      }
      case SECTION.atlas:
        if (data.byteLength !== expectedAtlasBytes) throw corruptProfile('atlas section has the wrong length.')
        atlas.data = new Uint8Array(data)
        break
      case SECTION.atlasRgba:
        if (data.byteLength !== expectedAtlasBytes * 4) {
          throw corruptProfile('RGBA atlas section has the wrong length.')
        }
        atlasRgba = new Uint8Array(data)
        break
      case SECTION.chromaticSamples:
        if (data.byteLength !== glyphCount * 256) {
          throw corruptProfile('chromatic sample section has the wrong length.')
        }
        chromaticSamples = new Uint8Array(data)
        break
      case SECTION.shape6Vectors: {
        if (data.byteLength !== glyphCount * 6 * 4) {
          throw corruptProfile('shape6 vector section has the wrong length.')
        }
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        vectors6 = new Float32Array(glyphCount * 6)
        for (let i = 0; i < vectors6.length; i++) vectors6[i] = sv.getFloat32(i * 4, true)
        break
      }
      case SECTION.shape6Lut: {
        if (data.byteLength !== 8 ** 6 * 2) throw corruptProfile('shape6 LUT section has the wrong length.')
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        lut3 = new Uint16Array(data.byteLength / 2)
        for (let i = 0; i < lut3.length; i++) {
          const glyphId = sv.getUint16(i * 2, true)
          if (glyphId >= glyphCount) throw corruptProfile(`shape6 LUT references missing glyph ${glyphId}.`)
          lut3[i] = glyphId
        }
        break
      }
      case SECTION.metadata: {
        try {
          metadata = JSON.parse(dec.decode(data)) as AsciiProfile['metadata']
        } catch {
          throw corruptProfile('metadata is not valid UTF-8 JSON.')
        }
        if (
          !metadata ||
          typeof metadata.id !== 'string' ||
          typeof metadata.charset !== 'string' ||
          typeof metadata.compilerVersion !== 'string'
        ) {
          throw corruptProfile('metadata is missing required string fields.')
        }
        break
      }
      default:
        break
    }
  }

  if (!glyphs || !masksLo || !masksHi || !coverage || atlas.data.length === 0 || !metadata) {
    throw new Error('Profile is missing required sections; the .asciip file is corrupt or truncated.')
  }
  if (lut3 && !vectors6) throw corruptProfile('shape6 LUT is present without shape6 vectors.')
  // The two halves of a chromatic profile are useless apart: samples drive the
  // match, the RGBA atlas draws the result. A profile carrying one without the
  // other would match correctly and then render as blank tiles.
  if (chromaticSamples && !atlasRgba) {
    throw corruptProfile('chromatic samples are present without the RGBA atlas needed to draw them.')
  }
  if (atlasRgba && !chromaticSamples) {
    throw corruptProfile('an RGBA atlas is present without the chromatic samples needed to match it.')
  }
  if (atlasRgba) atlas.rgba = atlasRgba
  return {
    version: formatVersion,
    id: metadata.id,
    fingerprint,
    charsetHash,
    fontHash,
    glyphs,
    glyphCount,
    metrics,
    atlas,
    structural: { masksLo, masksHi, coverage },
    chromatic: chromaticSamples ? { samples: chromaticSamples } : undefined,
    shape6: vectors6 ? { vectors6, lut3 } : undefined,
    metadata,
  }
}
