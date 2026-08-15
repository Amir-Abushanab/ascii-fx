import type { AlphaMode, AsciiFrame, AsciiProfile, ColorMode, RGB, RawImage } from '@ascii-fx/core'

export type BackendChoice = 'auto' | 'webgpu' | 'cpu'
export type FitMode = 'cover' | 'contain' | 'stretch'

export type RenderSource =
  | RawImage
  | ImageData
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | HTMLVideoElement
  | VideoFrame

export type InteractionType =
  | 'reveal'
  | 'displace'
  | 'wave'
  | 'push'
  | 'color'
  | 'glyph-scale'
  | 'glyph-rotate'
  | 'original-mix'
  | 'resolution'

/** Composite-stage interaction (spec §9). Never triggers rematching. */
export interface InteractionOptions {
  type: InteractionType
  /** Fraction of the canvas's smaller dimension. Default 0.15. */
  radius?: number
  /** Edge softness, same units as radius. Default 0.06. */
  feather?: number
  /** Effect strength. Default 1. */
  intensity?: number
}

export interface AsciiPointer {
  /** Normalized canvas coordinates (0..1, top-left origin). */
  set(x: number, y: number): void
  setVelocity(x: number, y: number): void
}

export interface AsciiRendererOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas
  profile: AsciiProfile
  /** Default 'auto': WebGPU when available, exact CPU otherwise. Never approximate. */
  backend?: BackendChoice
  columns?: number
  rows?: number
  color?: ColorMode
  alpha?: AlphaMode
  foreground?: RGB
  background?: RGB
  flatThreshold?: number
  /** How the ASCII grid maps onto the canvas. Default 'contain'. */
  fit?: FitMode
  /** Letterbox/clear color (rgba 0..1). Default opaque black; transparent for 'foreground'. */
  clearColor?: readonly [number, number, number, number]
  interaction?: InteractionOptions | null
  /** Exact temporal reuse for video/live sources (spec §21). WebGPU backend only. */
  temporal?: boolean
  /**
   * Adapt columns downward under sustained frame pressure with hysteresis
   * (spec §46). Continuous rendering only; the actual grid is reported by
   * grid(). Explicit resolution stays the upper bound.
   */
  adaptiveResolution?: boolean
}

export type AsciiRendererRuntimeOptions = Partial<Omit<AsciiRendererOptions, 'canvas' | 'profile' | 'backend'>>

export interface AsciiRenderer {
  readonly backend: 'webgpu' | 'cpu'
  readonly profile: AsciiProfile
  /** Composite-stage pointer (spec §9). Never reruns matching. */
  readonly pointer: AsciiPointer
  /** Grid dimensions; null until a source is set. */
  grid(): { columns: number; rows: number } | null
  setSource(source: RenderSource): void
  render(): void
  /** Continuous rendering: requestVideoFrameCallback for videos, rAF otherwise. */
  start(): void
  stop(): void
  setOptions(options: AsciiRendererRuntimeOptions): void
  /** Composite-stage interaction; null disables. Never reruns matching. */
  setInteraction(interaction: InteractionOptions | null): void
  /** Set canvas size in device pixels. Composite-only unless the grid changes. */
  resize(width: number, height: number): void
  /**
   * Declare that only this source-pixel region changed (spec §22): the source
   * re-uploads but matching re-runs only for the affected cells.
   */
  invalidate(rect: { x: number; y: number; width: number; height: number }): void
  /** Explicit readback (spec §33) — never called by the render loop. */
  captureFrame(): Promise<AsciiFrame>
  toBlob(type?: string, quality?: number): Promise<Blob>
  destroy(): void
}

export const isRawImage = (s: unknown): s is RawImage => {
  const r = s as RawImage
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    (r.data instanceof Uint8Array || r.data instanceof Uint8ClampedArray)
  )
}

export const sourceDims = (s: RenderSource): [number, number] => {
  if (typeof HTMLImageElement !== 'undefined' && s instanceof HTMLImageElement) {
    return [s.naturalWidth, s.naturalHeight]
  }
  if (typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement) {
    return [s.videoWidth, s.videoHeight]
  }
  if (typeof VideoFrame !== 'undefined' && s instanceof VideoFrame) {
    return [s.displayWidth, s.displayHeight]
  }
  return [(s as { width: number }).width, (s as { height: number }).height]
}

/** Live sources change between frames and are re-uploaded by the loop. */
export const isLiveSource = (s: RenderSource): boolean =>
  (typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement) ||
  (typeof HTMLCanvasElement !== 'undefined' && s instanceof HTMLCanvasElement) ||
  (typeof OffscreenCanvas !== 'undefined' && s instanceof OffscreenCanvas)
