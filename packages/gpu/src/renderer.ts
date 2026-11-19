import type { AsciiFrame, AsciiProfile } from '@ascii-fx/core'
import { deriveGrid } from '@ascii-fx/core'
import { AsciiEngine, AsciiStream } from './engine.js'
import { MAX_GPU_GLYPHS } from './limits.js'
import type {
  AsciiPointer,
  AsciiRenderer,
  AsciiRendererOptions,
  AsciiRendererRuntimeOptions,
  InteractionOptions,
  RenderSource,
} from './types.js'
import {
  assertInteraction,
  assertJitter,
  isLiveSource,
  isRawImage,
  outputCanBeTransparent,
  sourceDims,
} from './types.js'

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
  /**
   * How long the GPU takes to finish a frame's work, smoothed, in ms; negative until
   * measured. Frame intervals alone cannot tell a slow renderer from a slow display — a
   * screen throttled to 30 Hz delivers 33 ms frames however little work each one is — so
   * pacing asks both.
   */
  private adaptiveGpuMs = -1
  private gpuProbePending = false
  private lastTickAt = 0

  private interaction: InteractionOptions | null = null
  private pointerX = 0.5
  private pointerY = 0.5
  private velX = 0
  private velY = 0
  private readonly t0 = performance.now()
  private renderScheduled = false
  /**
   * Which loop is running, if one is. A requestAnimationFrame loop repaints every frame by
   * itself, so one-off repaints stand down for it. A video-frame loop fires only when the
   * video presents a frame — not while it is paused, ended or buffering — so a pointer move
   * or a resize still has to ask for its own repaint.
   */
  private rafLoop = false
  private frameLoop = false
  /** What the caller last asked for, which a device loss must not overwrite. */
  private wantRunning = false
  /** A throw from the loop has been logged and not yet followed by a good frame. */
  private loopFaulted = false
  /** Whether srcTexture holds a frame of the current source yet. */
  private uploaded = false
  /** Bumped per wait for a video's first frame, so only the latest wait's wake-up counts. */
  private frameWait = 0
  private frameWaitTries = 0

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
    const {
      canvas: _c,
      profile: _p,
      backend: _b,
      interaction,
      onDeviceLost,
      onError,
      ...rest
    } = options
    assertJitter(rest)
    this.opts = rest
    assertInteraction(interaction)
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
    // Truthiness, not `in`: privacy modes and test shims leave the property
    // present but undefined, and `'gpu' in navigator` would pass them through
    // to a raw TypeError instead of this message.
    if (typeof navigator === 'undefined' || !navigator.gpu) {
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

  /**
   * The rule is one line: the canvas is transparent when the frame is. Opaque stays the
   * default for the common case, where it lets the compositor skip blending the canvas
   * against the page. The predicate is shared with the compositors so the alphaMode and
   * the frame's ground can never disagree — see `outputCanBeTransparent`.
   */
  private canBeTransparent(): boolean {
    return outputCanBeTransparent(this.opts)
  }

  private configureContext(): void {
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: this.canBeTransparent() ? 'premultiplied' : 'opaque',
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
      // The loop stops for the rebuild, but that is not the caller stopping it: start() and
      // stop() during the rebuild still decide whether it comes back running.
      const want = this.wantRunning
      this.stop()
      this.wantRunning = want
      const attempt = this.recover(info).finally(() => {
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
  private async recover(info: GPUDeviceLostInfo): Promise<void> {
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
      if (typeof navigator === 'undefined' || !navigator.gpu)
        throw new Error('navigator.gpu went away')
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
    } catch {
      // Out of our hands: recovery needs a working GPU, and if there is not one
      // the caller has to decide (swap in a fresh canvas on the CPU backend, or
      // show a still). Leave deviceLost set so the loop stays parked — but
      // never silently: a parked canvas with zero trace is undebuggable
      // (mirrors onError's console default).
      if (this.onDeviceLost) this.onDeviceLost(info)
      else
        console.error('[ascii-fx] WebGPU device lost and not recovered:', info.reason, info.message)
      return
    }
    // Outside the try: the device is back, so a first frame that fails is a render problem
    // and must not be reported as a device that could not be recovered.
    if (this.wantRunning) this.start()
    else this.renderGuarded()
  }

  /**
   * render() for callers with nobody to throw to: a loop tick, a scheduled repaint. A source
   * that cannot be read right now — a canvas at zero size, a video frame the browser has
   * dropped — throws from render(); from a loop that used to end the loop while leaving it
   * marked running, so start() could not bring it back. The failure is logged once, and the
   * next frame that renders clears it.
   */
  private renderGuarded(): void {
    try {
      this.render()
      this.loopFaulted = false
    } catch (err) {
      if (this.loopFaulted) return
      this.loopFaulted = true
      console.error('[ascii-fx] render failed; it will be retried on the next frame:', err)
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
    assertJitter({ ...previous, ...options })
    const transparentBefore = this.canBeTransparent()
    // `interaction` is in the options type because it is a creation option. It has its own
    // setter, and used to be dropped here without a word; it is forwarded now.
    const { interaction, ...rest } = options
    if ('interaction' in options) this.setInteraction(interaction ?? null)
    this.opts = { ...previous, ...rest }
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
      previous.temporal !== this.opts.temporal ||
      previous.jitter !== this.opts.jitter ||
      previous.jitterSeed !== this.opts.jitterSeed
    const adaptiveChanged = previous.adaptiveResolution !== this.opts.adaptiveResolution
    if (adaptiveChanged && !this.opts.adaptiveResolution) {
      this.adaptiveScale = 1
      this.adaptiveEma = 1000 / 60
      this.adaptiveHealthy = 0
      this.adaptiveCooldown = 0
      this.adaptiveGpuMs = -1
      this.lastTickAt = 0
    }
    if (matchChanged || adaptiveChanged) {
      this.matchDirty = true
      if (this.srcTexture) this.reconfigureStream()
    }
    // Reconfigure whenever the transparency of the output changes, not just on the
    // foreground boundary — `alpha` and `clearColor` move it too.
    if (transparentBefore !== this.canBeTransparent()) {
      this.configureContext()
    }
    this.compositeDirty = true
    // Like every other setter: a renderer with no loop has nothing else to repaint it.
    this.scheduleRender()
  }

  setInteraction(interaction: InteractionOptions | null): void {
    assertInteraction(interaction)
    // The field is allocated by configure(), which reads this — and which a still never
    // reaches again by itself, so a motion source asked for after the first frame used to
    // stay pointer-driven.
    const sourceChanged = interaction?.source !== this.interaction?.source
    this.interaction = interaction
    if (sourceChanged) {
      this.matchDirty = true
      if (this.srcTexture) this.reconfigureStream()
    }
    this.scheduleRender()
  }

  /** Coalesce pointer/interaction updates into one composite-only render. */
  private scheduleRender(): void {
    if (this.rafLoop || this.renderScheduled || this.destroyed || !this.source) return
    this.renderScheduled = true
    const run = (): void => {
      this.renderScheduled = false
      if (!this.destroyed) this.renderGuarded()
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
    // a requestAnimationFrame loop runs.
    this.scheduleRender()
  }

  private reconfigureStream(): void {
    // Adaptive resolution (spec §46): scale below the requested baseline only;
    // explicit user resolution remains the upper bound.
    let columns = this.opts.columns
    let rows = this.opts.rows
    if (this.opts.adaptiveResolution && this.adaptiveScale < 1) {
      // Scale the grid the options actually resolve to, both ways. Scaling `columns ?? 120`
      // alone raised a grid that was under the floor to begin with (16 columns became 40),
      // and next to an explicit `rows` it changed the picture's aspect.
      const base = deriveGrid(this.srcW, this.srcH, this.profile, columns, rows)
      columns = Math.max(Math.min(40, base.columns), Math.round(base.columns * this.adaptiveScale))
      rows =
        rows === undefined
          ? undefined
          : Math.max(1, Math.round((base.rows * columns) / base.columns))
    }
    const { gridChanged } = this.stream.configure(this.srcTexture!, this.srcW, this.srcH, {
      columns,
      rows,
      color: this.opts.color,
      matcher: this.opts.matcher,
      alpha: this.opts.alpha,
      foreground: this.opts.foreground,
      background: this.opts.background,
      flatThreshold: this.opts.flatThreshold,
      hysteresis: this.opts.hysteresis,
      temporal: this.opts.temporal,
      jitter: this.opts.jitter,
      jitterSeed: this.opts.jitterSeed,
      motion: this.interaction?.source === 'motion' ? (this.interaction.motion ?? {}) : undefined,
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
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.srcW = w
      this.srcH = h
      this.uploaded = false
    }
    this.reconfigureStream()
  }

  /**
   * Copy the source into srcTexture. False when the source is a video with no frame to give
   * yet, which is not a failure: a video reports itself loaded a moment before the browser
   * has a decoded frame it can hand over, and the copy throws in that window. The texture
   * keeps what it had and the copy is retried when the frame arrives.
   */
  private uploadSource(): boolean {
    const source = this.source!
    if (isRawImage(source)) {
      this.device.queue.writeTexture(
        { texture: this.srcTexture! },
        source.data as Uint8Array<ArrayBuffer>,
        { bytesPerRow: this.srcW * 4 },
        [this.srcW, this.srcH],
      )
    } else {
      try {
        this.device.queue.copyExternalImageToTexture(
          { source: source as GPUCopyExternalImageSource },
          { texture: this.srcTexture!, premultipliedAlpha: false, colorSpace: 'srgb' },
          [this.srcW, this.srcH],
        )
      } catch (err) {
        const video =
          typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement
            ? source
            : null
        // A cross-origin video without CORS is a SecurityError, and that one is real.
        const name = err instanceof Error ? err.name : ''
        if (!video || (name !== 'OperationError' && name !== 'InvalidStateError')) throw err
        this.awaitVideoFrame(video)
        return false
      }
    }
    this.uploaded = true
    this.frameWaitTries = 0
    return true
  }

  /** Render again once `video` has a frame, by whichever of the two signals comes first. */
  private awaitVideoFrame(video: HTMLVideoElement): void {
    // A video that never produces a frame is not polled for ever.
    if (this.frameWaitTries++ > 40) return
    const wait = ++this.frameWait
    const wake = (): void => {
      if (wait !== this.frameWait || this.destroyed || this.source !== video) return
      this.frameWait++
      this.sourceDirty = true
      this.scheduleRender()
    }
    // The frame callback is the precise signal, but it only comes for a video the browser
    // is compositing; the timer covers one that is not on the page.
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(wake)
    setTimeout(wake, 120)
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
            // Premultiplied: the canvas is, whenever this alpha is below 1.
            clearValue: {
              r: clear[0] * clear[3],
              g: clear[1] * clear[3],
              b: clear[2] * clear[3],
              a: clear[3],
            },
            storeOp: 'store',
          },
        ],
      })
      pass.end()
      this.device.queue.submit([enc.finish()])
      return
    }

    // Under a video-frame loop the callback says when there is a new frame (it sets
    // sourceDirty), so the repaints in between — a pointer move over a paused video — are
    // composites of the frame already matched rather than a re-upload of the same pixels.
    if (this.sourceDirty || (this.sourceLive && !this.frameLoop)) {
      this.prepareSource()
      if (this.uploadSource()) {
        this.matchDirty = true
        this.sourceDirty = false
        this.pendingRect = undefined
      } else {
        // No frame from the video yet. Keep showing what there is; with nothing matched
        // so far there is nothing to show, and matching an empty texture would paint a
        // black frame over the fallback underneath.
        this.sourceDirty = true
        if (!this.uploaded) return
      }
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
      if (!this.uploadSource()) return
      const grid = this.stream.grid()!
      const c0 = Math.max(0, Math.floor((rect.x * grid.columns) / this.srcW))
      const r0 = Math.max(0, Math.floor((rect.y * grid.rows) / this.srcH))
      const c1 = Math.min(
        grid.columns,
        Math.ceil(((rect.x + rect.width) * grid.columns) / this.srcW),
      )
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
        palette: this.opts.palette,
        post: this.opts.post,
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
    if (this.destroyed) return
    // Recorded before the device check: a start() during a rebuild is honoured when it ends.
    this.wantRunning = true
    if (this.running || this.deviceLost) return
    this.running = true
    const generation = ++this.loopGeneration
    const video =
      typeof HTMLVideoElement !== 'undefined' && this.source instanceof HTMLVideoElement
        ? this.source
        : null
    if (video && 'requestVideoFrameCallback' in video) {
      this.frameLoop = true
      const cb = (): void => {
        if (!this.running || generation !== this.loopGeneration) return
        if (this.opts.adaptiveResolution) this.paceAdaptive()
        this.sourceDirty = true
        this.renderGuarded()
        if (this.opts.adaptiveResolution) this.probeGpu()
        this.rvfcId = video.requestVideoFrameCallback(cb)
      }
      this.rvfcId = video.requestVideoFrameCallback(cb)
    } else {
      this.rafLoop = true
      const tick = (): void => {
        if (!this.running || generation !== this.loopGeneration) return
        if (this.opts.adaptiveResolution) this.paceAdaptive()
        this.renderGuarded()
        if (this.opts.adaptiveResolution) this.probeGpu()
        this.rafId = requestAnimationFrame(tick)
      }
      this.rafId = requestAnimationFrame(tick)
    }
  }

  /**
   * Frame pacing with hysteresis (spec §46): step down fast, recover slowly.
   *
   * Pressure is the renderer being the thing that is slow. In an animation loop that is
   * frames arriving late *and* the GPU taking a real share of a frame to finish them: late
   * frames with an idle GPU are the display's doing — a 30 Hz panel, a browser in low-power
   * mode — and stepping the grid down for those gains nothing and, since the frames stay
   * late, never recovers. In a video loop the frames arrive at the video's rate whatever
   * happens, so the question is only whether the GPU finishes one before the next is due.
   */
  private paceAdaptive(): void {
    const now = performance.now()
    if (this.lastTickAt > 0) {
      const interval = now - this.lastTickAt
      this.adaptiveEma = this.adaptiveEma * 0.9 + interval * 0.1
      const target = 1000 / 60
      const gpu = this.adaptiveGpuMs
      // The GPU figure is a round trip to the GPU process and reads several ms with nothing
      // to do, so the thresholds sit well clear of that floor: busy is a whole 60 Hz frame.
      const pressure = this.frameLoop
        ? gpu > this.adaptiveEma * 0.8
        : this.adaptiveEma > target * 1.6 && gpu > target
      const healthy = this.frameLoop
        ? gpu >= 0 && gpu < this.adaptiveEma * 0.4
        : this.adaptiveEma < target * 1.08 || (gpu >= 0 && gpu < target * 0.6)
      if (this.adaptiveCooldown > 0) {
        this.adaptiveCooldown--
      } else if (pressure && this.adaptiveScale > 0.35) {
        this.adaptiveScale *= 0.85
        this.adaptiveCooldown = 30
        this.adaptiveHealthy = 0
        this.matchDirty = true
        if (this.srcTexture) this.reconfigureStream()
      } else if (healthy && this.adaptiveScale < 1) {
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

  /** Time the work just submitted, one measurement at a time. */
  private probeGpu(): void {
    if (this.gpuProbePending || this.deviceLost) return
    this.gpuProbePending = true
    const device = this.device
    const started = performance.now()
    device.queue.onSubmittedWorkDone().then(
      () => {
        this.gpuProbePending = false
        if (device !== this.device || this.destroyed) return
        const ms = performance.now() - started
        this.adaptiveGpuMs = this.adaptiveGpuMs < 0 ? ms : this.adaptiveGpuMs * 0.8 + ms * 0.2
      },
      () => {
        this.gpuProbePending = false
      },
    )
  }

  stop(): void {
    this.running = false
    this.wantRunning = false
    this.rafLoop = false
    this.frameLoop = false
    this.loopGeneration++
    // The pacing clock measures the gap between consecutive rendered frames.
    // A stopped loop is not a slow frame, so drop the timestamp: without this
    // the first tick after a resume feeds the whole pause into the EMA, which
    // reads as a stall and collapses adaptive resolution (reconfiguring the
    // stream on the way down) before slowly climbing back.
    this.lastTickAt = 0
    if (this.rafId) cancelAnimationFrame(this.rafId)
    const video =
      typeof HTMLVideoElement !== 'undefined' && this.source instanceof HTMLVideoElement
        ? this.source
        : null
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
    if (this.deviceLost)
      throw new Error('captureFrame() failed: the GPU device was lost and could not be replaced.')
    // compositeDirty too: the palette is part of the captured frame, and a palette set since the
    // last render has not reached the stream yet.
    if (this.sourceDirty || this.matchDirty || this.pendingRect || this.compositeDirty)
      this.render()
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
