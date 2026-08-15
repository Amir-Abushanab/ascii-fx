import type { AsciiFrame, AsciiProfile } from '@ascii-fx/core'
import { AsciiEngine, AsciiStream } from './engine.js'
import { MAX_GPU_GLYPHS } from './shaders.js'
import type {
  AsciiPointer,
  AsciiRenderer,
  AsciiRendererOptions,
  AsciiRendererRuntimeOptions,
  InteractionOptions,
  RenderSource,
} from './types.js'
import { isLiveSource, isRawImage, sourceDims } from './types.js'

export class WebGpuAsciiRenderer implements AsciiRenderer {
  readonly backend = 'webgpu' as const
  readonly profile: AsciiProfile
  readonly pointer: AsciiPointer

  private readonly device: GPUDevice
  private readonly context: GPUCanvasContext
  private readonly format: GPUTextureFormat
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas
  private readonly engine: AsciiEngine
  private readonly stream: AsciiStream

  private opts: AsciiRendererRuntimeOptions
  private source?: RenderSource
  private sourceLive = false
  private srcTexture?: GPUTexture
  private srcW = 0
  private srcH = 0

  private sourceDirty = false
  private matchDirty = true
  private compositeDirty = true
  private pendingRect?: { x: number; y: number; width: number; height: number }

  private adaptiveScale = 1
  private adaptiveEma = 1000 / 60
  private adaptiveHealthy = 0
  private adaptiveCooldown = 0
  private lastTickAt = 0

  private interaction: InteractionOptions | null = null
  private pointerX = 0.5
  private pointerY = 0.5
  private velX = 0
  private velY = 0
  private readonly t0 = performance.now()
  private renderScheduled = false

  private running = false
  private rafId = 0
  private rvfcId = 0
  private destroyed = false

  private constructor(init: {
    options: AsciiRendererOptions
    device: GPUDevice
    context: GPUCanvasContext
    format: GPUTextureFormat
    engine: AsciiEngine
    stream: AsciiStream
  }) {
    const { options } = init
    this.profile = options.profile
    this.canvas = options.canvas
    const { canvas: _c, profile: _p, backend: _b, interaction, ...rest } = options
    this.opts = rest
    this.interaction = interaction ?? null
    this.device = init.device
    this.context = init.context
    this.format = init.format
    this.engine = init.engine
    this.stream = init.stream
    this.pointer = {
      set: (x: number, y: number) => {
        this.pointerX = x
        this.pointerY = y
        this.scheduleRender()
      },
      setVelocity: (x: number, y: number) => {
        this.velX = x
        this.velY = y
      },
    }
    this.configureContext()
  }

  static async create(options: AsciiRendererOptions): Promise<WebGpuAsciiRenderer> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      throw new Error('WebGPU is unavailable in this environment (navigator.gpu missing).')
    }
    // Fail BEFORE touching the canvas: acquiring a 'webgpu' context locks the
    // canvas to that mode forever, which would break the CPU fallback's 2d
    // context. Everything that can fail cheaply is checked first.
    if (options.profile.glyphCount > MAX_GPU_GLYPHS) {
      throw new Error(
        `Profile has ${options.profile.glyphCount} glyphs; the GPU matcher supports up to ${MAX_GPU_GLYPHS}. ` +
          'Use the CPU backend for larger charsets.',
      )
    }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('WebGPU is present but no adapter is available on this device.')
    const device = await adapter.requestDevice()
    const context = options.canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) {
      device.destroy()
      throw new Error(
        'Could not acquire a webgpu canvas context. A canvas is permanently bound to its first context type — ' +
          'if this canvas previously ran the CPU backend, create a fresh <canvas> element to switch backends.',
      )
    }
    try {
      const format = navigator.gpu.getPreferredCanvasFormat()
      const engine = await AsciiEngine.create(device, options.profile)
      const stream = await engine.createStream(format)
      return new WebGpuAsciiRenderer({ options, device, context, format, engine, stream })
    } catch (err) {
      device.destroy()
      throw err
    }
  }

  grid(): { columns: number; rows: number } | null {
    return this.stream.grid()
  }

  private configureContext(): void {
    const color = this.opts.color ?? 'mono'
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: color === 'foreground' ? 'premultiplied' : 'opaque',
    })
  }

  setSource(source: RenderSource): void {
    this.source = source
    this.sourceLive = isLiveSource(source)
    this.sourceDirty = true
  }

  setOptions(options: AsciiRendererRuntimeOptions): void {
    const prevColor = this.opts.color ?? 'mono'
    this.opts = { ...this.opts, ...options }
    const color = this.opts.color ?? 'mono'
    if (
      options.columns !== undefined ||
      options.rows !== undefined ||
      options.color !== undefined ||
      options.alpha !== undefined ||
      options.foreground !== undefined ||
      options.background !== undefined ||
      options.flatThreshold !== undefined ||
      options.temporal !== undefined
    ) {
      this.matchDirty = true
      if (this.srcTexture) this.reconfigureStream()
    }
    if ((color === 'foreground') !== (prevColor === 'foreground')) {
      this.configureContext()
    }
    this.compositeDirty = true
  }

  setInteraction(interaction: InteractionOptions | null): void {
    this.interaction = interaction
    this.scheduleRender()
  }

  /** Coalesce pointer/interaction updates into one composite-only render. */
  private scheduleRender(): void {
    if (this.running || this.renderScheduled || this.destroyed || !this.source) return
    this.renderScheduled = true
    const run = (): void => {
      this.renderScheduled = false
      if (!this.destroyed) this.render()
    }
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run)
    else run()
  }

  resize(width: number, height: number): void {
    this.canvas.width = width
    this.canvas.height = height
    this.compositeDirty = true
  }

  private reconfigureStream(): void {
    // Adaptive resolution (spec §46): scale below the requested baseline only;
    // explicit user resolution remains the upper bound.
    const baseColumns = this.opts.columns
    const scaled =
      this.opts.adaptiveResolution && this.adaptiveScale < 1
        ? Math.max(40, Math.round((baseColumns ?? 120) * this.adaptiveScale))
        : baseColumns
    const { gridChanged } = this.stream.configure(this.srcTexture!, this.srcW, this.srcH, {
      columns: scaled,
      rows: this.opts.rows,
      color: this.opts.color,
      alpha: this.opts.alpha,
      foreground: this.opts.foreground,
      background: this.opts.background,
      flatThreshold: this.opts.flatThreshold,
      temporal: this.opts.temporal,
    })
    if (gridChanged) this.compositeDirty = true
  }

  invalidate(rect: { x: number; y: number; width: number; height: number }): void {
    if (!this.pendingRect) {
      this.pendingRect = { ...rect }
      return
    }
    const r = this.pendingRect
    const x1 = Math.max(r.x + r.width, rect.x + rect.width)
    const y1 = Math.max(r.y + r.height, rect.y + rect.height)
    r.x = Math.min(r.x, rect.x)
    r.y = Math.min(r.y, rect.y)
    r.width = x1 - r.x
    r.height = y1 - r.y
  }

  private prepareSource(): void {
    const [w, h] = sourceDims(this.source!)
    if (!(w > 0) || !(h > 0)) throw new Error('Source has zero dimensions; is it loaded yet?')
    if (!this.srcTexture || w !== this.srcW || h !== this.srcH) {
      this.srcTexture?.destroy()
      this.srcTexture = this.device.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.srcW = w
      this.srcH = h
    }
    this.reconfigureStream()
  }

  private uploadSource(): void {
    const source = this.source!
    if (isRawImage(source)) {
      this.device.queue.writeTexture(
        { texture: this.srcTexture! },
        source.data as Uint8Array<ArrayBuffer>,
        { bytesPerRow: this.srcW * 4 },
        [this.srcW, this.srcH],
      )
    } else {
      this.device.queue.copyExternalImageToTexture(
        { source: source as GPUCopyExternalImageSource },
        { texture: this.srcTexture!, premultipliedAlpha: false, colorSpace: 'srgb' },
        [this.srcW, this.srcH],
      )
    }
  }

  render(): void {
    if (this.destroyed) return
    if (!this.source) {
      const enc = this.device.createCommandEncoder()
      const clear = this.opts.clearColor ?? [0, 0, 0, 1]
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: this.context.getCurrentTexture().createView(),
            loadOp: 'clear',
            clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] },
            storeOp: 'store',
          },
        ],
      })
      pass.end()
      this.device.queue.submit([enc.finish()])
      return
    }

    if (this.sourceDirty || this.sourceLive) {
      this.prepareSource()
      this.uploadSource()
      this.matchDirty = true
      this.sourceDirty = false
      this.pendingRect = undefined
    }

    // Matching and presentation are separate submits: an invalid canvas
    // texture (e.g. no presentation path) must never drop the match work.
    if (this.matchDirty) {
      this.pendingRect = undefined
      const cenc = this.device.createCommandEncoder()
      this.stream.encodeMatch(cenc)
      this.device.queue.submit([cenc.finish()])
      this.matchDirty = false
    } else if (this.pendingRect && this.srcTexture) {
      // Dirty-region path (spec §22): full source re-upload, sub-rect rematch.
      const rect = this.pendingRect
      this.pendingRect = undefined
      this.prepareSource()
      this.uploadSource()
      const grid = this.stream.grid()!
      const c0 = Math.max(0, Math.floor((rect.x * grid.columns) / this.srcW))
      const r0 = Math.max(0, Math.floor((rect.y * grid.rows) / this.srcH))
      const c1 = Math.min(grid.columns, Math.ceil(((rect.x + rect.width) * grid.columns) / this.srcW))
      const r1 = Math.min(grid.rows, Math.ceil(((rect.y + rect.height) * grid.rows) / this.srcH))
      if (c1 > c0 && r1 > r0) {
        const cenc = this.device.createCommandEncoder()
        this.stream.encodeMatchRect(cenc, c0, r0, c1 - c0, r1 - r0)
        this.device.queue.submit([cenc.finish()])
        this.stream.resetMatchRect()
      }
    }
    if (this.compositeDirty) {
      this.stream.syncView({
        width: this.canvas.width,
        height: this.canvas.height,
        fit: this.opts.fit,
        clearColor: this.opts.clearColor,
      })
      this.compositeDirty = false
    }
    this.stream.syncFx(
      {
        interaction: this.interaction,
        pointerX: this.pointerX * this.canvas.width,
        pointerY: this.pointerY * this.canvas.height,
        velX: this.velX,
        velY: this.velY,
        time: (performance.now() - this.t0) / 1000,
      },
      this.canvas.width,
      this.canvas.height,
    )
    const enc = this.device.createCommandEncoder()
    this.stream.encodeComposite(enc, this.context.getCurrentTexture().createView())
    this.device.queue.submit([enc.finish()])
  }

  start(): void {
    if (this.running || this.destroyed) return
    this.running = true
    const video =
      typeof HTMLVideoElement !== 'undefined' && this.source instanceof HTMLVideoElement ? this.source : null
    if (video && 'requestVideoFrameCallback' in video) {
      const cb = (): void => {
        if (!this.running) return
        this.sourceDirty = true
        this.render()
        this.rvfcId = video.requestVideoFrameCallback(cb)
      }
      this.rvfcId = video.requestVideoFrameCallback(cb)
    } else {
      const tick = (): void => {
        if (!this.running) return
        if (this.opts.adaptiveResolution) this.paceAdaptive()
        this.render()
        this.rafId = requestAnimationFrame(tick)
      }
      this.rafId = requestAnimationFrame(tick)
    }
  }

  /** Frame pacing with hysteresis (spec §46): step down fast, recover slowly. */
  private paceAdaptive(): void {
    const now = performance.now()
    if (this.lastTickAt > 0) {
      const interval = now - this.lastTickAt
      this.adaptiveEma = this.adaptiveEma * 0.9 + interval * 0.1
      const target = 1000 / 60
      if (this.adaptiveCooldown > 0) {
        this.adaptiveCooldown--
      } else if (this.adaptiveEma > target * 1.6 && this.adaptiveScale > 0.35) {
        this.adaptiveScale *= 0.85
        this.adaptiveCooldown = 30
        this.adaptiveHealthy = 0
        this.matchDirty = true
        if (this.srcTexture) this.reconfigureStream()
      } else if (this.adaptiveEma < target * 1.08 && this.adaptiveScale < 1) {
        this.adaptiveHealthy++
        if (this.adaptiveHealthy > 120) {
          this.adaptiveScale = Math.min(1, this.adaptiveScale / 0.85)
          this.adaptiveCooldown = 30
          this.adaptiveHealthy = 0
          this.matchDirty = true
          if (this.srcTexture) this.reconfigureStream()
        }
      }
    }
    this.lastTickAt = now
  }

  stop(): void {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    const video =
      typeof HTMLVideoElement !== 'undefined' && this.source instanceof HTMLVideoElement ? this.source : null
    if (this.rvfcId && video && 'cancelVideoFrameCallback' in video) {
      video.cancelVideoFrameCallback(this.rvfcId)
    }
    this.rafId = 0
    this.rvfcId = 0
  }

  /** Explicit GPU→CPU readback (spec §33); never part of the render loop. */
  async captureFrame(): Promise<AsciiFrame> {
    if (!this.source) throw new Error('captureFrame() requires a source — call setSource() first.')
    if (this.sourceDirty || this.matchDirty || this.pendingRect) this.render()
    return this.stream.captureFrame()
  }

  async toBlob(type?: string, quality?: number): Promise<Blob> {
    if (this.canvas instanceof OffscreenCanvas) {
      return this.canvas.convertToBlob({ type, quality })
    }
    const canvas = this.canvas
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality)
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.stop()
    this.destroyed = true
    this.srcTexture?.destroy()
    this.stream.destroy()
    this.engine.destroy()
    this.context.unconfigure()
    this.device.destroy()
  }
}
