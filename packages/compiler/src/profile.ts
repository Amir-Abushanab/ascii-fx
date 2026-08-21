import { createHash } from 'node:crypto'
import type { AsciiProfile, Shape6GlyphData } from '@ascii-fx/core'
import { encodeProfile, idiv, nextPow2, rdiv, resolveCharset, shape6BucketCenter } from '@ascii-fx/core'
import { loadFont } from './font.js'
import {
  CUBIC_SEGMENTS,
  QUAD_SEGMENTS,
  SUPERSAMPLE,
  deriveMask,
  flattenCommands,
  maskTotals,
  rasterizeGlyph,
} from './raster.js'

export const COMPILER_VERSION = '0.1.0'
export const REF_GLYPH_HEIGHT = 64
export const ATLAS_PADDING = 4

export interface BuildProfileOptions {
  /** Raw font bytes (ttf/otf/woff/woff2). */
  font: Uint8Array
  id?: string
  /** Built-in charset name; default 'ascii'. */
  charset?: string
  /** Custom characters (overrides charset). */
  characters?: string | readonly string[]
  /**
   * Compile shape6-v1 data (ALGORITHM.md §18): 6D glyph vectors, and with
   * `{ lut: true }` the 512KiB dense winner LUT. Opt-in — it grows the profile
   * and only the explicit `matcher: 'shape6'` uses it (spec §5–6).
   */
  shape6?: boolean | { lut?: boolean }
}

export interface BuiltProfile {
  profile: AsciiProfile
  binary: Uint8Array
}

export const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')

/** Glyph-side shape6 vector (ALGORITHM.md §18): float64 means over mask-cell lumas. */
function glyphShape6(lumas: Float64Array, out: Float32Array, at: number): void {
  let sum = 0
  let top = 0
  let left = 0
  let tl = 0
  let tr = 0
  let bl = 0
  let br = 0
  let center = 0
  for (let m = 0; m < 64; m++) {
    const row = m >> 3
    const col = m & 7
    const v = lumas[m]
    sum += v
    if (row < 4) top += v
    if (col < 4) left += v
    if (row < 4) {
      if (col < 4) tl += v
      else tr += v
    } else if (col < 4) bl += v
    else br += v
    if (row >= 2 && row < 6 && col >= 2 && col < 6) center += v
  }
  const v0 = sum / 64
  out[at] = v0
  out[at + 1] = top / 32 - (sum - top) / 32
  out[at + 2] = left / 32 - (sum - left) / 32
  out[at + 3] = (tl + br - tr - bl) / 32
  out[at + 4] = center / 16 - (sum - center) / 48
  let dev = 0
  for (let m = 0; m < 64; m++) dev += Math.abs(lumas[m] - v0)
  out[at + 5] = dev / 64
}

/** Build a deterministic .asciip profile (ALGORITHM.md §13–14). */
export function buildProfile(options: BuildProfileOptions): BuiltProfile {
  const { name: charsetName, glyphs } = resolveCharset(options.charset, options.characters)
  const lf = loadFont(options.font)

  const missing = glyphs.filter((g) => !lf.font.hasGlyphForCodePoint(g.codePointAt(0)!))
  if (missing.length > 0) {
    throw new Error(
      `Font "${lf.familyName ?? 'unknown'}" has no glyph for: ${missing
        .map((c) => `${JSON.stringify(c)} (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`)
        .join(', ')}. Remove them from the charset or pick a font that covers them.`,
    )
  }

  const fontGlyphs = glyphs.map((g) => lf.font.glyphForCodePoint(g.codePointAt(0)!))
  const advance = fontGlyphs[0].advanceWidth
  const proportional = glyphs.filter((_, i) => fontGlyphs[i].advanceWidth !== advance)
  if (proportional.length > 0) {
    throw new Error(
      `Font "${lf.familyName ?? 'unknown'}" is not monospace over this charset — differing advances for: ${proportional
        .slice(0, 8)
        .map((c) => JSON.stringify(c))
        .join(', ')}${proportional.length > 8 ? ', …' : ''}. v1 requires a monospace font.`,
    )
  }

  const unitsCell = lf.ascent - lf.descent
  if (!(unitsCell > 0)) throw new Error('Font reports non-positive ascent−descent; cannot derive a cell box.')
  const cellH = REF_GLYPH_HEIGHT
  const cellW = Math.max(1, rdiv(advance * REF_GLYPH_HEIGHT, unitsCell))
  const baseline = rdiv(lf.ascent * REF_GLYPH_HEIGHT, unitsCell)
  const baselineFx = rdiv(lf.ascent * REF_GLYPH_HEIGHT * 64, unitsCell)
  const map = {
    x: (v: number) => rdiv(v * REF_GLYPH_HEIGHT * 64, unitsCell),
    y: (v: number) => baselineFx - rdiv(v * REF_GLYPH_HEIGHT * 64, unitsCell),
  }

  const n = glyphs.length
  const masksLo = new Uint32Array(n)
  const masksHi = new Uint32Array(n)
  const coverage = new Uint16Array(n)

  const pitchW = nextPow2(cellW + 2 * ATLAS_PADDING)
  const pitchH = nextPow2(cellH + 2 * ATLAS_PADDING)
  let atlasColumns = 1
  while (atlasColumns * atlasColumns < n) atlasColumns++
  const atlasRows = idiv(n + atlasColumns - 1, atlasColumns)
  const atlasW = atlasColumns * pitchW
  const atlasH = atlasRows * pitchH
  const atlasData = new Uint8Array(atlasW * atlasH)

  const totals = maskTotals(cellW, cellH)
  const subsamplesPerCell = cellW * cellH * SUPERSAMPLE * SUPERSAMPLE
  const wantShape6 = options.shape6 !== undefined && options.shape6 !== false
  const cellLumas = wantShape6 ? new Float64Array(n * 64) : undefined

  for (let i = 0; i < n; i++) {
    const edges = flattenCommands(fontGlyphs[i].path.commands, map)
    const raster = rasterizeGlyph(edges, cellW, cellH)
    const mask = deriveMask(raster.maskHits, totals)
    masksLo[i] = mask.lo
    masksHi[i] = mask.hi
    coverage[i] = rdiv(raster.totalHits * 65535, subsamplesPerCell)
    if (cellLumas) {
      for (let m = 0; m < 64; m++) cellLumas[i * 64 + m] = (raster.maskHits[m] / totals[m]) * 255
    }
    const tileX = (i % atlasColumns) * pitchW + ATLAS_PADDING
    const tileY = idiv(i, atlasColumns) * pitchH + ATLAS_PADDING
    for (let py = 0; py < cellH; py++) {
      const dst = (tileY + py) * atlasW + tileX
      const src = py * cellW
      for (let px = 0; px < cellW; px++) {
        atlasData[dst + px] = rdiv(raster.hits[src + px] * 255, SUPERSAMPLE * SUPERSAMPLE)
      }
    }
  }

  let shape6: Shape6GlyphData | undefined
  if (cellLumas) {
    const vectors6 = new Float32Array(n * 6)
    for (let i = 0; i < n; i++) glyphShape6(cellLumas.subarray(i * 64, i * 64 + 64), vectors6, i * 6)
    let lut3: Uint16Array | undefined
    if (typeof options.shape6 === 'object' && options.shape6.lut) {
      lut3 = new Uint16Array(8 ** 6)
      const center = new Float64Array(6)
      for (let idx = 0; idx < lut3.length; idx++) {
        shape6BucketCenter(idx, center)
        let best = 0
        let bestD = Infinity
        for (let g = 0; g < n; g++) {
          let d = 0
          for (let c = 0; c < 6; c++) {
            const e = center[c] - vectors6[g * 6 + c]
            d += e * e
          }
          if (d < bestD) {
            bestD = d
            best = g
          }
        }
        lut3[idx] = best
      }
    }
    shape6 = { vectors6, lut3 }
  }

  const fontHash = sha256(options.font)
  const charsetHash = sha256(glyphs.join('\u0000'))
  const fingerprint = sha256(
    `asciip/1|structural-v1|raster-v1|font:${fontHash}|charset:${charsetHash}` +
      `|H:${REF_GLYPH_HEIGHT}|S:${SUPERSAMPLE}|pad:${ATLAS_PADDING}|quad:${QUAD_SEGMENTS}|cubic:${CUBIC_SEGMENTS}`,
  )

  const profile: AsciiProfile = {
    version: 1,
    id: options.id ?? 'default',
    fingerprint,
    charsetHash,
    fontHash,
    glyphs,
    glyphCount: n,
    metrics: {
      unitsPerEm: lf.unitsPerEm,
      ascent: lf.ascent,
      descent: lf.descent,
      lineGap: lf.lineGap,
      advanceUnits: advance,
      cellWidth: cellW,
      cellHeight: cellH,
      baseline,
    },
    atlas: {
      width: atlasW,
      height: atlasH,
      pitchWidth: pitchW,
      pitchHeight: pitchH,
      cellWidth: cellW,
      cellHeight: cellH,
      padding: ATLAS_PADDING,
      columns: atlasColumns,
      data: atlasData,
    },
    structural: { masksLo, masksHi, coverage },
    shape6,
    metadata: {
      id: options.id ?? 'default',
      charset: charsetName,
      fontFamily: lf.familyName,
      fontWeight: lf.weight,
      compilerVersion: COMPILER_VERSION,
    },
  }

  return { profile, binary: encodeProfile(profile) }
}
