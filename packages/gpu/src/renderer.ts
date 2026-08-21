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

/** Recovery cascade bound: consecutive attempts allowed inside one incident window. */
const MAX_RECOVERY_ATTEMPTS = 3
const RECOVERY_INCIDENT_MS = 10_000

export class WebGpuAsciiRenderer implements AsciiRenderer {
  readonly backend = 'webgpu' as const
  readonly profile: AsciiProfile
  readonly pointer: AsciiPointer

  // Swapped wholesale when a lost device is rebuilt, so none of these are readonly.
  private device: GPUDevice
  private readonly context: GPUCanvasContext
  private readonly format: GPUTextureFormat
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas
  private engine: AsciiEngine
  private stream: AsciiStream

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
  private loopGeneration = 0
  private rafId = 0
  private rvfcId = 0
  private destroyed = false
  /** True from the moment the device is lost until a replacement is running. */
  private deviceLost = false
  /** In-flight rebuild, so device work can wait it out instead of failing. */
  private recovery?: Promise<void>
  /** Consecutive recovery attempts inside one incident window (see recover). */
  private recoverAttempts = 0
  private lastRecoverAt = 0
  private readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void
  private readonly onError?: (error: GPUError) => void

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
    const { canvas: _c, profile: _p, backend: _b, interaction, onDeviceLost, onError, ...rest } = options
    this.opts = rest
    this.interaction = interaction ?? null
    this.onDeviceLost = onDeviceLost
    this.onError = onError
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
    this.watchDevice(init.device)
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
    // WebGPU reports most failures through error scopes, not exceptions.
    // createBuffer, createTexture and createBindGroup all validate silently, so a
    // browser whose limits or WGSL support differ from the one this was developed
    // on can accept every setup call and then render nothing — indistinguishable
    // from a working renderer unless we ask. Asking is what makes 'auto' able to
    // fall back instead of sitting on a GPU path that produces no pixels.
    device.pushErrorScope('validation')
    device.pushErrorScope('internal')
    try {
      const format = navigator.gpu.getPreferredCanvasFormat()
      const engine = await AsciiEngine.create(device, options.profile)
      const stream = await engine.createStream(format)
      const internal = await device.popErrorScope()
      const validation = await device.popErrorScope()
      const failure = internal ?? validation
      if (failure) {
        throw new Error(
          `WebGPU accepted the renderer setup and then reported an error, so it would render nothing: ${failure.message}`,
        )
      }
      // A device can be handed out already lost (stale adapter) or die during
      // setup. Every call above then no-ops and BOTH error scopes resolve
      // null, so without this check a dead renderer passes setup, binds the
      // canvas, and forecloses the CPU fallback. One macrotask lets the lost
      // promise's reaction run if it has already resolved.
      let lostDuringSetup: GPUDeviceLostInfo | undefined
      void device.lost.then((lost) => {
        lostDuringSetup = lost
      })
      await new Promise((r) => setTimeout(r, 0))
      if (lostDuringSetup) {
        throw new Error(`WebGPU device was lost during renderer setup (${lostDuringSetup.reason}).`)
      }
      // Touch the canvas last. Everything above can fail on a browser with a
      // partial WebGPU implementation, and 'auto' has to be able to fall back to
      // the CPU backend afterwards — which it cannot once this call has bound the
      // canvas to 'webgpu' for the life of the element.
      const context = options.canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) {
        throw new Error(
          'Could not acquire a webgpu canvas context. A canvas is permanently bound to its first context type — ' +
            'if this canvas previously ran the CPU backend, create a fresh <canvas> element to switch backends.',
        )
      }
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

  /**
   * A GPUDevice can die at any point — the browser drops it under memory
   * pressure, the GPU process crashes, the driver resets. Nothing throws when
   * it happens: submits against a lost device are validly ignored, so the
   * render loop keeps ticking, `grid()` keeps answering, and the canvas holds
   * whatever was last presented. The only way to notice is to watch for it.
   */
  private watchDevice(device: GPUDevice): void {
    // Errors outside an explicit scope surface here and nowhere else. Ignoring
    // them is how a renderer ends up submitting work that is silently dropped.
    device.addEventListener('uncapturederror', (event) => {
      if (this.destroyed || device !== this.device) return
      const { error } = event as GPUUncapturedErrorEvent
      if (this.onError) this.onError(error)
      else console.error('[ascii-fx] WebGPU error:', error.message)
    })
    void device.lost.then((info) => {
      // destroy() resolves this too, and an already-replaced device resolves it
      // late; neither is a failure.
      if (this.destroyed || device !== this.device) return
      this.deviceLost = true
      // A loss long after the last recovery is a fresh incident, not evidence
      // that recovery failed — its attempt budget starts from zero.
      if (Date.now() - this.lastRecoverAt > RECOVERY_INCIDENT_MS) this.recoverAttempts = 0
      const wasRunning = this.running
      this.stop()
      const attempt = this.recover(info, wasRunning).finally(() => {
        if (this.recovery === attempt) this.recovery = undefined
      })
      this.recovery = attempt
      void attempt
    })
  }

  /**
   * Rebuild on a fresh device, in place. The canvas keeps its 'webgpu' context
   * — a context can be reconfigured onto a new device, it just cannot change
   * context type — so the caller's canvas element stays valid.
   */
  private async recover(info: GPUDeviceLostInfo, wasRunning: boolean): Promise<void> {
    try {
      // A replacement device can arrive already lost — a stale adapter
      // resolves rather than rejects, every op on the dead device no-ops, so
      // recovery "succeeds", watches the new device, sees it lost, and
      // recovers again, forever and silently. Bound the cascade: the budget
      // resets only when a device survives past the incident window.
      this.lastRecoverAt = Date.now()
      if (++this.recoverAttempts > MAX_RECOVERY_ATTEMPTS) {
        throw new Error(`device lost ${MAX_RECOVERY_ATTEMPTS} times in quick succession`)
      }
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) throw new Error('navigator.gpu went away')
      const adapter = await navigator.gpu.requestAdapter()
      if (this.destroyed) return
      if (!adapter) throw new Error('no adapter available after device loss')
      const device = await adapter.requestDevice()
      if (this.destroyed) {
        device.destroy()
        return
      }
      const engine = await AsciiEngine.create(device, this.profile)
      const stream = await engine.createStream(this.format)
      // destroy() may have raced the awaits above; a destroyed renderer must
      // not re-bind its canvas or keep a live replacement device for GC.
      if (this.destroyed) {
        device.destroy()
        return
      }
      // Everything below is device-owned and died with it.
      this.srcTexture = undefined
      this.srcW = 0
      this.srcH = 0
      this.device = device
      this.engine = engine
      this.stream = stream
      this.deviceLost = false
      this.configureContext()
      this.watchDevice(device)
      // The new stream has no history, so the next frame must be a full match.
      this.sourceDirty = true
      this.matchDirty = true
      this.compositeDirty = true
      if (wasRunning) this.start()
      else this.render()
    } catch {
      // Out of our hands: recovery needs a working GPU, and if there is not one
      // the caller has to decide (swap in a fresh canvas on the CPU backend, or
      // show a still). Leave deviceLost set so the loop stays parked — but
      // never silently: a parked canvas with zero trace is undebuggable
      // (mirrors onError's console default).
      if (this.onDeviceLost) this.onDeviceLost(info)
      else console.error('[ascii-fx] WebGPU device lost and not recovered:', info.reason, info.message)
    }
  }

  setSource(source: RenderSource): void {
    const restart = this.running
    if (restart) this.stop()
    this.source = source
    this.sourceLive = isLiveSource(source)
    this.sourceDirty = true
    // A new source is a discontinuity: hysteresis would otherwise treat the old
    // source's glyphs as incumbents and ghost them into the new one.
    this.stream.resetTemporalState()
    if (restart) this.start()
  }

  setOptions(options: AsciiRendererRuntimeOptions): void {
    if (options.matcher === 'chromatic' && !this.profile.chromatic) {
      throw new Error(
        `Profile ${this.profile.id} carries no chromatic glyph data, so matcher: 'chromatic' has nothing ` +
          'to match against. Compile it with @ascii-fx/compiler buildChromaticProfile.',
      )
    }
    const previous = this.opts
    const prevColor = previous.color ?? 'mono'
    this.opts = { ...previous, ...options }
    const color = this.opts.color ?? 'mono'
    const matchChanged =
      previous.columns !== this.opts.columns ||
      previous.rows !== this.opts.rows ||
      previous.color !== this.opts.color ||
      previous.matcher !== this.opts.matcher ||
      previous.hysteresis !== this.opts.hysteresis ||
      previous.alpha !== this.opts.alpha ||
      previous.foreground !== this.opts.foreground ||
      previous.background !== this.opts.background ||
      previous.flatThreshold !== this.opts.flatThreshold ||
      previous.temporal !== this.opts.temporal
    const adaptiveChanged = previous.adaptiveResolution !== this.opts.adaptiveResolution
    if (adaptiveChanged && !this.opts.adaptiveResolution) {
      this.adaptiveScale = 1
      this.adaptiveEma = 1000 / 60
      this.adaptiveHealthy = 0
      this.adaptiveCooldown = 0
      this.lastTickAt = 0
    }
    if (matchChanged || adaptiveChanged) {
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
    // Setting canvas dims discards the presented frame; without a running
    // loop nothing else would repaint and the canvas stays blank (the CPU
    // backend re-presents synchronously here). scheduleRender no-ops while
    // the loop runs.
    this.scheduleRender()
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
      matcher: this.opts.matcher,
      alpha: this.opts.alpha,
      foreground: this.opts.foreground,
      background: this.opts.background,
      flatThreshold: this.opts.flatThreshold,
      hysteresis: this.opts.hysteresis,
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
    if (this.destroyed || this.deviceLost) return
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
    if (this.running || this.destroyed || this.deviceLost) return
    this.running = true
    const generation = ++this.loopGeneration
    const video =
      typeof HTMLVideoElement !== 'undefined' && this.source instanceof HTMLVideoElement ? this.source : null
    if (video && 'requestVideoFrameCallback' in video) {
      const cb = (): void => {
        if (!this.running || generation !== this.loopGeneration) return
        this.sourceDirty = true
        this.render()
        this.rvfcId = video.requestVideoFrameCallback(cb)
      }
      this.rvfcId = video.requestVideoFrameCallback(cb)
    } else {
      const tick = (): void => {
        if (!this.running || generation !== this.loopGeneration) return
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
    this.loopGeneration++
    // The pacing clock measures the gap between consecutive rendered frames.
    // A stopped loop is not a slow frame, so drop the timestamp: without this
    // the first tick after a resume feeds the whole pause into the EMA, which
    // reads as a stall and collapses adaptive resolution (reconfiguring the
    // stream on the way down) before slowly climbing back.
    this.lastTickAt = 0
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
    // A rebuild swaps the device, engine and stream underneath us; reading back
    // across that would map a buffer on the dead device and abort.
    await this.recovery
    if (!this.source) throw new Error('captureFrame() requires a source — call setSource() first.')
    if (this.deviceLost) throw new Error('captureFrame() failed: the GPU device was lost and could not be replaced.')
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
