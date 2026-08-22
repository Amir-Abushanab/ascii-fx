// Builds chromatic-v1 profiles (ALGORITHM.md §C) from decoded colour images
// rather than from a font. There is no rasterization step: colour emoji ship as
// PNG assets (Noto, Twemoji, Fluent) or as bitmap strikes inside a font, so the
// deterministic path is decode-then-box-filter, not outline flattening. That
// makes raster-v1 (§13) inapplicable here by construction, not by omission.

import type { AsciiProfile, RawImage } from '@ascii-fx/core'
import { encodeProfile, idiv, nextPow2, rdiv } from '@ascii-fx/core'
import { COMPILER_VERSION, sha256 } from './profile.js'

const ATLAS_PADDING = 4
/**
 * Reference cell for chromatic profiles. Square, unlike a text cell, and sized
 * so `cell + 2 * ATLAS_PADDING` is already a power of two: the pow2 pitch rule
 * (§13) exists so padding survives mip levels, and any other cell size rounds
 * up and wastes the difference. 32 would round 40 up to 64 and throw away 61%
 * of the atlas; 24 fits 32 exactly. The efficient sizes are 24, 56, and 120.
 */
export const CHROMATIC_CELL = 24
export const CHROMATIC_RASTER_VERSION = 'raster-chromatic-v1'

export interface ChromaticGlyphSource {
  /** The grapheme this glyph draws; may be several code points (ZWJ, VS16, modifiers). */
  char: string
  image: RawImage
}

export interface BuildChromaticOptions {
  glyphs: readonly ChromaticGlyphSource[]
  /** Reference cell size in px, square. Default CHROMATIC_CELL (24). */
  cellSize?: number
  id?: string
}

export interface BuiltChromaticProfile {
  profile: AsciiProfile
  binary: Uint8Array
}

/**
 * Alpha-weighted box filter, the same rule as reduce-v1 (§4): colour is
 * weighted by alpha so transparent pixels cannot drag the mean toward whatever
 * RGB happens to sit under them, while alpha itself is a plain mean.
 */
function boxFilter(img: RawImage, tw: number, th: number): Uint8Array {
  const { width: w, height: h, data } = img
  const out = new Uint8Array(tw * th * 4)
  for (let ty = 0; ty < th; ty++) {
    const y0 = idiv(ty * h, th)
    const y1 = Math.max(y0 + 1, idiv((ty + 1) * h, th))
    for (let tx = 0; tx < tw; tx++) {
      const x0 = idiv(tx * w, tw)
      const x1 = Math.max(x0 + 1, idiv((tx + 1) * w, tw))
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * w + x) * 4
          const a = data[p + 3]
          sr += data[p] * a
          sg += data[p + 1] * a
          sb += data[p + 2] * a
          sa += a
          count++
        }
      }
      const q = (ty * tw + tx) * 4
      if (sa === 0) {
        out[q] = 0
        out[q + 1] = 0
        out[q + 2] = 0
        out[q + 3] = 0
      } else {
        out[q] = rdiv(sr, sa)
        out[q + 1] = rdiv(sg, sa)
        out[q + 2] = rdiv(sb, sa)
        out[q + 3] = rdiv(sa, count)
      }
    }
  }
  return out
}

export function buildChromaticProfile(options: BuildChromaticOptions): BuiltChromaticProfile {
  const sources = options.glyphs
  const n = sources.length
  if (n === 0) throw new Error('buildChromaticProfile needs at least one glyph.')
  if (n > 65536)
    throw new Error(`Chromatic profiles hold at most 65536 glyphs (got ${n}); glyph ids are u16.`)

  const seen = new Set<string>()
  for (const g of sources) {
    if (g.char.length === 0) throw new Error('A chromatic glyph has an empty character.')
    if (seen.has(g.char)) {
      throw new Error(
        `Duplicate chromatic glyph ${JSON.stringify(g.char)}. Each grapheme may appear once.`,
      )
    }
    seen.add(g.char)
    if (g.image.width < 1 || g.image.height < 1) {
      throw new Error(`Glyph ${JSON.stringify(g.char)} has an empty image.`)
    }
    if (g.image.data.length !== g.image.width * g.image.height * 4) {
      throw new Error(`Glyph ${JSON.stringify(g.char)} image data is not width * height * 4.`)
    }
  }

  const cell = options.cellSize ?? CHROMATIC_CELL
  if (!Number.isInteger(cell) || cell < 8)
    throw new Error(`cellSize must be an integer >= 8 (got ${cell}).`)

  const pitch = nextPow2(cell + 2 * ATLAS_PADDING)
  let atlasColumns = 1
  while (atlasColumns * atlasColumns < n) atlasColumns++
  const atlasRows = idiv(n + atlasColumns - 1, atlasColumns)
  const atlasW = atlasColumns * pitch
  const atlasH = atlasRows * pitch

  const coverageAtlas = new Uint8Array(atlasW * atlasH)
  const rgbaAtlas = new Uint8Array(atlasW * atlasH * 4)
  const samples = new Uint8Array(n * 256)
  const masksLo = new Uint32Array(n)
  const masksHi = new Uint32Array(n)
  const coverage = new Uint16Array(n)

  for (let i = 0; i < n; i++) {
    const tile = boxFilter(sources[i].image, cell, cell)
    const tileX = (i % atlasColumns) * pitch + ATLAS_PADDING
    const tileY = idiv(i, atlasColumns) * pitch + ATLAS_PADDING
    let totalAlpha = 0
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const src = (y * cell + x) * 4
        const dst = (tileY + y) * atlasW + tileX + x
        rgbaAtlas[dst * 4] = tile[src]
        rgbaAtlas[dst * 4 + 1] = tile[src + 1]
        rgbaAtlas[dst * 4 + 2] = tile[src + 2]
        rgbaAtlas[dst * 4 + 3] = tile[src + 3]
        // The coverage plane is the alpha channel, which keeps blankGlyphId and
        // every structural consumer meaningful on a chromatic profile.
        coverageAtlas[dst] = tile[src + 3]
        totalAlpha += tile[src + 3]
      }
    }
    coverage[i] = rdiv(totalAlpha * 65535, cell * cell * 255)

    const small = boxFilter(sources[i].image, 8, 8)
    samples.set(small, i * 256)
    let lo = 0
    let hi = 0
    for (let k = 0; k < 64; k++) {
      // Same 0.5 threshold as raster-v1's mask rule (§13); ties are ink.
      if (small[k * 4 + 3] >= 128) {
        if (k < 32) lo |= 1 << k
        else hi |= 1 << (k - 32)
      }
    }
    masksLo[i] = lo >>> 0
    masksHi[i] = hi >>> 0
  }

  const glyphs = sources.map((g) => g.char)
  // There is no font, so the slot carrying a font's identity carries the
  // identity of the source images instead: same role, different provenance.
  let total = 0
  for (const g of sources) total += g.image.data.length
  const imageBytes = new Uint8Array(total)
  let at = 0
  for (const g of sources) {
    imageBytes.set(
      g.image.data instanceof Uint8Array ? g.image.data : new Uint8Array(g.image.data),
      at,
    )
    at += g.image.data.length
  }
  const sourceHash = sha256(imageBytes)
  const charsetHash = sha256(glyphs.join(' '))
  const fingerprint = sha256(
    `asciip/1|chromatic-v1|${CHROMATIC_RASTER_VERSION}|images:${sourceHash}|charset:${charsetHash}` +
      `|cell:${cell}|pad:${ATLAS_PADDING}`,
  )

  const profile: AsciiProfile = {
    version: 1,
    id: options.id ?? 'chromatic',
    fingerprint,
    charsetHash,
    fontHash: sourceHash,
    glyphs,
    glyphCount: n,
    // A chromatic cell is square and has no baseline; these describe that box so
    // grid-v1 derives square cells without the matcher special-casing anything.
    metrics: {
      unitsPerEm: cell,
      ascent: cell,
      descent: 0,
      lineGap: 0,
      advanceUnits: cell,
      cellWidth: cell,
      cellHeight: cell,
      baseline: cell,
    },
    atlas: {
      width: atlasW,
      height: atlasH,
      pitchWidth: pitch,
      pitchHeight: pitch,
      cellWidth: cell,
      cellHeight: cell,
      padding: ATLAS_PADDING,
      columns: atlasColumns,
      data: coverageAtlas,
      rgba: rgbaAtlas,
    },
    structural: { masksLo, masksHi, coverage },
    chromatic: { samples },
    metadata: {
      id: options.id ?? 'chromatic',
      charset: 'chromatic',
      compilerVersion: COMPILER_VERSION,
    },
  }

  return { profile, binary: encodeProfile(profile) }
}
