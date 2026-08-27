import type { AsciiProfile, ColorMode, MatchOptions, RawImage } from '@ascii-fx/core'
import { AsciiFrame, compositeFrame, deriveGrid, matchFrame } from '@ascii-fx/core'
import type { BandOptions } from './matchProtocol.js'
import { MatchPool } from './matchPool.js'
import type { GlFxParams, GlViewParams } from './glCompositor.js'
import { GL_ATLAS_MIPS, GL_FX_KIND, GlCompositor } from './glCompositor.js'
import type {
  AsciiPipeline,
  AsciiPointer,
  AsciiRenderer,
  AsciiRendererOptions,
  AsciiRendererRuntimeOptions,
  InteractionOptions,
  RenderSource,
} from './types.js'
import { isLiveSource, isRawImage, outputCanBeTransparent, sourceDims } from './types.js'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const TIME_BASED = new Set(['wave', 'displace'])

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(edge1 - edge0, 1e-6)))
  return t * t * (3 - 2 * t)
}

/**
 * Universal fallback (spec §11/§12): exact CPU structural matching plus a
 * Canvas2D composite. Same public surface and same exact matching output as
 * WebGPU. All interactions run at the composite stage using the shader's own
 * formulas: masked layers for reveal/color/original-mix, row strips for wave,
 * and a cell-granular warp engine for push/displace/magnify and the
 * glyph-local effects — the warp is evaluated at each affected cell's center
 * and that cell is redrawn from its warped source, so geometry matches the
 * GPU up to cell quantization.
 */
export class CpuAsciiRenderer implements AsciiRenderer {
  readonly backend = 'cpu' as const
  readonly profile: AsciiProfile
  readonly pointer: AsciiPointer

  private readonly canvas: HTMLCanvasElement | OffscreenCanvas
  /** Absent when the WebGL2 compositor took the canvas instead. */
  private readonly ctx?: Ctx2D
  /**
   * Spec §12's preferred fallback: the glyph field goes to a fullscreen WebGL2
   * draw rather than a full-resolution RGBA buffer built on the CPU. Absent
   * where WebGL2 is unavailable or the caller asked for Canvas2D.
   */
  private readonly glc?: GlCompositor
  private opts: AsciiRendererRuntimeOptions
  private source?: RenderSource
  private sourceLive = false
  private lastFrame?: AsciiFrame
  /**
   * Whether lastFrame belongs to the current source and options. Hysteresis is
   * biased toward the incumbent and does not self-correct, so feeding it a
   * frame from anything else ghosts that into the result (§C5).
   */
  private hysteresisPrimed = false
  private matchDirty = true
  private running = false
  private loopGeneration = 0
  private rafId = 0
  private rvfcId = 0
  private fxRafId = 0
  private renderScheduled = false
  private destroyed = false
  private scratch?: HTMLCanvasElement | OffscreenCanvas
  private compositeCanvas?: HTMLCanvasElement | OffscreenCanvas
  private compositeBuf?: RawImage
  private lastComposited?: AsciiFrame
  private fxLayer?: HTMLCanvasElement | OffscreenCanvas
  private srcFxCanvas?: HTMLCanvasElement | OffscreenCanvas
  private srcFxFor?: RenderSource

  private interaction: InteractionOptions | null = null
  private pointerX = 0.5
  private pointerY = 0.5
  private readonly t0 = performance.now()
  private pyr: Array<HTMLCanvasElement | OffscreenCanvas> = []
  private pyrValid = 0
  /**
   * Matcher workers (spec §11 tier 2). Absent where Worker is, and dropped on
   * the first failure — matching then runs on the main thread, slower and
   * never different.
   */
  private pool?: MatchPool
  /** Requested pool size; `false` pins matching to the main thread. */
  private readonly workersOption: number | false | undefined
  /** Set once a pool has been attempted, so a failed one is not respawned every frame. */
  private poolTried = false
  /** The grid and colour mode the in-flight band job was submitted with. */
  private pending?: { columns: number; rows: number; colorMode: ColorMode }
  private adoptScheduled = false

  constructor(options: AsciiRendererOptions) {
    this.canvas = options.canvas
    this.profile = options.profile
    const { canvas: _c, profile: _p, backend: _b, interaction, ...rest } = options
    this.opts = rest
    this.interaction = interaction ?? null
    if (options.compositor !== 'canvas2d') {
      this.glc = GlCompositor.tryCreate(this.canvas, this.profile)
    }
    if (!this.glc) {
      const ctx = this.canvas.getContext('2d') as Ctx2D | null
      if (!ctx) {
        throw new Error(
          'CPU backend could not acquire a 2d context on the target canvas. A canvas is permanently bound to its ' +
            'first context type — if this canvas previously ran the WebGPU backend, create a fresh <canvas> element ' +
            'to switch backends.',
        )
      }
      this.ctx = ctx
      ctx.imageSmoothingQuality = 'high'
    }
    this.pointer = {
      set: (x: number, y: number) => {
        this.pointerX = x
        this.pointerY = y
        this.scheduleFxPresent()
      },
      setVelocity: () => {},
    }
    this.workersOption = options.workers
  }

  /**
   * Spawn the pool on first structural use rather than at construction: a
   * chromatic-only renderer never matches on workers, and a profile clone per
   * worker is not free.
   */
  private ensurePool(): MatchPool | undefined {
    if (this.poolTried) return this.pool
    this.poolTried = true
    if (this.workersOption === false) return undefined
    this.pool = MatchPool.create(
      this.profile,
      typeof this.workersOption === 'number' ? this.workersOption : undefined,
      (err) => {
        this.pool = undefined
        this.pending = undefined
        // Matching is still exact on the main thread, but it is now the main
        // thread's ~25 ms/frame. Say so rather than let the page just be slow.
        console.error(
          '[ascii-fx] matcher workers unavailable, matching on the main thread:',
          err.message,
        )
      },
    )
    return this.pool
  }

  /**
   * Read rather than stored: the pool is spun up on first structural use and
   * dropped if it fails, so this is a live answer, not what was intended at
   * construction.
   */
  get pipeline(): AsciiPipeline {
    return {
      matcher: this.pool?.ready ? 'workers' : 'main-thread',
      compositor: this.glc && !this.glc.unavailable ? 'webgl2' : 'canvas2d',
    }
  }

  grid(): { columns: number; rows: number } | null {
    if (!this.source) return null
    const [w, h] = sourceDims(this.source)
    return deriveGrid(w, h, this.profile, this.opts.columns, this.opts.rows)
  }

  setSource(source: RenderSource): void {
    const restart = this.running
    if (restart) this.stop()
    this.source = source
    this.sourceLive = isLiveSource(source)
    this.matchDirty = true
    this.hysteresisPrimed = false
    this.srcFxFor = undefined
    this.pool?.abandon()
    this.pending = undefined
    if (restart) this.start()
  }

  setOptions(options: AsciiRendererRuntimeOptions): void {
    const previous = this.opts
    this.opts = { ...previous, ...options }
    // One-frame hysteresis suppression happens after an option *change*, not
    // after any call — a value-identical setOptions must keep incumbents, or
    // this backend diverges from the WebGPU key-based reset. Field list
    // mirrors the WebGPU renderer's matchChanged.
    const changed =
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
    if (changed) {
      this.hysteresisPrimed = false
      // The in-flight band job was submitted against the old options; adopting
      // it would present one frame matched to something the caller has changed.
      this.pool?.abandon()
      this.pending = undefined
    }
    this.matchDirty = true
  }

  setInteraction(interaction: InteractionOptions | null): void {
    this.interaction = interaction
    this.scheduleFxPresent()
    this.ensureFxLoop()
  }

  resize(width: number, height: number): void {
    this.canvas.width = width
    this.canvas.height = height
    if (this.lastFrame) this.present(this.lastFrame)
  }

  /** Coalesce pointer/interaction updates into one composite-only present. */
  private scheduleFxPresent(): void {
    if (this.running || this.renderScheduled || this.destroyed || !this.lastFrame) return
    this.renderScheduled = true
    const run = (): void => {
      this.renderScheduled = false
      if (!this.destroyed && this.lastFrame) this.present(this.lastFrame)
    }
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run)
    else run()
  }

  /** Time-based effects keep compositing (never rematching) while static. */
  private ensureFxLoop(): void {
    if (this.fxRafId || this.running || this.destroyed) return
    if (!this.interaction || !TIME_BASED.has(this.interaction.type)) return
    if (typeof requestAnimationFrame === 'undefined') return
    const tick = (): void => {
      this.fxRafId = 0
      if (this.destroyed || this.running) return
      if (!this.interaction || !TIME_BASED.has(this.interaction.type)) return
      if (this.lastFrame) this.present(this.lastFrame)
      this.fxRafId = requestAnimationFrame(tick)
    }
    this.fxRafId = requestAnimationFrame(tick)
  }

  private extract(): RawImage {
    const source = this.source!
    if (isRawImage(source)) return source
    const [w, h] = sourceDims(source)
    if (!(w > 0) || !(h > 0)) throw new Error('Source has zero dimensions; is it loaded yet?')
    if (!this.scratch || this.scratch.width !== w || this.scratch.height !== h) {
      this.scratch =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : document.createElement('canvas')
      this.scratch.width = w
      this.scratch.height = h
    }
    const sctx = this.scratch.getContext('2d', { willReadFrequently: true }) as Ctx2D
    sctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
    const img = sctx.getImageData(0, 0, w, h)
    return { width: img.width, height: img.height, data: img.data }
  }

  private matchOptions(): MatchOptions {
    const base = {
      profile: this.profile,
      columns: this.opts.columns,
      rows: this.opts.rows,
      alpha: this.opts.alpha,
      background: this.opts.background,
    }
    if (this.opts.matcher !== 'chromatic') {
      return {
        ...base,
        color: this.opts.color,
        foreground: this.opts.foreground,
        flatThreshold: this.opts.flatThreshold,
      }
    }
    // chromatic-v1 fits no colour, so foreground/flat have nothing to act on.
    // Hysteresis needs the previous frame, and only when it describes the same
    // grid and the same source — see ALGORITHM.md §C5 on discontinuities.
    const previous =
      this.hysteresisPrimed && this.lastFrame?.colorMode === 'glyph'
        ? this.lastFrame.glyphIds
        : undefined
    return {
      ...base,
      matcher: 'chromatic' as const,
      ...(previous ? { previous, hysteresis: this.opts.hysteresis } : {}),
    }
  }

  private mkCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
    const c =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }

  /** The source as a drawable for reveal/original-mix layers. */
  private sourceDrawable(): CanvasImageSource | null {
    const source = this.source
    if (!source) return null
    if (!isRawImage(source)) return source as CanvasImageSource
    if (this.srcFxFor !== source) {
      if (
        !this.srcFxCanvas ||
        this.srcFxCanvas.width !== source.width ||
        this.srcFxCanvas.height !== source.height
      ) {
        this.srcFxCanvas = this.mkCanvas(source.width, source.height)
      }
      const c = this.srcFxCanvas.getContext('2d') as Ctx2D
      const data =
        source.data instanceof Uint8ClampedArray
          ? source.data
          : new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.length)
      c.putImageData(
        new ImageData(data as Uint8ClampedArray<ArrayBuffer>, source.width, source.height),
        0,
        0,
      )
      this.srcFxFor = source
    }
    return this.srcFxCanvas as CanvasImageSource
  }

  /** Render the frame into the native-cell-size composite canvas (cached per frame). */
  /**
   * One fullscreen draw. The view maths below is engine.ts's `syncView`, not a
   * second derivation of it — this compositor is the WebGPU one, so its grid
   * placement and atlas LOD have to land on the same numbers.
   */
  private presentGl(frame: AsciiFrame): void {
    const { atlas } = this.profile
    const cw = this.canvas.width
    const ch = this.canvas.height
    const color = this.opts.color ?? 'mono'
    const gridW = frame.columns * atlas.cellWidth
    const gridH = frame.rows * atlas.cellHeight
    const fit = this.opts.fit ?? 'contain'
    let sx = cw / gridW
    let sy = ch / gridH
    if (fit === 'contain') sx = sy = Math.min(sx, sy)
    else if (fit === 'cover') sx = sy = Math.max(sx, sy)
    const cellScreenW = atlas.cellWidth * sx
    const cellScreenH = atlas.cellHeight * sy
    const transparent = outputCanBeTransparent(this.opts)
    const bd = this.opts.background ?? [0, 0, 0]
    const view: GlViewParams = {
      canvasWidth: cw,
      canvasHeight: ch,
      colorMode: color,
      originX: (cw - frame.columns * cellScreenW) / 2,
      originY: (ch - frame.rows * cellScreenH) / 2,
      cellScreenW,
      cellScreenH,
      lod: Math.min(
        GL_ATLAS_MIPS - 1,
        Math.max(
          0,
          Math.log2(Math.max(atlas.cellWidth / cellScreenW, atlas.cellHeight / cellScreenH, 1)),
        ),
      ),
      useBackdrop: (color === 'glyph' || color === 'mono') && !transparent,
      backdrop: bd,
      clearColor:
        this.opts.clearColor ??
        (color === 'foreground' || (color === 'glyph' && transparent)
          ? [0, 0, 0, 0]
          : color === 'glyph'
            ? [bd[0] / 255, bd[1] / 255, bd[2] / 255, 1]
            : [0, 0, 0, 1]),
      foreground: this.opts.foreground ?? [255, 255, 255],
      background: bd,
    }

    const interaction = this.interaction
    const minDim = Math.min(cw, ch)
    const kind = interaction ? (GL_FX_KIND[interaction.type] ?? 0) : 0
    const fx: GlFxParams = {
      kind,
      pointerX: this.pointerX * cw,
      pointerY: this.pointerY * ch,
      radiusPx: (interaction?.radius ?? 0.15) * minDim,
      featherPx: (interaction?.feather ?? 0.06) * minDim,
      intensity: interaction?.intensity ?? 1,
      time: (performance.now() - this.t0) / 1000,
      source: kind === 1 || kind === 8 ? this.sourceTexture() : undefined,
    }
    this.glc!.present(frame, view, fx)
  }

  /**
   * The source as something WebGL can upload. CanvasImageSource also admits
   * SVGImageElement, which texImage2D does not take; the effects that sample
   * the source degrade to not sampling it rather than throwing.
   */
  private sourceTexture(): TexImageSource | undefined {
    const drawable = this.sourceDrawable()
    if (!drawable) return undefined
    if (typeof SVGImageElement !== 'undefined' && drawable instanceof SVGImageElement) {
      return undefined
    }
    return drawable as TexImageSource
  }

  private ensureBase(frame: AsciiFrame): void {
    if (frame === this.lastComposited && this.compositeCanvas) return
    // Same predicate the WebGPU renderer keys its alphaMode on: when the caller asked for
    // a see-through ground, the frame must not bake an opaque background plane, or the
    // grid presents as a slab while the letterbox lets the page through. `full` keeps its
    // per-cell sampled background either way — that plane is content, not a backdrop.
    const img = compositeFrame(
      frame,
      {
        foreground: this.opts.foreground,
        background: outputCanBeTransparent(this.opts) ? null : this.opts.background,
      },
      this.compositeBuf,
    )
    this.compositeBuf = img
    if (
      !this.compositeCanvas ||
      this.compositeCanvas.width !== img.width ||
      this.compositeCanvas.height !== img.height
    ) {
      this.compositeCanvas = this.mkCanvas(img.width, img.height)
    }
    const cctx = this.compositeCanvas.getContext('2d') as Ctx2D
    const data =
      img.data instanceof Uint8ClampedArray
        ? img.data
        : new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length)
    cctx.putImageData(
      new ImageData(data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height),
      0,
      0,
    )
    this.lastComposited = frame
    this.pyrValid = 0
  }

  /**
   * Canvas2D "mips": box-halved copies of the composite. A single bilinear
   * drawImage below ~0.5× undersamples the glyph strokes and thins the ink
   * compared to the GPU's mip-sampled atlas (most visible on dpr-1 screens);
   * stepping down a halving chain first keeps stroke weight consistent.
   */
  private mipBase(levels: number): HTMLCanvasElement | OffscreenCanvas {
    let src = this.compositeCanvas!
    for (let i = 0; i < levels; i++) {
      const w = Math.max(1, Math.ceil(src.width / 2))
      const h = Math.max(1, Math.ceil(src.height / 2))
      let cv = this.pyr[i]
      if (!cv || cv.width !== w || cv.height !== h) {
        cv = this.mkCanvas(w, h)
        this.pyr[i] = cv
        this.pyrValid = Math.min(this.pyrValid, i)
      }
      if (this.pyrValid <= i) {
        const c = cv.getContext('2d') as Ctx2D
        c.imageSmoothingQuality = 'high'
        c.clearRect(0, 0, w, h)
        c.drawImage(src, 0, 0, w, h)
        this.pyrValid = i + 1
      }
      src = cv
    }
    return src
  }

  /** Draw the composited frame to the target with fit + interaction effects. */
  private present(frame: AsciiFrame): void {
    if (this.glc && !this.glc.unavailable) {
      this.presentGl(frame)
      return
    }
    this.ensureBase(frame)
    const base0 = this.compositeCanvas!
    const ctx = this.ctx!
    const cw = this.canvas.width
    const ch = this.canvas.height
    const color = this.opts.color ?? 'mono'
    const clear = this.opts.clearColor ?? (color === 'foreground' ? [0, 0, 0, 0] : [0, 0, 0, 1])
    ctx.clearRect(0, 0, cw, ch)
    if (clear[3] > 0) {
      ctx.fillStyle = `rgba(${(clear[0] * 255) | 0},${(clear[1] * 255) | 0},${(clear[2] * 255) | 0},${clear[3]})`
      ctx.fillRect(0, 0, cw, ch)
    }
    const fit = this.opts.fit ?? 'contain'
    let dw = cw
    let dh = ch
    if (fit !== 'stretch') {
      const s =
        fit === 'contain'
          ? Math.min(cw / base0.width, ch / base0.height)
          : Math.max(cw / base0.width, ch / base0.height)
      dw = base0.width * s
      dh = base0.height * s
    }
    const dx = (cw - dw) / 2
    const dy = (ch - dh) / 2
    let levels = 0
    let bw = base0.width
    let bh = base0.height
    while (bw * 0.5 >= dw && bh * 0.5 >= dh) {
      bw = Math.max(1, Math.ceil(bw / 2))
      bh = Math.max(1, Math.ceil(bh / 2))
      levels++
    }
    const base = levels > 0 ? this.mipBase(levels) : base0

    const fx = this.interaction
    const kind = fx?.type ?? null
    const time = (performance.now() - this.t0) / 1000
    const minDim = Math.min(cw, ch)
    const px = this.pointerX * cw
    const py = this.pointerY * ch
    const radius = (fx?.radius ?? 0.15) * minDim
    const feather = (fx?.feather ?? 0.06) * minDim
    const intensity = fx?.intensity ?? 1
    const cellW = dw / frame.columns
    const cellH = dh / frame.rows

    if (kind === 'wave') {
      // Horizontal strip warp, one strip per cell row. The shader offsets the
      // *sampling* position (display(x) = base(x + off)), so the strip lands
      // at dx − off.
      const strips = frame.rows
      const srcStripH = base.height / strips
      for (let i = 0; i < strips; i++) {
        const yMid = dy + (i + 0.5) * cellH
        const off = Math.sin((yMid / Math.max(cellH, 1)) * 1.5 + time * 3) * intensity * cellW * 0.6
        ctx.drawImage(
          base,
          0,
          i * srcStripH,
          base.width,
          srcStripH,
          dx - off,
          dy + i * cellH,
          dw,
          cellH,
        )
      }
    } else {
      ctx.drawImage(base, dx, dy, dw, dh)
    }

    if (kind === 'reveal' || kind === 'original-mix' || kind === 'color') {
      if (!this.fxLayer || this.fxLayer.width !== cw || this.fxLayer.height !== ch)
        this.fxLayer = this.mkCanvas(cw, ch)
      const layer = this.fxLayer.getContext('2d') as Ctx2D
      layer.imageSmoothingQuality = 'high'
      layer.clearRect(0, 0, cw, ch)
      if (kind === 'color') {
        layer.filter = 'hue-rotate(140deg)'
        layer.drawImage(base, dx, dy, dw, dh)
        layer.filter = 'none'
      } else {
        const src = this.sourceDrawable()
        if (src) layer.drawImage(src, dx, dy, dw, dh)
      }
      const m = Math.max(0, Math.min(1, intensity))
      if (kind === 'original-mix') {
        ctx.globalAlpha = m
        ctx.drawImage(this.fxLayer, 0, 0)
        ctx.globalAlpha = 1
      } else {
        layer.globalCompositeOperation = 'destination-in'
        const grad = layer.createRadialGradient(
          px,
          py,
          Math.max(radius - feather, 0),
          px,
          py,
          radius + feather,
        )
        grad.addColorStop(0, `rgba(255,255,255,${m})`)
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        layer.fillStyle = grad
        layer.fillRect(0, 0, cw, ch)
        layer.globalCompositeOperation = 'source-over'
        ctx.drawImage(this.fxLayer, 0, 0)
      }
    } else if (
      kind === 'push' ||
      kind === 'resolution' ||
      kind === 'displace' ||
      kind === 'glyph-scale' ||
      kind === 'glyph-rotate'
    ) {
      // Cell-granular implementation of the exact GPU warp math: evaluate the
      // fragment shader's formula at each affected cell's center and redraw
      // that cell from its warped source position (or with the glyph-local
      // transform). The content is a glyph grid, so cell quantization is
      // nearly invisible — and it stays cheap: only cells inside the
      // influence radius are touched.
      const R = radius + feather
      const innerEdge = Math.max(radius - feather, 0)
      const scaleX = dw / base.width
      const scaleY = dh / base.height
      const baseCellW = base.width / frame.columns
      const baseCellH = base.height / frame.rows
      const c0 = Math.max(0, Math.floor((px - R - dx) / cellW) - 1)
      const c1 = Math.min(frame.columns - 1, Math.ceil((px + R - dx) / cellW))
      const r0 = Math.max(0, Math.floor((py - R - dy) / cellH) - 1)
      const r1 = Math.min(frame.rows - 1, Math.ceil((py + R - dy) / cellH))
      const clearFill =
        clear[3] > 0
          ? `rgba(${(clear[0] * 255) | 0},${(clear[1] * 255) | 0},${(clear[2] * 255) | 0},${clear[3]})`
          : null
      // The shader's warp in canvas coords: where display pixel (x, y) samples.
      const warpAt = (x: number, y: number): [number, number] => {
        if (kind === 'displace') {
          const f = 1 - smoothstep(innerEdge, R, Math.hypot(x - px, y - py))
          const amp = f * intensity * cellW * 0.8
          return [x + Math.sin(y * 0.11 + time * 2) * amp, y + Math.cos(x * 0.13 + time * 2) * amp]
        }
        if (kind === 'push') {
          const dxp = x - px
          const dyp = y - py
          const dd = Math.max(Math.hypot(dxp, dyp), 0.001)
          const mag = (1 - smoothstep(0, R, dd)) * intensity * radius * 0.35
          return [x - (dxp / dd) * mag, y - (dyp / dd) * mag]
        }
        if (kind === 'resolution') {
          // magnify: sample = pointer + (px − pointer)/(1 + I·falloff)
          const s = 1 + intensity * (1 - smoothstep(innerEdge, R, Math.hypot(x - px, y - py)))
          return [px + (x - px) / s, py + (y - py) / s]
        }
        return [x, y]
      }
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cxp = dx + (c + 0.5) * cellW
          const cyp = dy + (r + 0.5) * cellH
          const d = Math.hypot(cxp - px, cyp - py)
          const fall = 1 - smoothstep(innerEdge, R, d)
          const destX = dx + c * cellW
          const destY = dy + r * cellH

          if (kind === 'glyph-scale' || kind === 'glyph-rotate') {
            if (fall < 0.02) continue
            const srcX = c * baseCellW
            const srcY = r * baseCellH
            ctx.clearRect(destX, destY, cellW, cellH)
            if (clearFill) {
              ctx.fillStyle = clearFill
              ctx.fillRect(destX, destY, cellW, cellH)
            }
            ctx.save()
            ctx.beginPath()
            ctx.rect(destX, destY, cellW, cellH)
            ctx.clip()
            if (kind === 'glyph-scale') {
              // GPU samples local·s with s = max(1 − 0.75·I·f, 0.25) → glyph magnified by 1/s.
              const s = Math.max(1 - 0.75 * intensity * fall, 0.25)
              const sw = baseCellW * s
              const sh = baseCellH * s
              ctx.drawImage(
                base,
                srcX + (baseCellW - sw) / 2,
                srcY + (baseCellH - sh) / 2,
                sw,
                sh,
                destX,
                destY,
                cellW,
                cellH,
              )
            } else {
              // GPU rotates the sampling uv by +ang → the glyph appears rotated by −ang.
              const ang = intensity * fall * Math.PI
              ctx.translate(destX + cellW / 2, destY + cellH / 2)
              ctx.rotate(-ang)
              ctx.drawImage(
                base,
                srcX,
                srcY,
                baseCellW,
                baseCellH,
                -cellW / 2,
                -cellH / 2,
                cellW,
                cellH,
              )
            }
            ctx.restore()
            continue
          }

          // Warp kinds — display(px) = base(warp(px)). First-order per-cell
          // affine fit: offset from the warp at the cell center, axis scales
          // from finite differences half a cell out. The scales matter where
          // the warp compresses hard (push's core, magnify's center): a
          // constant offset there produces rings of repeated cells; the
          // affine fit stretches smoothly like the shader.
          const [wx, wy] = warpAt(cxp, cyp)
          const swC = Math.max(
            warpAt(cxp + cellW / 2, cyp)[0] - warpAt(cxp - cellW / 2, cyp)[0],
            cellW * 0.05,
          )
          const shC = Math.max(
            warpAt(cxp, cyp + cellH / 2)[1] - warpAt(cxp, cyp - cellH / 2)[1],
            cellH * 0.05,
          )
          if (
            Math.abs(wx - cxp) < 0.4 &&
            Math.abs(wy - cyp) < 0.4 &&
            Math.abs(swC - cellW) < 0.4 &&
            Math.abs(shC - cellH) < 0.4
          ) {
            continue // identity up to sub-pixel: keep the untouched base draw
          }
          // Source rect in base coordinates, intersected with the base so
          // out-of-bounds sampling shows background (like the GPU's clear).
          const sw = swC / scaleX
          const sh = shC / scaleY
          const sx = (wx - dx) / scaleX - sw / 2
          const sy = (wy - dy) / scaleY - sh / 2
          const ix0 = Math.max(sx, 0)
          const iy0 = Math.max(sy, 0)
          const ix1 = Math.min(sx + sw, base.width)
          const iy1 = Math.min(sy + sh, base.height)
          ctx.clearRect(destX, destY, cellW, cellH)
          if (clearFill) {
            ctx.fillStyle = clearFill
            ctx.fillRect(destX, destY, cellW, cellH)
          }
          if (ix1 > ix0 && iy1 > iy0) {
            const kx = cellW / sw
            const ky = cellH / sh
            ctx.drawImage(
              base,
              ix0,
              iy0,
              ix1 - ix0,
              iy1 - iy0,
              destX + (ix0 - sx) * kx,
              destY + (iy0 - sy) * ky,
              (ix1 - ix0) * kx,
              (iy1 - iy0) * ky,
            )
          }
        }
      }
    }
  }

  render(): void {
    if (this.destroyed || !this.source) return
    if (this.matchDirty || this.sourceLive || !this.lastFrame) {
      if (!this.matchOnWorkers()) {
        this.lastFrame = matchFrame(this.extract(), this.matchOptions())
        this.hysteresisPrimed = true
        this.matchDirty = false
      }
    }
    if (this.lastFrame) this.present(this.lastFrame)
  }

  /**
   * Pipelined matching on the worker pool: adopt whatever finished since the
   * last frame, then dispatch this one. Costs one frame of latency on live
   * sources and gives the main thread back the ~25 ms/frame the cell loop
   * takes at 160×42 — the cells themselves are the same bytes either way
   * (@ascii-fx/core's band tests). Returns false when the caller has to match
   * on the main thread instead.
   */
  private matchOnWorkers(): boolean {
    // chromatic-v1 carries frame-to-frame hysteresis and is not banded.
    if (this.opts.matcher === 'chromatic') return false
    const pool = this.ensurePool()
    if (!pool || !pool.ready || pool.failed) return false
    // Nothing on screen yet: match now rather than show a frame of nothing.
    if (!this.lastFrame) return false

    const done = pool.take()
    if (done && this.pending) {
      this.lastFrame = new AsciiFrame({
        columns: this.pending.columns,
        rows: this.pending.rows,
        colorMode: this.pending.colorMode,
        glyphIds: done.glyphIds,
        foreground: done.foreground,
        background: done.background,
        flags: done.flags,
        profile: this.profile,
      })
      this.hysteresisPrimed = true
      this.pending = undefined
      this.matchDirty = false
    }

    if (!pool.busy) {
      const source = this.extract()
      const { columns, rows } = deriveGrid(
        source.width,
        source.height,
        this.profile,
        this.opts.columns,
        this.opts.rows,
      )
      const colorMode = this.opts.color ?? 'mono'
      const options: BandOptions = {
        color: colorMode,
        alpha: this.opts.alpha ?? 'mask',
        flatThreshold: this.opts.flatThreshold,
        foreground: this.opts.foreground,
        background: this.opts.background,
      }
      if (pool.submit(source, columns, rows, options)) {
        this.pending = { columns, rows, colorMode }
        this.matchDirty = false
        this.scheduleAdopt()
      }
    }
    return true
  }

  /**
   * Drive adoption when nothing else will. A running loop re-enters render()
   * on its own, but a caller who renders by hand — a still image, a manual
   * loop — would otherwise submit a band job whose result nobody ever picks
   * up, leaving the last frame on the canvas for good.
   */
  private scheduleAdopt(): void {
    if (this.running || this.adoptScheduled || this.destroyed) return
    this.adoptScheduled = true
    requestAnimationFrame(() => {
      this.adoptScheduled = false
      if (this.destroyed || this.running) return
      this.render()
      if (this.pending) this.scheduleAdopt()
    })
  }

  start(): void {
    if (this.running || this.destroyed) return
    this.running = true
    const generation = ++this.loopGeneration
    if (this.fxRafId) {
      cancelAnimationFrame(this.fxRafId)
      this.fxRafId = 0
    }
    const video =
      typeof HTMLVideoElement !== 'undefined' && this.source instanceof HTMLVideoElement
        ? this.source
        : null
    if (video && 'requestVideoFrameCallback' in video) {
      const cb = (): void => {
        if (!this.running || generation !== this.loopGeneration) return
        this.matchDirty = true
        this.render()
        this.rvfcId = video.requestVideoFrameCallback(cb)
      }
      this.rvfcId = video.requestVideoFrameCallback(cb)
    } else {
      const tick = (): void => {
        if (!this.running || generation !== this.loopGeneration) return
        this.render()
        this.rafId = requestAnimationFrame(tick)
      }
      this.rafId = requestAnimationFrame(tick)
    }
  }

  stop(): void {
    this.running = false
    this.loopGeneration++
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
    if (this.fxRafId) cancelAnimationFrame(this.fxRafId)
    this.fxRafId = 0
  }

  /** CPU v1 has no partial rematch: an invalidation re-matches fully (correct, just not partial). */
  invalidate(_rect: { x: number; y: number; width: number; height: number }): void {
    this.matchDirty = true
  }

  async captureFrame(): Promise<AsciiFrame> {
    if (!this.source) throw new Error('captureFrame() requires a source — call setSource() first.')
    // A pending band job means lastFrame is one frame behind the source, and a
    // capture that returns the previous frame is wrong rather than merely late.
    // Match inline and drop the in-flight job, which is now redundant.
    if (this.matchDirty || !this.lastFrame || this.pending) {
      this.pool?.abandon()
      this.pending = undefined
      this.lastFrame = matchFrame(this.extract(), this.matchOptions())
      this.hysteresisPrimed = true
      this.matchDirty = false
    }
    return this.lastFrame
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
    this.stop()
    if (this.fxRafId) cancelAnimationFrame(this.fxRafId)
    this.fxRafId = 0
    this.destroyed = true
    this.glc?.destroy()
    this.pool?.destroy()
    this.pool = undefined
    this.pending = undefined
    this.source = undefined
    this.lastFrame = undefined
    this.lastComposited = undefined
    this.scratch = undefined
    this.compositeCanvas = undefined
    this.compositeBuf = undefined
    this.fxLayer = undefined
    this.srcFxCanvas = undefined
  }
}
