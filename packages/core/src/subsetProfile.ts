import type { AsciiProfile } from './types.js'
import { idiv } from './util.js'

/**
 * Derive a profile restricted to `characters` from an already-built profile —
 * compiled or runtime — preserving each glyph's raster data exactly (mask,
 * coverage, atlas tile). Matching against the subset behaves identically to a
 * profile compiled with that charset: glyph ids follow the given character
 * order, so all id-order tie-breaks carry over.
 *
 * shape6 vectors are carried; a shape6 LUT is dropped (its entries are argmins
 * over the parent charset), so shape6 matching falls back to the brute-force
 * 6D path — cheap at subset sizes.
 *
 * Like the compiler: duplicate code points are an error, and so is any
 * character the profile has no glyph for.
 */
export function subsetProfile(profile: AsciiProfile, characters: string | readonly string[]): AsciiProfile {
  const requested = typeof characters === 'string' ? Array.from(characters) : [...characters]
  if (requested.length === 0) {
    throw new Error('subsetProfile: empty character set. Pass at least one character, or use the profile as-is.')
  }
  const seen = new Set<string>()
  for (const ch of requested) {
    if (seen.has(ch)) {
      throw new Error(`subsetProfile: duplicate character ${JSON.stringify(ch)}. Each code point may appear once.`)
    }
    seen.add(ch)
  }
  const oldIdOf = new Map<string, number>()
  profile.glyphs.forEach((g, i) => oldIdOf.set(g, i))
  const oldIds = requested.map((ch) => {
    const id = oldIdOf.get(ch)
    if (id === undefined) {
      throw new Error(
        `subsetProfile: profile ${profile.id} has no glyph ${JSON.stringify(ch)}. ` +
          'Subsets can only narrow the compiled charset; rebuild the profile to add characters.',
      )
    }
    return id
  })

  const n = oldIds.length
  const { structural, atlas, shape6 } = profile
  const masksLo = new Uint32Array(n)
  const masksHi = new Uint32Array(n)
  const coverage = new Uint16Array(n)
  const vectors6 = shape6 ? new Float32Array(n * 6) : undefined
  oldIds.forEach((oldId, i) => {
    masksLo[i] = structural.masksLo[oldId]
    masksHi[i] = structural.masksHi[oldId]
    coverage[i] = structural.coverage[oldId]
    if (vectors6 && shape6) vectors6.set(shape6.vectors6.subarray(oldId * 6, oldId * 6 + 6), i * 6)
  })

  // Repack the atlas with the compiler's layout rule (§13): columns from the
  // integer sqrt loop, whole pitch blocks copied so padding survives.
  const pitchW = atlas.pitchWidth
  const pitchH = atlas.pitchHeight
  let columns = 1
  while (columns * columns < n) columns++
  const rows = idiv(n + columns - 1, columns)
  const width = columns * pitchW
  const height = rows * pitchH
  const data = new Uint8Array(width * height)
  oldIds.forEach((oldId, i) => {
    const sx = (oldId % atlas.columns) * pitchW
    const sy = idiv(oldId, atlas.columns) * pitchH
    const dx = (i % columns) * pitchW
    const dy = idiv(i, columns) * pitchH
    for (let y = 0; y < pitchH; y++) {
      const src = (sy + y) * atlas.width + sx
      data.set(atlas.data.subarray(src, src + pitchW), (dy + y) * width + dx)
    }
  })

  // Content-derived pseudo-fingerprint (same scheme as runtime profiles): a
  // subset is a distinct profile and must never pair with the parent's frames.
  let h = 0x811c9dc5
  const fnv = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193) >>> 0
  }
  for (const ch of profile.fingerprint) fnv(ch.codePointAt(0) ?? 0)
  for (const ch of requested) fnv(ch.codePointAt(0) ?? 0)
  const fingerprint = `5ab5${h.toString(16).padStart(8, '0')}`.padEnd(64, '0')

  return {
    version: profile.version,
    id: `${profile.id}#subset${n}`,
    fingerprint,
    charsetHash: '00'.repeat(32),
    fontHash: profile.fontHash,
    glyphs: requested,
    glyphCount: n,
    metrics: profile.metrics,
    atlas: {
      width,
      height,
      pitchWidth: pitchW,
      pitchHeight: pitchH,
      cellWidth: atlas.cellWidth,
      cellHeight: atlas.cellHeight,
      padding: atlas.padding,
      columns,
      data,
    },
    structural: { masksLo, masksHi, coverage },
    ...(vectors6 ? { shape6: { vectors6 } } : {}),
    metadata: { ...profile.metadata, id: `${profile.id}#subset${n}`, charset: 'custom' },
  }
}
