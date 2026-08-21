import type { AsciiFrame, AsciiProfile, MatchOptions, RawImage } from '@ascii-fx/core'
import { compositeFrame, deriveGrid, matchFrame } from '@ascii-fx/core'
import type {
  AsciiPointer,
  AsciiRenderer,
  AsciiRendererOptions,
  AsciiRendererRuntimeOptions,
  InteractionOptions,
  RenderSource,
} from './types.js'
import { isLiveSource, isRawImage, sourceDims } from './types.js'

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
  private readonly ctx: Ctx2D
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

  constructor(options: AsciiRendererOptions) {
    this.canvas = options.canvas
    this.profile = options.profile
    const { canvas: _c, profile: _p, backend: _b, interaction, ...rest } = options
    this.opts = rest
    this.interaction = interaction ?? null
    const ctx = this.canvas.getContext('2d') as Ctx2D | null
    if (!ctx) {
      throw new Error(
        "CPU backend could not acquire a 2d context on the target canvas. A canvas is permanently bound to its " +
          "first context type — if this canvas previously ran the WebGPU backend, create a fresh <canvas> element " +
          'to switch backends.',
      )
    }
    this.ctx = ctx
    ctx.imageSmoothingQuality = 'high'
    this.pointer = {
      set: (x: number, y: number) => {
        this.pointerX = x
        this.pointerY = y
        this.scheduleFxPresent()
      },
      setVelocity: () => {},
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
    if (restart) this.start()
  }

  setOptions(options: AsciiRendererRuntimeOptions): void {
    this.hysteresisPrimed = false
    this.opts = { ...this.opts, ...options }
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
        typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas')
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
      this.hysteresisPrimed && this.lastFrame?.colorMode === 'glyph' ? this.lastFrame.glyphIds : undefined
    return {
      ...base,
      matcher: 'chromatic' as const,
      ...(previous ? { previous, hysteresis: this.opts.hysteresis } : {}),
    }
  }

  private mkCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas')
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
      if (!this.srcFxCanvas || this.srcFxCanvas.width !== source.width || this.srcFxCanvas.height !== source.height) {
        this.srcFxCanvas = this.mkCanvas(source.width, source.height)
      }
      const c = this.srcFxCanvas.getContext('2d') as Ctx2D
      const data =
        source.data instanceof Uint8ClampedArray
          ? source.data
          : new Uint8ClampedArray(source.data.buffer, source.data.byteOffset, source.data.length)
      c.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, source.width, source.height), 0, 0)
      this.srcFxFor = source
    }
    return this.srcFxCanvas as CanvasImageSource
  }

  /** Render the frame into the native-cell-size composite canvas (cached per frame). */
  private ensureBase(frame: AsciiFrame): void {
    if (frame === this.lastComposited && this.compositeCanvas) return
    const color = frame.colorMode
    const img = compositeFrame(
      frame,
      color === 'foreground'
        ? { background: null }
        : { foreground: this.opts.foreground, background: this.opts.background },
      this.compositeBuf,
    )
    this.compositeBuf = img
    if (!this.compositeCanvas || this.compositeCanvas.width !== img.width || this.compositeCanvas.height !== img.height) {
      this.compositeCanvas = this.mkCanvas(img.width, img.height)
    }
    const cctx = this.compositeCanvas.getContext('2d') as Ctx2D
    const data =
      img.data instanceof Uint8ClampedArray
        ? img.data
        : new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length)
    cctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
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
    this.ensureBase(frame)
    const base0 = this.compositeCanvas!
    const ctx = this.ctx
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
      const s = fit === 'contain' ? Math.min(cw / base0.width, ch / base0.height) : Math.max(cw / base0.width, ch / base0.height)
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
        ctx.drawImage(base, 0, i * srcStripH, base.width, srcStripH, dx - off, dy + i * cellH, dw, cellH)
      }
    } else {
      ctx.drawImage(base, dx, dy, dw, dh)
    }

    if (kind === 'reveal' || kind === 'original-mix' || kind === 'color') {
      if (!this.fxLayer || this.fxLayer.width !== cw || this.fxLayer.height !== ch) this.fxLayer = this.mkCanvas(cw, ch)
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
        const grad = layer.createRadialGradient(px, py, Math.max(radius - feather, 0), px, py, radius + feather)
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
              ctx.drawImage(base, srcX + (baseCellW - sw) / 2, srcY + (baseCellH - sh) / 2, sw, sh, destX, destY, cellW, cellH)
            } else {
              // GPU rotates the sampling uv by +ang → the glyph appears rotated by −ang.
              const ang = intensity * fall * Math.PI
              ctx.translate(destX + cellW / 2, destY + cellH / 2)
              ctx.rotate(-ang)
              ctx.drawImage(base, srcX, srcY, baseCellW, baseCellH, -cellW / 2, -cellH / 2, cellW, cellH)
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
          const swC = Math.max(warpAt(cxp + cellW / 2, cyp)[0] - warpAt(cxp - cellW / 2, cyp)[0], cellW * 0.05)
          const shC = Math.max(warpAt(cxp, cyp + cellH / 2)[1] - warpAt(cxp, cyp - cellH / 2)[1], cellH * 0.05)
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
      this.lastFrame = matchFrame(this.extract(), this.matchOptions())
      this.hysteresisPrimed = true
      this.matchDirty = false
    }
    this.present(this.lastFrame)
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
      typeof HTMLVideoElement !== 'undefined' && this.source instanceof HTMLVideoElement ? this.source : null
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
      typeof HTMLVideoElement !== 'undefined' && this.source instanceof HTMLVideoElement ? this.source : null
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
    if (this.matchDirty || !this.lastFrame) {
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
