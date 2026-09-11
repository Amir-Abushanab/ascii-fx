import type { AlphaMode, AsciiProfile, ColorMode, MotionOptions, RGB } from '@ascii-fx/core'

/**
 * The scalar half of MatchOptions — everything `matchBand` reads that is not
 * the profile, which the worker is sent once at init rather than per frame.
 */
export interface BandOptions {
  color: ColorMode
  alpha: AlphaMode
  flatThreshold?: number
  foreground?: RGB
  background?: RGB
  /**
   * Exact temporal reuse (spec §21). Each worker keeps its own band's previous
   * samples and cells and skips the ones that did not move, which is why the
   * pool has to hand a band to the same worker every frame.
   */
  temporal?: boolean
  /**
   * Ask each band for a motion field (ALGORITHM.md §21) alongside its cells.
   * Independent of `temporal` — the field carries its own previous-luma state
   * rather than reading the retained samples.
   */
  motion?: MotionOptions | false
}

export interface InitRequest {
  type: 'init'
  profile: AsciiProfile
}

/** One band of one frame: a source strip in, that band's cells out. */
export interface MatchRequest {
  type: 'match'
  /** Bumped whenever the source or options change; stale replies are dropped. */
  generation: number
  columns: number
  rows: number
  rowStart: number
  rowEnd: number
  width: number
  sourceHeight: number
  yOffset: number
  stripHeight: number
  strip: ArrayBuffer
  options: BandOptions
}

export type WorkerRequest = InitRequest | MatchRequest

export interface ReadyResponse {
  type: 'ready'
}

export interface CellsResponse {
  type: 'cells'
  generation: number
  rowStart: number
  rowEnd: number
  glyphIds: Uint16Array
  foreground?: Uint32Array
  background?: Uint32Array
  flags: Uint16Array
  /** Per-cell motion (§21), present only when the request asked for it. */
  motion?: Uint8Array
}

export interface ErrorResponse {
  type: 'error'
  generation: number
  message: string
}

export type WorkerResponse = ReadyResponse | CellsResponse | ErrorResponse
