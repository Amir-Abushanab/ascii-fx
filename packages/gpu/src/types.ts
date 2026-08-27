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
   * drawn over `background`. A `clearColor` with alpha < 1 asks for the same.
   * The approximate CPU matchers are not offered here.
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
  /**
   * Letterbox/clear color (rgba 0..1). Default: transparent for 'foreground', the
   * backdrop for chromatic, opaque black otherwise. Alpha < 1 asks for a see-through
   * ground: it configures the canvas for transparency and drops the background plane
   * baked into the grid for mono and chromatic frames, so the page shows through glyph
   * gaps and blank cells — mono stays a fixed foreground over that ground. 'full' keeps
   * its per-cell sampled background either way (that plane is content, not a backdrop);
   * there, transparency comes from `alpha: 'mask'` cells and the letterbox alone.
   */
  clearColor?: readonly [number, number, number, number]
  interaction?: InteractionOptions | null
  /**
   * Matcher workers for the CPU backend (spec §11 tier 2). Default: one per
   * core, less one for the main thread's extract and composite, capped at 8.
   * `false` keeps matching on the main thread; a number pins the pool size.
   *
   * Workers change *when* a live source's cells arrive, never what they are:
   * bands are matched by the same `matchBand` the main thread runs and the
   * assembled result is byte-identical. The cost is one frame of latency on
   * live sources, since a frame is presented while the next one matches. The
   * first frame, static sources, and `captureFrame()` are matched inline and
   * carry no latency at all.
   */
  workers?: number | false

  /**
   * How the CPU backend paints (spec §12; internal, and offered only as an
   * escape hatch). Default 'auto': a WebGL2 fullscreen composite where WebGL2
   * exists, Canvas2D otherwise. 'canvas2d' forces the Canvas2D path.
   *
   * These are not pixel-identical. The Canvas2D path builds the grid at native
   * atlas cell size and scales it down; the WebGL2 one samples a mipped atlas,
   * which is what the WebGPU backend does — so 'auto' is also the closer match
   * to the GPU output, and it runs the interactions as the real shader rather
   * than the Canvas2D approximation of them at cell granularity.
   */
  compositor?: 'auto' | 'canvas2d'

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
  Omit<
    AsciiRendererOptions,
    'canvas' | 'profile' | 'backend' | 'workers' | 'compositor' | 'onDeviceLost' | 'onError'
  >
>

/**
 * Whether the frame this configuration produces can contain transparency at all.
 *
 * `color: 'foreground'` has always meant glyphs over a see-through ground, and a
 * `clearColor` with alpha < 1 is the caller asking for one in any colour mode. This used
 * to be `color === 'foreground'` alone, which made two documented options contradict each
 * other: `alpha: 'mask'` flags transparent cells in every colour mode and the compositor
 * honours them, but an opaque canvas cannot present them — so `alpha: 'mask'` with
 * `color: 'full'` produced cells that were transparent everywhere except on screen.
 * Deliberately *not* `alpha === 'mask'` either: that is the default, so keying on it would
 * make every WebGPU canvas premultiplied and give up the opaque fast path for the common
 * case — a source with no transparent pixels needs no blending against the page.
 *
 * Two decisions key on this predicate and must agree: the WebGPU canvas's alphaMode, and
 * whether the base composite bakes an opaque background plane into the frame (mono's
 * `background`, chromatic's backdrop). 0.3.0 split them — the canvas was declared
 * transparent while every in-grid cell stayed opaque, so a mono overlay still presented
 * as a slab and only the letterbox let the page through.
 */
export const outputCanBeTransparent = (
  opts: Pick<AsciiRendererOptions, 'color' | 'clearColor'>,
): boolean => {
  if ((opts.color ?? 'mono') === 'foreground') return true
  return opts.clearColor !== undefined && opts.clearColor[3] < 1
}

/**
 * What the CPU backend actually resolved to. `backend` alone says 'cpu' for
 * three quite different pipelines, and which one you got depends on runtime
 * capability rather than on anything the caller asked for — so it has to be
 * readable, or a machine silently on the slow path looks like a fast one.
 */
export interface AsciiPipeline {
  matcher: 'workers' | 'main-thread'
  compositor: 'webgl2' | 'canvas2d'
}

export interface AsciiRenderer {
  readonly backend: 'webgpu' | 'cpu'
  /** CPU backend only; absent on WebGPU, where the whole pipeline is the GPU. */
  readonly pipeline?: AsciiPipeline
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
