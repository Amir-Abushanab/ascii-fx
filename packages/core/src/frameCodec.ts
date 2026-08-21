import type { AsciiProfile, ColorMode } from './types.js'
import { AsciiFrame } from './frame.js'
import { align4, bytesToHex, hexToBytes } from './util.js'

export const FRAME_FORMAT_VERSION = 1
const HEADER_FIXED = 56

const COLOR_MODE_CODE: Record<ColorMode, number> = { mono: 0, foreground: 1, full: 2, glyph: 3 }
const COLOR_MODE_NAME: ColorMode[] = ['mono', 'foreground', 'full', 'glyph']

const SECTION = {
  glyphIds: 1,
  fgR: 2,
  fgG: 3,
  fgB: 4,
  bgR: 5,
  bgG: 6,
  bgB: 7,
  flags: 8,
  metadata: 9,
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

const corruptFrame = (detail: string): Error => new Error(`Corrupt ASCII FX frame: ${detail}`)

const readStoredSections = (
  bytes: Uint8Array,
  view: DataView,
  sectionCount: number,
): StoredSection[] => {
  const maxSections = Math.floor((bytes.length - HEADER_FIXED) / 12)
  if (sectionCount > maxSections) throw corruptFrame('section table is truncated.')
  const tableEnd = HEADER_FIXED + sectionCount * 12
  const seen = new Set<number>()
  const sections: StoredSection[] = []
  for (let s = 0; s < sectionCount; s++) {
    const base = HEADER_FIXED + s * 12
    const type = view.getUint32(base, true)
    const offset = view.getUint32(base + 4, true)
    const length = view.getUint32(base + 8, true)
    if (offset < tableEnd || offset + length > bytes.length) {
      throw corruptFrame(`section ${type} points outside the file.`)
    }
    if (seen.has(type)) throw corruptFrame(`section ${type} appears more than once.`)
    const end = offset + length
    for (const section of sections) {
      const sectionEnd = section.offset + section.data.byteLength
      if (length > 0 && section.data.byteLength > 0 && offset < sectionEnd && end > section.offset) {
        throw corruptFrame(`section ${type} overlaps section ${section.type}.`)
      }
    }
    seen.add(type)
    sections.push({ type, offset, data: bytes.subarray(offset, end) })
  }
  return sections
}

const channelPlane = (packed: Uint32Array, shift: number): Uint8Array => {
  const out = new Uint8Array(packed.length)
  for (let i = 0; i < packed.length; i++) out[i] = (packed[i] >>> shift) & 0xff
  return out
}

/** Serialize a frame to asciif/1 bytes (ALGORITHM.md §15). SoA/channel-planar. */
export function encodeFrame(frame: AsciiFrame): Uint8Array {
  const n = frame.columns * frame.rows
  const sections: Section[] = []

  {
    const bytes = new Uint8Array(n * 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < n; i++) view.setUint16(i * 2, frame.glyphIds[i], true)
    sections.push({ type: SECTION.glyphIds, bytes })
  }
  if (frame.foreground) {
    sections.push({ type: SECTION.fgR, bytes: channelPlane(frame.foreground, 0) })
    sections.push({ type: SECTION.fgG, bytes: channelPlane(frame.foreground, 8) })
    sections.push({ type: SECTION.fgB, bytes: channelPlane(frame.foreground, 16) })
  }
  if (frame.background) {
    sections.push({ type: SECTION.bgR, bytes: channelPlane(frame.background, 0) })
    sections.push({ type: SECTION.bgG, bytes: channelPlane(frame.background, 8) })
    sections.push({ type: SECTION.bgB, bytes: channelPlane(frame.background, 16) })
  }
  if (frame.flags.some((f) => f !== 0)) {
    const bytes = new Uint8Array(n * 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < n; i++) view.setUint16(i * 2, frame.flags[i], true)
    sections.push({ type: SECTION.flags, bytes })
  }
  {
    const json = { profileId: frame.profile.id, algorithm: 'structural-v1' }
    sections.push({ type: SECTION.metadata, bytes: new TextEncoder().encode(JSON.stringify(json)) })
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
  out[3] = 0x46 // F
  view.setUint32(4, FRAME_FORMAT_VERSION, true)
  view.setUint32(8, frame.columns, true)
  view.setUint32(12, frame.rows, true)
  view.setUint32(16, COLOR_MODE_CODE[frame.colorMode], true)
  view.setUint32(20, sections.length, true)
  out.set(hexToBytes(frame.profile.fingerprint), 24)
  placed.forEach((s, i) => {
    view.setUint32(tableOffset + i * 12, s.type, true)
    view.setUint32(tableOffset + i * 12 + 4, s.offset, true)
    view.setUint32(tableOffset + i * 12 + 8, s.bytes.length, true)
    out.set(s.bytes, s.offset)
  })
  return out
}

export interface FrameMeta {
  columns: number
  rows: number
  colorMode: ColorMode
  profileFingerprint: string
  profileId?: string
}

/** Read frame header/metadata without needing the profile. */
export function peekFrame(bytes: Uint8Array): FrameMeta {
  if (bytes.length < HEADER_FIXED || bytes[0] !== 0x41 || bytes[1] !== 0x53 || bytes[2] !== 0x43 || bytes[3] !== 0x46) {
    throw new Error('Not an ASCII FX frame: bad magic. Expected a .asciif file built by @ascii-fx/compiler.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const formatVersion = view.getUint32(4, true)
  if (formatVersion !== FRAME_FORMAT_VERSION) {
    throw new Error(
      `Frame was generated with schema v${formatVersion}; this runtime supports v${FRAME_FORMAT_VERSION}. ` +
        'Rebuild it with @ascii-fx/compiler.',
    )
  }
  const columns = view.getUint32(8, true)
  const rows = view.getUint32(12, true)
  if (columns === 0 || rows === 0 || columns > Math.floor(Number.MAX_SAFE_INTEGER / rows)) {
    throw corruptFrame(`grid ${columns}×${rows} is invalid or too large.`)
  }
  const colorCode = view.getUint32(16, true)
  const colorMode = COLOR_MODE_NAME[colorCode]
  if (!colorMode) throw corruptFrame(`unknown color mode ${colorCode}.`)
  const meta: FrameMeta = {
    columns,
    rows,
    colorMode,
    profileFingerprint: bytesToHex(bytes.subarray(24, 56)),
  }
  const sectionCount = view.getUint32(20, true)
  const sections = readStoredSections(bytes, view, sectionCount)
  for (const section of sections) {
    if (section.type === SECTION.metadata) {
      try {
        const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(section.data)) as {
          profileId?: string
        }
        if (typeof json.profileId === 'string') meta.profileId = json.profileId
      } catch {
        // metadata is best-effort in peek
      }
    }
  }
  return meta
}

/** Decode asciif/1 bytes against the profile it was built with. */
export function decodeFrame(bytes: Uint8Array, profile: AsciiProfile): AsciiFrame {
  const meta = peekFrame(bytes)
  if (meta.profileFingerprint !== profile.fingerprint) {
    throw new Error(
      `Frame was built against profile ${meta.profileId ?? '<unknown>'} (${meta.profileFingerprint.slice(0, 12)}…) ` +
        `but got profile "${profile.id}" (${profile.fingerprint.slice(0, 12)}…). ` +
        'Load the matching .asciip or rebuild the frame.',
    )
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sectionCount = view.getUint32(20, true)
  const n = meta.columns * meta.rows
  if (!Number.isSafeInteger(n) || n > Math.floor(Number.MAX_SAFE_INTEGER / 2)) {
    throw corruptFrame('cell count is too large.')
  }
  const sections = readStoredSections(bytes, view, sectionCount)
  const glyphSection = sections.find((section) => section.type === SECTION.glyphIds)
  if (!glyphSection) throw corruptFrame('glyph-id section is missing.')
  if (glyphSection.data.byteLength !== n * 2) throw corruptFrame('glyph-id section has the wrong length.')

  const planeTypes: number[] = [SECTION.fgR, SECTION.fgG, SECTION.fgB, SECTION.bgR, SECTION.bgG, SECTION.bgB]
  for (const section of sections) {
    if (planeTypes.includes(section.type) && section.data.byteLength !== n) {
      throw corruptFrame(`color plane ${section.type} has the wrong length.`)
    }
    if (section.type === SECTION.flags && section.data.byteLength !== n * 2) {
      throw corruptFrame('flags section has the wrong length.')
    }
  }

  const glyphIds = new Uint16Array(n)
  let flags: Uint16Array | undefined
  const planes = new Map<number, Uint8Array>()

  for (const { type, data } of sections) {
    const sv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    switch (type) {
      case SECTION.glyphIds:
        for (let i = 0; i < n; i++) {
          const glyphId = sv.getUint16(i * 2, true)
          if (glyphId >= profile.glyphCount) {
            throw corruptFrame(`cell ${i} references missing glyph ${glyphId}.`)
          }
          glyphIds[i] = glyphId
        }
        break
      case SECTION.flags:
        flags = new Uint16Array(n)
        for (let i = 0; i < n; i++) flags[i] = sv.getUint16(i * 2, true)
        break
      case SECTION.fgR:
      case SECTION.fgG:
      case SECTION.fgB:
      case SECTION.bgR:
      case SECTION.bgG:
      case SECTION.bgB:
        planes.set(type, data)
        break
      default:
        break
    }
  }

  const packPlanes = (rT: number, gT: number, bT: number): Uint32Array | undefined => {
    const r = planes.get(rT)
    const g = planes.get(gT)
    const b = planes.get(bT)
    const present = Number(Boolean(r)) + Number(Boolean(g)) + Number(Boolean(b))
    if (present === 0) return undefined
    if (present !== 3) throw corruptFrame('color plane group is incomplete.')
    if (!r || !g || !b) throw corruptFrame('color plane group is incomplete.')
    const out = new Uint32Array(n)
    for (let i = 0; i < n; i++) out[i] = (r[i] | (g[i] << 8) | (b[i] << 16) | 0xff000000) >>> 0
    return out
  }

  const foreground = packPlanes(SECTION.fgR, SECTION.fgG, SECTION.fgB)
  const background = packPlanes(SECTION.bgR, SECTION.bgG, SECTION.bgB)
  // 'glyph' carries no colour planes: chromatic-v1's colour lives in the glyph.
  const colorless = meta.colorMode === 'mono' || meta.colorMode === 'glyph'
  if (!colorless && !foreground) {
    throw corruptFrame(`${meta.colorMode} frames require foreground color planes.`)
  }
  if (colorless && foreground) {
    throw corruptFrame(`${meta.colorMode} frames must not contain color planes.`)
  }
  if (meta.colorMode === 'full' && !background) throw corruptFrame('full-color frames require background planes.')
  if (meta.colorMode !== 'full' && background) {
    throw corruptFrame(`${meta.colorMode} frames must not contain background color planes.`)
  }

  return new AsciiFrame({
    columns: meta.columns,
    rows: meta.rows,
    colorMode: meta.colorMode,
    glyphIds,
    foreground,
    background,
    flags,
    profile,
  })
}
