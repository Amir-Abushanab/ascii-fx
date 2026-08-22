import type { AsciiProfile } from './types.js'
import { idiv } from './util.js'

/**
 * Split `text` into the profile's own glyph strings by greedy longest match.
 * Greedy is unambiguous for real palettes; a glyph that is a prefix of another
 * simply loses to the longer match at that position.
 */
function segmentByGlyphs(profile: AsciiProfile, text: string): string[] {
  const vocab = new Set(profile.glyphs)
  let maxLen = 1
  for (const g of profile.glyphs) maxLen = Math.max(maxLen, g.length)
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    let match: string | undefined
    for (let len = Math.min(maxLen, text.length - i); len >= 1; len--) {
      const candidate = text.slice(i, i + len)
      if (vocab.has(candidate)) {
        match = candidate
        break
      }
    }
    if (match === undefined) {
      throw new Error(
        `subsetProfile: profile ${profile.id} has no glyph matching ${JSON.stringify(text.slice(i, i + 8))} (position ${i}). ` +
          'Subsets can only narrow the compiled charset; rebuild the profile to add characters.',
      )
    }
    out.push(match)
    i += match.length
  }
  return out
}

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
 * Chromatic samples and the RGBA atlas are carried too, which is what makes a
 * palette narrowable at runtime: chromatic-v1 searches every glyph it is given,
 * so removing glyphs is the only way to stop it reaching for them.
 *
 * A string is segmented by greedy longest match against the profile's own
 * glyph strings, so multi-code-point glyphs — VS16 emoji, ZWJ sequences —
 * select correctly. The profile defines what a character is, not Unicode
 * tables, which keeps the segmentation identical on every engine. Pass an
 * array to select exact strings. Duplicate glyphs are an error, and so is any
 * part of the input the profile has no glyph for.
 */
export function subsetProfile(
  profile: AsciiProfile,
  characters: string | readonly string[],
): AsciiProfile {
  const requested =
    typeof characters === 'string' ? segmentByGlyphs(profile, characters) : [...characters]
  if (requested.length === 0) {
    throw new Error(
      'subsetProfile: empty character set. Pass at least one character, or use the profile as-is.',
    )
  }
  const seen = new Set<string>()
  for (const ch of requested) {
    if (seen.has(ch)) {
      throw new Error(
        `subsetProfile: duplicate character ${JSON.stringify(ch)}. Each glyph may appear once.`,
      )
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
  const { structural, atlas, shape6, chromatic } = profile
  const masksLo = new Uint32Array(n)
  const masksHi = new Uint32Array(n)
  const coverage = new Uint16Array(n)
  const vectors6 = shape6 ? new Float32Array(n * 6) : undefined
  const samples = chromatic ? new Uint8Array(n * 256) : undefined
  oldIds.forEach((oldId, i) => {
    masksLo[i] = structural.masksLo[oldId]
    masksHi[i] = structural.masksHi[oldId]
    coverage[i] = structural.coverage[oldId]
    if (vectors6 && shape6) vectors6.set(shape6.vectors6.subarray(oldId * 6, oldId * 6 + 6), i * 6)
    if (samples && chromatic)
      samples.set(chromatic.samples.subarray(oldId * 256, oldId * 256 + 256), i * 256)
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
  // The colour plane is repacked alongside the coverage plane, in lockstep: a
  // chromatic subset whose atlas and descriptors disagreed would match on one
  // glyph and draw another.
  const rgba = atlas.rgba ? new Uint8Array(width * height * 4) : undefined
  oldIds.forEach((oldId, i) => {
    const sx = (oldId % atlas.columns) * pitchW
    const sy = idiv(oldId, atlas.columns) * pitchH
    const dx = (i % columns) * pitchW
    const dy = idiv(i, columns) * pitchH
    for (let y = 0; y < pitchH; y++) {
      const src = (sy + y) * atlas.width + sx
      data.set(atlas.data.subarray(src, src + pitchW), (dy + y) * width + dx)
      if (rgba && atlas.rgba) {
        const src4 = ((sy + y) * atlas.width + sx) * 4
        rgba.set(atlas.rgba.subarray(src4, src4 + pitchW * 4), ((dy + y) * width + dx) * 4)
      }
    }
  })

  // Content-derived pseudo-fingerprint (same scheme as runtime profiles): a
  // subset is a distinct profile and must never pair with the parent's frames.
  let h = 0x811c9dc5
  const fnv = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193) >>> 0
  }
  for (const ch of profile.fingerprint) fnv(ch.codePointAt(0) ?? 0)
  // Hash every code point of every glyph, with a separator: hashing only the
  // first code point collides for glyphs sharing it (skin-tone variants), and
  // without the separator ['ab','c'] and ['a','bc'] would hash alike — either
  // way two distinct subsets could pair with each other's frames.
  for (const g of requested) {
    for (const ch of g) fnv(ch.codePointAt(0) ?? 0)
    fnv(0x1f)
  }
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
      ...(rgba ? { rgba } : {}),
    },
    structural: { masksLo, masksHi, coverage },
    ...(samples ? { chromatic: { samples } } : {}),
    ...(vectors6 ? { shape6: { vectors6 } } : {}),
    metadata: { ...profile.metadata, id: `${profile.id}#subset${n}`, charset: 'custom' },
  }
}
