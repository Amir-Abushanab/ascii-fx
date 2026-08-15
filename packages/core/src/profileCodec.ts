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
} as const

interface Section {
  type: number
  bytes: Uint8Array
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
  const atlas = {
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
  const charsetHash = bytesToHex(bytes.subarray(76, 108))
  const fontHash = bytesToHex(bytes.subarray(108, 140))
  const fingerprint = bytesToHex(bytes.subarray(140, 172))

  let glyphs: string[] | undefined
  let masksLo: Uint32Array | undefined
  let masksHi: Uint32Array | undefined
  let coverage: Uint16Array | undefined
  let vectors6: Float32Array | undefined
  let lut3: Uint16Array | undefined
  let metadata: AsciiProfile['metadata'] | undefined

  const dec = new TextDecoder()
  for (let s = 0; s < sectionCount; s++) {
    const base = HEADER_FIXED + s * 12
    const type = view.getUint32(base, true)
    const offset = view.getUint32(base + 4, true)
    const length = view.getUint32(base + 8, true)
    const data = bytes.subarray(offset, offset + length)
    switch (type) {
      case SECTION.glyphTable: {
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const count = sv.getUint32(0, true)
        const blobStart = 4 + 4 * (count + 1)
        glyphs = []
        for (let i = 0; i < count; i++) {
          const a = sv.getUint32(4 + i * 4, true)
          const b = sv.getUint32(4 + (i + 1) * 4, true)
          glyphs.push(dec.decode(data.subarray(blobStart + a, blobStart + b)))
        }
        break
      }
      case SECTION.masks: {
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
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        coverage = new Uint16Array(glyphCount)
        for (let g = 0; g < glyphCount; g++) coverage[g] = sv.getUint16(g * 2, true)
        break
      }
      case SECTION.atlas:
        atlas.data = new Uint8Array(data)
        break
      case SECTION.shape6Vectors: {
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        vectors6 = new Float32Array(glyphCount * 6)
        for (let i = 0; i < vectors6.length; i++) vectors6[i] = sv.getFloat32(i * 4, true)
        break
      }
      case SECTION.shape6Lut: {
        const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        lut3 = new Uint16Array(data.byteLength / 2)
        for (let i = 0; i < lut3.length; i++) lut3[i] = sv.getUint16(i * 2, true)
        break
      }
      case SECTION.metadata:
        metadata = JSON.parse(dec.decode(data)) as AsciiProfile['metadata']
        break
      default:
        break
    }
  }

  if (!glyphs || !masksLo || !masksHi || !coverage || atlas.data.length === 0 || !metadata) {
    throw new Error('Profile is missing required sections; the .asciip file is corrupt or truncated.')
  }
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
    shape6: vectors6 ? { vectors6, lut3 } : undefined,
    metadata,
  }
}
