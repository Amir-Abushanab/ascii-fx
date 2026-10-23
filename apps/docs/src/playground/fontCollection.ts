// TrueType/OpenType collections (.ttc/.otc) in the browser. FontFace takes a single font, and CJK
// and Arabic system fonts nearly all ship as collections, so this lists a collection's faces and
// copies one out as a standalone font: its table directory with the offsets rewritten, and its
// tables, which faces may share, copied in after it. Table bytes are untouched, so their
// checksums still hold. The compiler's `face` option does the same job at build time.

const TTCF = 0x74746366 // 'ttcf'

export interface CollectionFace {
  index: number
  /** Full name from the face's `name` table, or a placeholder when it has none. */
  name: string
}

export function isCollection(bytes: ArrayBuffer): boolean {
  return bytes.byteLength >= 12 && new DataView(bytes).getUint32(0) === TTCF
}

const faceOffsets = (dv: DataView): number[] => {
  const n = dv.getUint32(8)
  return Array.from({ length: n }, (_, i) => dv.getUint32(12 + 4 * i))
}

/** A table's offset and length within the file, from the face's directory at `face`. */
function findTable(dv: DataView, face: number, tag: string): [number, number] | null {
  const numTables = dv.getUint16(face + 4)
  for (let t = 0; t < numTables; t++) {
    const rec = face + 12 + t * 16
    const name = String.fromCharCode(
      dv.getUint8(rec),
      dv.getUint8(rec + 1),
      dv.getUint8(rec + 2),
      dv.getUint8(rec + 3),
    )
    if (name === tag) return [dv.getUint32(rec + 8), dv.getUint32(rec + 12)]
  }
  return null
}

/** Full name (nameID 4), Windows UTF-16 preferred over Mac Roman; PostScript name (6) failing that. */
function faceName(dv: DataView, face: number): string | null {
  const table = findTable(dv, face, 'name')
  if (!table) return null
  const [base] = table
  const count = dv.getUint16(base + 2)
  const strings = base + dv.getUint16(base + 4)
  let best: { rank: number; text: string } | null = null
  for (let r = 0; r < count; r++) {
    const rec = base + 6 + r * 12
    const platform = dv.getUint16(rec)
    const language = dv.getUint16(rec + 4)
    const nameId = dv.getUint16(rec + 6)
    if (nameId !== 4 && nameId !== 6) continue
    const length = dv.getUint16(rec + 8)
    const at = strings + dv.getUint16(rec + 10)
    let text = ''
    if (platform === 3 || platform === 0) {
      for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(dv.getUint16(at + i))
    } else if (platform === 1) {
      for (let i = 0; i < length; i++) text += String.fromCharCode(dv.getUint8(at + i))
    } else continue
    // Full name before PostScript name; English (Windows 0x409, Mac 0) before other languages,
    // since a picker is no use if one face is listed in Latin and the next in Arabic.
    const english = (platform === 3 && language === 0x409) || (platform === 1 && language === 0)
    const rank = (nameId === 4 ? 0 : 4) + (english ? 0 : platform === 0 ? 1 : 2)
    if (!best || rank < best.rank) best = { rank, text }
  }
  return best?.text ?? null
}

export function collectionFaces(bytes: ArrayBuffer): CollectionFace[] {
  const dv = new DataView(bytes)
  return faceOffsets(dv).map((offset, index) => ({
    index,
    name: faceName(dv, offset) ?? `face ${index}`,
  }))
}

/** Tables start on 4-byte boundaries. */
const pad4 = (n: number): number => (n + 3) & ~3

/** One face of a collection, as the bytes of a standalone font. */
export function extractFace(bytes: ArrayBuffer, index: number): ArrayBuffer {
  const dv = new DataView(bytes)
  const offsets = faceOffsets(dv)
  if (index < 0 || index >= offsets.length) {
    throw new Error(`No face ${index} in a collection of ${offsets.length}.`)
  }
  const face = offsets[index]
  const numTables = dv.getUint16(face + 4)
  const headerSize = 12 + numTables * 16
  let size = headerSize
  for (let t = 0; t < numTables; t++) size += pad4(dv.getUint32(face + 12 + t * 16 + 12))

  const out = new Uint8Array(size)
  const odv = new DataView(out.buffer)
  out.set(new Uint8Array(bytes, face, headerSize))
  const src = new Uint8Array(bytes)
  let at = headerSize
  for (let t = 0; t < numTables; t++) {
    const rec = 12 + t * 16
    const offset = dv.getUint32(face + rec + 8)
    const length = dv.getUint32(face + rec + 12)
    out.set(src.subarray(offset, offset + length), at)
    odv.setUint32(rec + 8, at)
    at += pad4(length)
  }
  return out.buffer
}
