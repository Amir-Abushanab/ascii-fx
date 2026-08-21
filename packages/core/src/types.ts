/** Raw RGBA pixels. `data` length must be width · height · 4. */
export interface RawImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/**
 * 'glyph' is chromatic-v1's mode: the glyph carries its own colour, so there is
 * no foreground or background to fit and none is emitted.
 */
export type ColorMode = 'mono' | 'foreground' | 'full' | 'glyph'
export type AlphaMode = 'ignore' | 'mask'
/**
 * 'structural' is exact and the default; the others are explicit opt-ins
 * (spec §5, §11). 'chromatic' is a different algorithm rather than an
 * approximation of structural — it matches baked glyph colour instead of
 * fitting colour to a binary mask, and needs a profile carrying `chromatic`.
 */
export type MatcherKind = 'structural' | 'shape6' | 'ramp' | 'chromatic'
export type RGB = readonly [number, number, number]

export interface GlyphMetrics {
  unitsPerEm: number
  ascent: number
  descent: number
  lineGap: number
  advanceUnits: number
  /** Reference cell size / baseline in pixels (raster-v1). */
  cellWidth: number
  cellHeight: number
  baseline: number
}

export interface GlyphAtlas {
  width: number
  height: number
  pitchWidth: number
  pitchHeight: number
  cellWidth: number
  cellHeight: number
  padding: number
  columns: number
  /** R8 coverage bytes, width · height. */
  data: Uint8Array
  /**
   * Straight-alpha RGBA bytes, width · height · 4, in the same tile layout as
   * `data`. Present only in chromatic profiles — a coverage plane cannot carry
   * a glyph's own colour, and `data` stays alongside it so a chromatic profile
   * still works with the mask-fitting matchers.
   */
  rgba?: Uint8Array
}

export interface StructuralGlyphData {
  masksLo: Uint32Array
  masksHi: Uint32Array
  /** 0..65535 = coverage 1.0 */
  coverage: Uint16Array
}

export interface ChromaticGlyphData {
  /**
   * 8×8 straight-alpha RGBA per glyph, row-major, glyphCount × 256 bytes.
   * Straight rather than premultiplied so the backdrop composite stays exact
   * in integers at match time (ALGORITHM.md chromatic-v1 §C3).
   */
  samples: Uint8Array
}

export interface Shape6GlyphData {
  vectors6: Float32Array
  lut3?: Uint16Array
  lut3TopK?: Uint16Array
}

export interface ProfileMetadata {
  id: string
  charset: string
  fontFamily?: string
  fontWeight?: number
  compilerVersion: string
}

export interface AsciiProfile {
  version: number
  id: string
  /** SHA-256 hex strings. */
  fingerprint: string
  charsetHash: string
  fontHash: string
  glyphs: readonly string[]
  glyphCount: number
  metrics: GlyphMetrics
  atlas: GlyphAtlas
  structural: StructuralGlyphData
  /** Present only in profiles compiled for chromatic-v1. */
  chromatic?: ChromaticGlyphData
  shape6?: Shape6GlyphData
  metadata: ProfileMetadata
}

export interface MatchOptions {
  profile: AsciiProfile
  columns?: number
  rows?: number
  /** Default 'structural' — exact. 'shape6'/'ramp' are visible approximations, never fallbacks. */
  matcher?: MatcherKind
  /** Default 'mono'. */
  color?: ColorMode
  /** Default 'mask'. */
  alpha?: AlphaMode
  /** Fixed colors for 'mono' reconstruction / 'foreground' backdrop. */
  foreground?: RGB
  background?: RGB
  /** Integer luma units; default 15. */
  flatThreshold?: number
  /**
   * chromatic-v1 only: the previous frame's glyph ids on the same grid. Enables
   * hysteresis; ignored without it. Must come from the *same* source — passing
   * ids from a different one ghosts it into the result, since hysteresis is
   * biased toward the incumbent and does not self-correct.
   */
  previous?: Uint16Array
  /**
   * chromatic-v1 only: keep the previous glyph unless a challenger beats it by
   * this fraction of its error. Default 0 (off). Emoji differ far more from one
   * another than text glyphs do, so a near-tie that flips frame to frame reads
   * as a strobe rather than as texture.
   */
  hysteresis?: number
}

export const FLAG_FLAT = 1
export const FLAG_TRANSPARENT = 2

export interface CellInfo {
  glyph: string
  glyphId: number
  foreground: [number, number, number, number] | null
  background: [number, number, number, number] | null
  flags: number
}

export interface AsciiSupport {
  webgpu: boolean
  webgl2: boolean
  worker: boolean
  offscreenCanvas: boolean
  recommendedBackend: 'webgpu' | 'cpu-worker' | 'cpu'
  limitations: string[]
}
