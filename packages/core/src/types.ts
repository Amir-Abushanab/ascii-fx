/** Raw RGBA pixels. `data` length must be width · height · 4. */
export interface RawImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

export type ColorMode = 'mono' | 'foreground' | 'full'
export type AlphaMode = 'ignore' | 'mask'
/** 'structural' is exact and the default; the others are explicit opt-ins (spec §5, §11). */
export type MatcherKind = 'structural' | 'shape6' | 'ramp'
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
}

export interface StructuralGlyphData {
  masksLo: Uint32Array
  masksHi: Uint32Array
  /** 0..65535 = coverage 1.0 */
  coverage: Uint16Array
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
