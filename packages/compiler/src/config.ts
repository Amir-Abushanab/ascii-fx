import type { AlphaMode, ColorMode } from '@ascii-fx/core'

export interface AsciiProfileConfig {
  /** Path to the font file, relative to the config file. */
  font: string
  charset?: string
  characters?: string | string[]
  /** Compile shape6-v1 data (ALGORITHM.md §18); `{ lut: true }` adds the dense LUT. */
  shape6?: boolean | { lut?: boolean }
}

/** Static build-time frame (spec §16). Matching happens at build, not runtime. */
export interface AsciiFrameConfig {
  /** Path to the source image (PNG in v1), relative to the config file. */
  image: string
  /** Profile name from `profiles`. Default 'default'. */
  profile?: string
  columns?: number
  rows?: number
  color?: ColorMode
  alpha?: AlphaMode
}

export interface AsciiConfig {
  profiles: Record<string, AsciiProfileConfig>
  frames?: Record<string, AsciiFrameConfig>
}

export function defineAsciiConfig(config: AsciiConfig): AsciiConfig {
  return config
}
