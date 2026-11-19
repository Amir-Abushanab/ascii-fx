import { REVISION, RenderTarget, Vector2 } from 'three'
import type { Camera, Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { AsciiFrame, AsciiProfile, PaletteOptions } from '@ascii-fx/core'
import { AsciiEngine, AsciiStream } from '@ascii-fx/gpu/webgpu'
import type {
  AsciiPointer,
  FitMode,
  InteractionOptions,
  PostOptions,
  StreamMatchOptions,
} from '@ascii-fx/gpu'
import { getCanvasContext, getDevice, getGpuTexture, isInitialized } from './internals.js'

export interface AsciiPassOptions extends StreamMatchOptions {
  profile: AsciiProfile
  renderer: WebGPURenderer
  /**
   * Render-target resolution. Left out, it is the renderer's drawing buffer size and follows
   * it, so `renderer.setSize()` on a window resize is all a resize takes. Given here, or
   * through `setSize()`, it stays where it was put.
   */
  width?: number
  height?: number
  fit?: FitMode
  clearColor?: readonly [number, number, number, number]
  interaction?: InteractionOptions | null
  /** palette-v1 colour snap between matching and the composite; see AsciiRendererOptions. */
  palette?: PaletteOptions | null
  post?: PostOptions | null
}

type ViewOptions = {
  fit: FitMode
  clearColor: readonly [number, number, number, number]
  palette: PaletteOptions | null
  post: PostOptions | null
}

/**
 * The first three revision whose output render target can be trusted. r174–r177 have the
 * methods, but run the output pass from a buffer the size of the canvas rather than of the
 * target, so a target of any other size comes out resampled and the match is no longer
 * of the pixels that were rendered.
 */
const OUTPUT_PASS_FROM = 178

/** The output-target half of Renderer, which older three releases do not have. */
interface OutputTargetRenderer {
  setOutputRenderTarget?: (target: RenderTarget | null) => void
  getOutputRenderTarget?: () => RenderTarget | null
}

/**
 * Fullscreen ASCII postprocessing for THREE.WebGPURenderer (spec §30):
 * scene → render target → exact structural-v1 compute on Three's own
 * GPUDevice → one-draw atlas composite straight to the canvas.
 *
 * The scene is matched as it would have been displayed. The render target is set as the
 * renderer's *output* target, so three runs its own output pass into it — the renderer's
 * `toneMapping` and `outputColorSpace`, and its antialiasing — and what is matched is the
 * picture the canvas would have shown. Before three r178 the pass renders straight into
 * the target instead: linear light, no tone mapping, sRGB-encoded here before matching
 * (§28). Usage:
 *
 * ```ts
 * const pass = new AsciiPass({ profile, renderer, columns: 160 })
 * await pass.init()
 * pass.render(scene, camera) // instead of renderer.render(...)
 * ```
 */
export class AsciiPass {
  readonly renderTarget: RenderTarget
  readonly pointer: AsciiPointer

  private readonly rendererRef: WebGPURenderer
  private readonly profile: AsciiProfile
  private matchOpts: StreamMatchOptions
  private fit: FitMode | undefined
  private clearColor: readonly [number, number, number, number] | undefined
  private palette: PaletteOptions | null
  private post: PostOptions | null
  private interaction: InteractionOptions | null
  private pointerX = 0.5
  private pointerY = 0.5
  private velX = 0
  private velY = 0
  private readonly t0 = performance.now()
  private readonly drawSize = new Vector2()
  /** Whether the render target follows the renderer's drawing buffer (no explicit size). */
  private autoSize: boolean

  private engine?: AsciiEngine
  private stream?: AsciiStream
  private device?: GPUDevice
  private disposed = false

  constructor(options: AsciiPassOptions) {
    const {
      profile,
      renderer,
      width,
      height,
      fit,
      clearColor,
      interaction,
      palette,
      post,
      ...match
    } = options
    this.profile = profile
    this.rendererRef = renderer
    this.matchOpts = match
    this.fit = fit
    this.clearColor = clearColor
    this.palette = palette ?? null
    this.post = post ?? null
    this.interaction = interaction ?? null
    this.autoSize = width === undefined && height === undefined
    const size = renderer.getDrawingBufferSize(this.drawSize)
    this.renderTarget = new RenderTarget(
      width ?? Math.max(1, size.x),
      height ?? Math.max(1, size.y),
    )
    this.pointer = {
      set: (x: number, y: number) => {
        this.pointerX = x
        this.pointerY = y
      },
      setVelocity: (x: number, y: number) => {
        this.velX = x
        this.velY = y
      },
    }
  }

  /**
   * Compile pipelines on the renderer's device. Call once, and await it before the first
   * `render()`. Initializes the renderer too if nothing has yet, so an
   * `await renderer.init()` of your own is optional and harmless.
   */
  async init(): Promise<void> {
    if (this.disposed) throw new Error('AsciiPass.init() called after dispose().')
    if (this.stream) return
    // Only if nothing has: newer three hands every caller the same promise, but r170–r173
    // throw from a second init().
    if (!isInitialized(this.rendererRef)) await this.rendererRef.init()
    if (this.disposed) return
    const device = getDevice(this.rendererRef)
    const engine = await AsciiEngine.create(device, this.profile)
    if (this.disposed) {
      engine.destroy()
      return
    }
    try {
      const stream = await engine.createStream(navigator.gpu.getPreferredCanvasFormat())
      if (this.disposed) {
        stream.destroy()
        engine.destroy()
        return
      }
      this.device = device
      this.engine = engine
      this.stream = stream
    } catch (error) {
      engine.destroy()
      throw error
    }
  }

  /** Update matcher/composite options (spec §2: `ascii.set({...})`). */
  set(options: Partial<StreamMatchOptions & ViewOptions>): void {
    const { fit, clearColor, palette, post, ...match } = options
    if (fit !== undefined) this.fit = fit
    if (clearColor !== undefined) this.clearColor = clearColor
    if (palette !== undefined) this.palette = palette
    if (post !== undefined) this.post = post
    this.matchOpts = { ...this.matchOpts, ...match }
  }

  setInteraction(interaction: InteractionOptions | null): void {
    this.interaction = interaction
  }

  /** Pin the render-target resolution. After this it no longer follows the drawing buffer. */
  setSize(width: number, height: number): void {
    this.autoSize = false
    this.renderTarget.setSize(width, height)
  }

  grid(): { columns: number; rows: number } | null {
    return this.stream?.grid() ?? null
  }

  /** Render the scene through the ASCII pipeline to the canvas. */
  render(scene: Object3D, camera: Camera): void {
    if (this.disposed) return
    const stream = this.stream
    if (!stream || !this.device) {
      throw new Error(
        'AsciiPass.render() called before init() — `await pass.init()` after creating the pass.',
      )
    }
    const renderer = this.rendererRef

    const size = renderer.getDrawingBufferSize(this.drawSize)
    if (this.autoSize) {
      const w = Math.max(1, size.x)
      const h = Math.max(1, size.y)
      if (this.renderTarget.width !== w || this.renderTarget.height !== h) {
        this.renderTarget.setSize(w, h)
      }
    }

    const output = renderer as unknown as OutputTargetRenderer
    const viaOutputPass =
      OUTPUT_PASS_FROM <= Number(REVISION) &&
      typeof output.setOutputRenderTarget === 'function' &&
      typeof output.getOutputRenderTarget === 'function'
    const prev = renderer.getRenderTarget()
    if (viaOutputPass) {
      // As the output target, with no render target set: the renderer treats this exactly
      // like the canvas, so its tone mapping and colour-space conversion both run.
      const prevOutput = output.getOutputRenderTarget!()
      renderer.setRenderTarget(null)
      output.setOutputRenderTarget!(this.renderTarget)
      try {
        renderer.render(scene, camera)
      } finally {
        output.setOutputRenderTarget!(prevOutput)
        renderer.setRenderTarget(prev)
      }
    } else {
      renderer.setRenderTarget(this.renderTarget)
      renderer.render(scene, camera)
      renderer.setRenderTarget(prev)
    }

    const srcTexture = getGpuTexture(renderer, this.renderTarget.texture)
    stream.configure(srcTexture, this.renderTarget.width, this.renderTarget.height, {
      // The output pass has already encoded; a plain render target is still linear.
      srgbEncode: !viaOutputPass,
      alpha: 'ignore',
      // A motion-driven interaction needs the field computed, as the gpu renderer arranges.
      motion: this.interaction?.source === 'motion' ? (this.interaction.motion ?? {}) : undefined,
      ...this.matchOpts,
    })

    const cenc = this.device.createCommandEncoder()
    stream.encodeMatch(cenc)
    this.device.queue.submit([cenc.finish()])

    stream.syncView({
      width: size.x,
      height: size.y,
      fit: this.fit,
      clearColor: this.clearColor,
      palette: this.palette,
      post: this.post,
    })
    stream.syncFx(
      {
        interaction: this.interaction,
        pointerX: this.pointerX * size.x,
        pointerY: this.pointerY * size.y,
        velX: this.velX,
        velY: this.velY,
        time: (performance.now() - this.t0) / 1000,
      },
      size.x,
      size.y,
    )
    const enc = this.device.createCommandEncoder()
    stream.encodeComposite(enc, getCanvasContext(renderer).getCurrentTexture().createView())
    this.device.queue.submit([enc.finish()])
  }

  /** Explicit readback of the matched frame (spec §33). */
  async captureFrame(): Promise<AsciiFrame> {
    if (!this.stream)
      throw new Error('AsciiPass.captureFrame() requires init() and at least one render().')
    return this.stream.captureFrame()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.renderTarget.dispose()
    this.stream?.destroy()
    this.engine?.destroy() // engine resources only — the device belongs to Three
  }
}
