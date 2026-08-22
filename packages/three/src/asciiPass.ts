import { RenderTarget, Vector2 } from 'three'
import type { Camera, Object3D } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { AsciiFrame, AsciiProfile } from '@ascii-fx/core'
import { AsciiEngine, AsciiStream } from '@ascii-fx/gpu'
import type { AsciiPointer, FitMode, InteractionOptions, StreamMatchOptions } from '@ascii-fx/gpu'
import { getCanvasContext, getDevice, getGpuTexture } from './internals.js'

export interface AsciiPassOptions extends StreamMatchOptions {
  profile: AsciiProfile
  renderer: WebGPURenderer
  /** Render-target resolution; defaults to the renderer's drawing buffer size. */
  width?: number
  height?: number
  fit?: FitMode
  clearColor?: readonly [number, number, number, number]
  interaction?: InteractionOptions | null
}

/**
 * Fullscreen ASCII postprocessing for THREE.WebGPURenderer (spec §30):
 * scene → render target → exact structural-v1 compute on Three's own
 * GPUDevice → one-draw atlas composite straight to the canvas.
 *
 * The render target holds linear-light values, so the source is sRGB-encoded
 * before matching (§28). Usage:
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
  private interaction: InteractionOptions | null
  private pointerX = 0.5
  private pointerY = 0.5
  private velX = 0
  private velY = 0
  private readonly t0 = performance.now()
  private readonly drawSize = new Vector2()

  private engine?: AsciiEngine
  private stream?: AsciiStream
  private device?: GPUDevice
  private disposed = false

  constructor(options: AsciiPassOptions) {
    const { profile, renderer, width, height, fit, clearColor, interaction, ...match } = options
    this.profile = profile
    this.rendererRef = renderer
    this.matchOpts = match
    this.fit = fit
    this.clearColor = clearColor
    this.interaction = interaction ?? null
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

  /** Compile pipelines on the renderer's device. Call once after renderer.init(). */
  async init(): Promise<void> {
    if (this.disposed) throw new Error('AsciiPass.init() called after dispose().')
    if (this.stream) return
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
  set(
    options: Partial<
      StreamMatchOptions & { fit: FitMode; clearColor: readonly [number, number, number, number] }
    >,
  ): void {
    const { fit, clearColor, ...match } = options
    if (fit !== undefined) this.fit = fit
    if (clearColor !== undefined) this.clearColor = clearColor
    this.matchOpts = { ...this.matchOpts, ...match }
  }

  setInteraction(interaction: InteractionOptions | null): void {
    this.interaction = interaction
  }

  setSize(width: number, height: number): void {
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

    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.renderTarget)
    renderer.render(scene, camera)
    renderer.setRenderTarget(prev)

    const srcTexture = getGpuTexture(renderer, this.renderTarget.texture)
    stream.configure(srcTexture, this.renderTarget.width, this.renderTarget.height, {
      srgbEncode: true,
      alpha: 'ignore',
      ...this.matchOpts,
    })

    const cenc = this.device.createCommandEncoder()
    stream.encodeMatch(cenc)
    this.device.queue.submit([cenc.finish()])

    const size = renderer.getDrawingBufferSize(this.drawSize)
    stream.syncView({ width: size.x, height: size.y, fit: this.fit, clearColor: this.clearColor })
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
