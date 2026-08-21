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
  /**
   * Default 'structural'. 'chromatic' needs a profile carrying chromatic glyph
   * data; the glyph carries its own colour (ALGORITHM.md §C), so `color`'s
   * plane selection and `foreground` are ignored — except that
   * `color: 'foreground'` keeps its transparent-canvas meaning: glyphs are
   * emitted with their own alpha for the page to composite, instead of being
   * drawn over `background`. The approximate CPU matchers are not offered here.
   */
  matcher?: 'structural' | 'chromatic'
  alpha?: AlphaMode
  foreground?: RGB
  background?: RGB
  flatThreshold?: number
  /** chromatic-v1 only (§C5): keep the previous glyph unless a challenger beats it by this fraction. */
  hysteresis?: number
  /** How the ASCII grid maps onto the canvas. Default 'contain'. */
  fit?: FitMode
  /** Letterbox/clear color (rgba 0..1). Default: transparent for 'foreground', the backdrop for chromatic, opaque black otherwise. */
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
  /**
   * Called when the GPU device is lost and the renderer could not rebuild on a
   * new one. A device can go at any time — a browser under memory pressure will
   * drop it, and WebKit does this readily — and once it does, every submit is
   * silently discarded, so a renderer that ignores it keeps reporting a healthy
   * frame rate while the canvas shows a stale frame.
   *
   * The renderer tries to recover by itself first and only calls this when that
   * fails. Recovery cannot cross backends: the canvas is bound to its 'webgpu'
   * context for good, so falling back to the CPU matcher needs a fresh <canvas>
   * element, which only the caller can swap in. WebGPU backend only.
   */
  onDeviceLost?: (info: GPUDeviceLostInfo) => void
  /**
   * Called when the GPU reports an error the renderer did not catch — a resource
   * or dispatch that failed validation at run time. WebGPU never throws for
   * these, it drops the work, so without a handler the canvas quietly stops
   * being correct and there is no signal anywhere that anything went wrong.
   * Defaults to logging. WebGPU backend only.
   */
  onError?: (error: GPUError) => void
}

export type AsciiRendererRuntimeOptions = Partial<
  Omit<AsciiRendererOptions, 'canvas' | 'profile' | 'backend' | 'onDeviceLost' | 'onError'>
>

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
