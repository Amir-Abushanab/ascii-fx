import type { AlphaMode, AsciiProfile, ColorMode, RGB } from '@ascii-fx/core'
import { AsciiFrame, FLAG_TRANSPARENT, blankGlyphId, deriveGrid, luma8 } from '@ascii-fx/core'
import {
  chromaticMatchWgsl,
  COMPOSITE_WGSL,
  FEATURES_WGSL,
  MAX_GPU_GLYPHS,
  MIPGEN_WGSL,
  REDUCE_WGSL,
  matchWgsl,
} from './shaders.js'
import type { FitMode, InteractionOptions, InteractionType } from './types.js'

const ATLAS_MIPS = 4
/** Reduction block bound keeping u32 accumulators exact (ALGORITHM.md §0). */
const MAX_REDUCTION_BLOCK = 16384

// 'glyph' is reserved here so the map stays total over ColorMode; the WebGPU
// compositor cannot draw it yet (it samples an R8 coverage atlas and tints it,
// where a glyph-coloured frame needs the RGBA atlas chromatic profiles carry).
// configure() rejects it rather than letting it render as 'full' with garbage.
const COLOR_MODE_CODE: Record<ColorMode, number> = { mono: 0, foreground: 1, full: 2, glyph: 3 }

/** ALGORITHM.md §0 rounding, specialised to the /255 the alpha composite needs. */
const rdiv255 = (n: number): number => Math.floor((2 * n + 255) / 510)

const FX_KIND: Record<InteractionType, number> = {
  reveal: 1,
  displace: 2,
  wave: 3,
  push: 4,
  color: 5,
  'glyph-scale': 6,
  'glyph-rotate': 7,
  'original-mix': 8,
  resolution: 9,
}

const pack24 = (rgb: readonly [number, number, number]): number =>
  (rgb[0] | (rgb[1] << 8) | (rgb[2] << 16)) >>> 0

export interface StreamMatchOptions {
  columns?: number
  rows?: number
  color?: ColorMode
  /** Default 'structural'. 'chromatic' implies colorMode 'glyph' (ALGORITHM.md §C). */
  matcher?: 'structural' | 'chromatic'
  alpha?: AlphaMode
  foreground?: RGB
  background?: RGB
  flatThreshold?: number
  /** Source texels are linear-light; encode to sRGB before quantization (§28, Three render targets). */
  srgbEncode?: boolean
  /** Exact temporal reuse (spec §21): unchanged cells skip matching. Costs one reduced-buffer copy per frame. */
  temporal?: boolean
  /**
   * chromatic-v1 only (ALGORITHM.md §C5): keep the previous glyph unless a
   * challenger beats it by this fraction. Default 0 (off). The previous frame
   * is whatever the cells buffer already holds, so no extra state is needed.
   */
  hysteresis?: number
}

export interface StreamViewOptions {
  width: number
  height: number
  fit?: FitMode
  clearColor?: readonly [number, number, number, number]
}

export interface StreamFxState {
  interaction: InteractionOptions | null
  /** Device pixels. */
  pointerX: number
  pointerY: number
  velX: number
  velY: number
  /** Seconds. */
  time: number
}

/**
 * Static per-(device, profile) GPU resources: pipelines, atlas + mips, glyph
 * buffers. Shareable across streams and embeddable in foreign devices (the
 * Three.js adapter runs this on the renderer's own GPUDevice).
 */
export class AsciiEngine {
  readonly device: GPUDevice
  readonly profile: AsciiProfile
  readonly pipeReduce: GPUComputePipeline
  readonly pipeFeatures: GPUComputePipeline
  readonly pipeMatch: GPUComputePipeline
  /** chromatic-v1 matcher; null unless the profile carries chromatic data. */
  readonly pipeChromatic: GPUComputePipeline | null
  readonly atlasTexture: GPUTexture
  /** RGBA glyph art for chromatic profiles; a 1x1 placeholder otherwise. */
  readonly atlasRgbaTexture: GPUTexture
  readonly sampler: GPUSampler
  readonly masksBuf: GPUBuffer
  readonly coverageBuf: GPUBuffer
  private readonly compositeModule: GPUShaderModule
  private readonly compositeCache = new Map<GPUTextureFormat, Promise<GPURenderPipeline>>()

  private constructor(init: {
    device: GPUDevice
    profile: AsciiProfile
    pipelines: [GPUComputePipeline, GPUComputePipeline, GPUComputePipeline]
    pipeChromatic: GPUComputePipeline | null
    atlasTexture: GPUTexture
    atlasRgbaTexture: GPUTexture
    sampler: GPUSampler
    masksBuf: GPUBuffer
    coverageBuf: GPUBuffer
    compositeModule: GPUShaderModule
  }) {
    this.device = init.device
    this.profile = init.profile
    ;[this.pipeReduce, this.pipeFeatures, this.pipeMatch] = init.pipelines
    this.pipeChromatic = init.pipeChromatic
    this.atlasTexture = init.atlasTexture
    this.atlasRgbaTexture = init.atlasRgbaTexture
    this.sampler = init.sampler
    this.masksBuf = init.masksBuf
    this.coverageBuf = init.coverageBuf
    this.compositeModule = init.compositeModule
  }

  static async create(device: GPUDevice, profile: AsciiProfile): Promise<AsciiEngine> {
    if (profile.glyphCount > MAX_GPU_GLYPHS) {
      throw new Error(
        `Profile has ${profile.glyphCount} glyphs; the GPU matcher supports up to ${MAX_GPU_GLYPHS}. ` +
          'Use the CPU backend for larger charsets.',
      )
    }
    const { atlas, structural } = profile
    const atlasTexture = device.createTexture({
      size: [atlas.width, atlas.height],
      format: 'r8unorm',
      mipLevelCount: ATLAS_MIPS,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    device.queue.writeTexture(
      { texture: atlasTexture },
      atlas.data as Uint8Array<ArrayBuffer>,
      { bytesPerRow: atlas.width },
      [atlas.width, atlas.height],
    )

    const masks = new Uint32Array(profile.glyphCount * 2)
    for (let g = 0; g < profile.glyphCount; g++) {
      masks[g * 2] = structural.masksLo[g]
      masks[g * 2 + 1] = structural.masksHi[g]
    }
    const masksBuf = device.createBuffer({
      size: masks.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(masksBuf, 0, masks)

    const coverage = new Uint32Array(profile.glyphCount)
    for (let g = 0; g < profile.glyphCount; g++) coverage[g] = structural.coverage[g]
    const coverageBuf = device.createBuffer({
      size: coverage.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(coverageBuf, 0, coverage)

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })

    // chromatic-v1 draws real glyph art, so it needs the RGBA plane. Profiles
    // without one still bind a 1x1 placeholder: a bind group layout cannot vary
    // per draw, and an unbound texture is a validation error rather than a
    // silently skipped sample.
    const hasRgba = atlas.rgba !== undefined
    const atlasRgbaTexture = device.createTexture({
      size: hasRgba ? [atlas.width, atlas.height] : [1, 1],
      format: 'rgba8unorm',
      mipLevelCount: hasRgba ? ATLAS_MIPS : 1,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    if (atlas.rgba) {
      device.queue.writeTexture(
        { texture: atlasRgbaTexture },
        atlas.rgba as Uint8Array<ArrayBuffer>,
        { bytesPerRow: atlas.width * 4 },
        [atlas.width, atlas.height],
      )
    }

    const mkCompute = (code: string): Promise<GPUComputePipeline> =>
      device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
      })
    const compositeModule = device.createShaderModule({ code: COMPOSITE_WGSL })
    const mipModule = device.createShaderModule({ code: MIPGEN_WGSL })
    const [reduce, features, match, mipgen, mipgenRgba, chromatic] = await Promise.all([
      mkCompute(REDUCE_WGSL),
      mkCompute(FEATURES_WGSL),
      mkCompute(matchWgsl(MAX_GPU_GLYPHS)),
      device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: mipModule, entryPoint: 'vs' },
        fragment: { module: mipModule, entryPoint: 'fs', targets: [{ format: 'r8unorm' }] },
        primitive: { topology: 'triangle-list' },
      }),
      hasRgba
        ? device.createRenderPipelineAsync({
            layout: 'auto',
            vertex: { module: mipModule, entryPoint: 'vs' },
            fragment: { module: mipModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list' },
          })
        : Promise.resolve(null),
      profile.chromatic ? mkCompute(chromaticMatchWgsl()) : Promise.resolve(null),
    ])

    // Atlas mip chain: box-filtered halvings (pow2 pitch keeps padding intact §24).
    const enc = device.createCommandEncoder()
    for (let level = 1; level < ATLAS_MIPS; level++) {
      const bg = device.createBindGroup({
        layout: mipgen.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: atlasTexture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
          },
          { binding: 1, resource: sampler },
        ],
      })
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: atlasTexture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
            loadOp: 'clear',
            clearValue: [0, 0, 0, 0],
            storeOp: 'store',
          },
        ],
      })
      pass.setPipeline(mipgen)
      pass.setBindGroup(0, bg)
      pass.draw(3)
      pass.end()

      // The RGBA plane needs the same chain: the compositor picks a LOD from
      // how small the cell lands on screen, and an unmipped colour atlas would
      // alias badly exactly where a text profile would not.
      if (mipgenRgba) {
        const bgRgba = device.createBindGroup({
          layout: mipgenRgba.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: atlasRgbaTexture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
            },
            { binding: 1, resource: sampler },
          ],
        })
        const passRgba = enc.beginRenderPass({
          colorAttachments: [
            {
              view: atlasRgbaTexture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
              loadOp: 'clear',
              clearValue: [0, 0, 0, 0],
              storeOp: 'store',
            },
          ],
        })
        passRgba.setPipeline(mipgenRgba)
        passRgba.setBindGroup(0, bgRgba)
        passRgba.draw(3)
        passRgba.end()
      }
    }
    device.queue.submit([enc.finish()])

    return new AsciiEngine({
      device,
      profile,
      pipelines: [reduce, features, match],
      pipeChromatic: chromatic,
      atlasTexture,
      atlasRgbaTexture,
      sampler,
      masksBuf,
      coverageBuf,
      compositeModule,
    })
  }

  compositePipeline(format: GPUTextureFormat): Promise<GPURenderPipeline> {
    let p = this.compositeCache.get(format)
    if (!p) {
      p = this.device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: this.compositeModule, entryPoint: 'vs' },
        fragment: { module: this.compositeModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      })
      this.compositeCache.set(format, p)
    }
    return p
  }

  async createStream(compositeFormat: GPUTextureFormat): Promise<AsciiStream> {
    return new AsciiStream(this, await this.compositePipeline(compositeFormat))
  }

  /** Releases engine-owned resources. Does not destroy the device. */
  destroy(): void {
    this.atlasTexture.destroy()
    this.atlasRgbaTexture.destroy()
    this.masksBuf.destroy()
    this.coverageBuf.destroy()
  }
}

/** Per-source matching + compositing state (buffers, bind groups, uniforms). */
export class AsciiStream {
  readonly engine: AsciiEngine
  private readonly pipeComposite: GPURenderPipeline
  private readonly paramsBuf: GPUBuffer
  private readonly compBuf: GPUBuffer
  private readonly fxBuf: GPUBuffer
  private readonly paramsScratch = new Uint32Array(20)
  private readonly compScratch = new ArrayBuffer(96)
  private readonly fxScratch = new ArrayBuffer(48)

  private gridDims?: { columns: number; rows: number }
  private opts: StreamMatchOptions = {}
  private boundSrc?: GPUTexture
  private srcW = 0
  private srcH = 0
  private reducedBuf?: GPUBuffer
  private prevReducedBuf?: GPUBuffer
  /**
   * Exact temporal reuse is a structural-v1 feature: it skips a cell whose
   * source samples are unchanged, which only pays off against that matcher's
   * prefilter-plus-rerank. chromatic-v1 does not read prevReduced, so honouring
   * `temporal` there would allocate a second copy of the reduced buffer and
   * blit ~2 MB per frame for nothing.
   */
  private get temporalActive(): boolean {
    return Boolean(this.opts.temporal) && this.opts.matcher !== 'chromatic'
  }
  private featuresBuf?: GPUBuffer
  private cellsBuf?: GPUBuffer
  private stagingBuf?: GPUBuffer
  private temporalPrimed = false
  /**
   * Whether the cells buffer holds a previous frame of the *current* source.
   * Hysteresis reads it as the incumbent, and unlike exact temporal reuse it
   * does not self-correct: it is biased toward whatever is already there, so a
   * stale buffer leaves the old source ghosted into wherever the new one is
   * ambiguous. Cleared on any discontinuity.
   */
  private hysteresisPrimed = false
  private lastOptsKey = ''
  private bgReduce?: GPUBindGroup
  private bgFeatures?: GPUBindGroup
  private bgMatch?: GPUBindGroup
  private bgChromatic?: GPUBindGroup
  private chromaticBuf?: GPUBuffer
  /** Backdrop the chromatic descriptors were composited against (§C3). */
  private chromaticBackdrop?: string
  private bgComposite?: GPUBindGroup

  constructor(engine: AsciiEngine, compositePipeline: GPURenderPipeline) {
    this.engine = engine
    this.pipeComposite = compositePipeline
    const d = engine.device
    this.paramsBuf = d.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.compBuf = d.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.fxBuf = d.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  grid(): { columns: number; rows: number } | null {
    return this.gridDims ?? null
  }

  colorMode(): ColorMode {
    // chromatic-v1 emits 'glyph' by definition, so the matcher decides it
    // rather than the caller having to keep the two options in step.
    if (this.opts.matcher === 'chromatic') return 'glyph'
    return this.opts.color ?? 'mono'
  }

  /**
   * Bind a source texture and match options; (re)allocates grid buffers and
   * bind groups as needed. Returns whether the grid changed.
   */
  configure(
    src: GPUTexture,
    srcW: number,
    srcH: number,
    opts: StreamMatchOptions,
  ): { gridChanged: boolean } {
    if (opts.matcher === 'chromatic' && !this.engine.pipeChromatic) {
      throw new Error(
        `Profile ${this.engine.profile.id} carries no chromatic glyph data, so color: 'glyph' has nothing ` +
          'to match against. Compile it with @ascii-fx/compiler buildChromaticProfile.',
      )
    }
    this.opts = opts
    const profile = this.engine.profile
    const grid = deriveGrid(srcW, srcH, profile, opts.columns, opts.rows)
    const blockW = Math.ceil(srcW / (grid.columns * 8)) + 1
    const blockH = Math.ceil(srcH / (grid.rows * 8)) + 1
    if (blockW * blockH > MAX_REDUCTION_BLOCK) {
      throw new Error(
        `Source ${srcW}×${srcH} reduces by more than the GPU backend's exact-arithmetic bound at ` +
          `${grid.columns}×${grid.rows} cells. Increase columns/rows or pre-scale the source.`,
      )
    }
    const gridChanged =
      !this.gridDims || grid.columns !== this.gridDims.columns || grid.rows !== this.gridDims.rows
    const srcChanged = src !== this.boundSrc
    this.boundSrc = src
    this.srcW = srcW
    this.srcH = srcH
    // Every option that feeds matching belongs in this key: it gates the
    // temporal/hysteresis reset (§21/§C5's one-frame suppression after any
    // option change). `matcher` and `temporal` in particular — without them a
    // structural→chromatic→structural flip left the snapshot primed over a
    // buffer of chromatic cell ids, and every content-stable cell kept them.
    const optsKey = JSON.stringify([
      opts.color,
      opts.alpha,
      opts.foreground,
      opts.background,
      opts.flatThreshold,
      opts.srgbEncode,
      opts.matcher,
      opts.temporal,
      opts.hysteresis,
      srcW,
      srcH,
    ])
    if (optsKey !== this.lastOptsKey || gridChanged || srcChanged) {
      this.lastOptsKey = optsKey
      this.temporalPrimed = false
      this.hysteresisPrimed = false
    }
    if (gridChanged) {
      this.gridDims = grid
      const n = grid.columns * grid.rows
      const d = this.engine.device
      this.reducedBuf?.destroy()
      this.prevReducedBuf?.destroy()
      this.prevReducedBuf = undefined
      this.featuresBuf?.destroy()
      this.cellsBuf?.destroy()
      this.stagingBuf?.destroy()
      this.reducedBuf = d.createBuffer({
        size: n * 64 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      })
      this.featuresBuf = d.createBuffer({
        size: n * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      })
      this.cellsBuf = d.createBuffer({
        size: n * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      })
      this.stagingBuf = d.createBuffer({
        size: n * 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      })
    }
    let temporalAllocated = false
    if (this.temporalActive && !this.prevReducedBuf) {
      const n = this.gridDims!.columns * this.gridDims!.rows
      this.prevReducedBuf = this.engine.device.createBuffer({
        size: n * 64 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      this.temporalPrimed = false
      this.hysteresisPrimed = false
      temporalAllocated = true
    }
    if (gridChanged || srcChanged || temporalAllocated || !this.bgReduce) this.rebuildBindGroups()
    this.syncMatchParams()
    return { gridChanged }
  }

  private rebuildBindGroups(): void {
    const d = this.engine.device
    const srcView = this.boundSrc!.createView()
    this.bgReduce = d.createBindGroup({
      layout: this.engine.pipeReduce.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: srcView },
        { binding: 2, resource: { buffer: this.reducedBuf! } },
      ],
    })
    this.bgFeatures = d.createBindGroup({
      layout: this.engine.pipeFeatures.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.reducedBuf! } },
        { binding: 2, resource: { buffer: this.featuresBuf! } },
      ],
    })
    if (this.engine.pipeChromatic) {
      this.chromaticBuf ??= d.createBuffer({
        size: this.engine.profile.glyphCount * 64 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      this.bgChromatic = d.createBindGroup({
        layout: this.engine.pipeChromatic.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuf } },
          { binding: 1, resource: { buffer: this.reducedBuf! } },
          { binding: 2, resource: { buffer: this.featuresBuf! } },
          { binding: 3, resource: { buffer: this.chromaticBuf } },
          { binding: 4, resource: { buffer: this.cellsBuf! } },
        ],
      })
    }
    this.bgMatch = d.createBindGroup({
      layout: this.engine.pipeMatch.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.reducedBuf! } },
        { binding: 2, resource: { buffer: this.featuresBuf! } },
        { binding: 3, resource: { buffer: this.engine.masksBuf } },
        { binding: 4, resource: { buffer: this.engine.coverageBuf } },
        { binding: 5, resource: { buffer: this.cellsBuf! } },
        // Aliases reduced when temporal reuse is off (read-only, so legal).
        { binding: 6, resource: { buffer: this.prevReducedBuf ?? this.reducedBuf! } },
      ],
    })
    this.bgComposite = d.createBindGroup({
      layout: this.pipeComposite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.compBuf } },
        { binding: 1, resource: { buffer: this.cellsBuf! } },
        { binding: 2, resource: this.engine.atlasTexture.createView() },
        { binding: 3, resource: this.engine.sampler },
        { binding: 4, resource: { buffer: this.fxBuf } },
        { binding: 5, resource: srcView },
        { binding: 6, resource: this.engine.atlasRgbaTexture.createView() },
      ],
    })
  }

  private syncMatchParams(baseCol = 0, baseRow = 0): void {
    const opts = this.opts
    const profile = this.engine.profile
    const color = this.colorMode()
    const fg = opts.foreground ?? [255, 255, 255]
    const bg = opts.background ?? [0, 0, 0]
    const inkLight =
      color === 'mono'
        ? luma8(fg[0], fg[1], fg[2]) >= luma8(bg[0], bg[1], bg[2])
        : luma8(bg[0], bg[1], bg[2]) < 128
    const p = this.paramsScratch
    p[0] = this.srcW
    p[1] = this.srcH
    p[2] = this.gridDims!.columns
    p[3] = this.gridDims!.rows
    p[4] = profile.glyphCount
    p[5] = COLOR_MODE_CODE[color]
    p[6] = inkLight ? 1 : 0
    p[7] = opts.flatThreshold ?? 15
    p[8] = (opts.alpha ?? 'mask') === 'mask' ? 1 : 0
    p[9] = blankGlyphId(profile)
    p[10] = pack24(fg)
    p[11] = pack24(bg)
    p[12] = opts.srgbEncode ? 1 : 0
    p[13] = baseCol
    p[14] = baseRow
    p[15] = this.temporalActive && this.temporalPrimed && this.prevReducedBuf ? 1 : 0
    // §C5 quantises the margin to a thousandth so the comparison stays integral.
    // Suppressed until the cells buffer holds a frame of this source: the
    // incumbent it would otherwise favour belongs to whatever was rendered before.
    p[16] =
      color === 'glyph' && this.hysteresisPrimed
        ? Math.round(Math.min(0.999, Math.max(0, opts.hysteresis ?? 0)) * 1000)
        : 0
    this.engine.device.queue.writeBuffer(this.paramsBuf, 0, p)
  }

  /**
   * Tier 2 of §C3: composite the glyph descriptors over the backdrop and upload
   * them. Depends only on the glyph table and the backdrop, so it is skipped
   * whenever the backdrop is unchanged — never per frame, never per cell.
   */
  private syncChromaticGlyphs(): void {
    if (!this.engine.pipeChromatic || this.opts.matcher !== 'chromatic') return
    const chromatic = this.engine.profile.chromatic
    if (!chromatic || !this.chromaticBuf) return
    const bd = this.opts.background ?? [0, 0, 0]
    const key = `${bd[0]},${bd[1]},${bd[2]}`
    if (this.chromaticBackdrop === key) return
    const g = this.engine.profile.glyphCount
    const packed = new Uint32Array(g * 64)
    const src = chromatic.samples
    for (let i = 0; i < g * 64; i++) {
      const p = i * 4
      const a = src[p + 3]
      const r = rdiv255(src[p] * a + bd[0] * (255 - a))
      const gg = rdiv255(src[p + 1] * a + bd[1] * (255 - a))
      const b = rdiv255(src[p + 2] * a + bd[2] * (255 - a))
      packed[i] = (r | (gg << 8) | (b << 16)) >>> 0
    }
    this.engine.device.queue.writeBuffer(this.chromaticBuf, 0, packed)
    this.chromaticBackdrop = key
  }

  /** Encode the exact matching passes for the full grid. */
  encodeMatch(enc: GPUCommandEncoder): void {
    this.encodeMatchRect(enc, 0, 0, this.gridDims!.columns, this.gridDims!.rows)
  }

  /** Encode matching for a cell sub-rect (dirty-region path, spec §22). */
  encodeMatchRect(
    enc: GPUCommandEncoder,
    baseCol: number,
    baseRow: number,
    cols: number,
    rows: number,
  ): void {
    if (
      baseCol !== 0 ||
      baseRow !== 0 ||
      cols !== this.gridDims!.columns ||
      rows !== this.gridDims!.rows
    ) {
      this.syncMatchParams(baseCol, baseRow)
    }
    this.syncChromaticGlyphs()
    const pass = enc.beginComputePass()
    pass.setPipeline(this.engine.pipeReduce)
    pass.setBindGroup(0, this.bgReduce!)
    pass.dispatchWorkgroups(cols, rows)
    pass.setPipeline(this.engine.pipeFeatures)
    pass.setBindGroup(0, this.bgFeatures!)
    pass.dispatchWorkgroups(cols, rows)
    if (this.opts.matcher === 'chromatic') {
      pass.setPipeline(this.engine.pipeChromatic!)
      pass.setBindGroup(0, this.bgChromatic!)
    } else {
      pass.setPipeline(this.engine.pipeMatch)
      pass.setBindGroup(0, this.bgMatch!)
    }
    pass.dispatchWorkgroups(cols, rows)
    pass.end()
    this.hysteresisPrimed = true
    if (this.temporalActive && this.prevReducedBuf) {
      enc.copyBufferToBuffer(this.reducedBuf!, 0, this.prevReducedBuf, 0, this.prevReducedBuf.size)
      this.temporalPrimed = true
    }
  }

  /** Restore full-grid params after a rect dispatch. */
  resetMatchRect(): void {
    this.syncMatchParams(0, 0)
  }

  /**
   * Declare that the next frame is not a continuation of the last one, so
   * hysteresis must not carry the previous source's glyphs into it.
   */
  resetTemporalState(): void {
    this.temporalPrimed = false
    this.hysteresisPrimed = false
  }

  syncView(view: StreamViewOptions): void {
    const { columns, rows } = this.gridDims!
    const { atlas } = this.engine.profile
    const color = this.colorMode()
    const cw = view.width
    const ch = view.height
    const gridW = columns * atlas.cellWidth
    const gridH = rows * atlas.cellHeight
    const fit = view.fit ?? 'contain'
    let sx = cw / gridW
    let sy = ch / gridH
    if (fit === 'contain') sx = sy = Math.min(sx, sy)
    else if (fit === 'cover') sx = sy = Math.max(sx, sy)
    const cellScreenW = atlas.cellWidth * sx
    const cellScreenH = atlas.cellHeight * sy
    const originX = (cw - columns * cellScreenW) / 2
    const originY = (ch - rows * cellScreenH) / 2
    const lod = Math.min(
      ATLAS_MIPS - 1,
      Math.max(
        0,
        Math.log2(Math.max(atlas.cellWidth / cellScreenW, atlas.cellHeight / cellScreenH, 1)),
      ),
    )
    // Chromatic cells are matched against a backdrop (§C3), so they must be
    // drawn over that same backdrop or the choice is un-optimised on screen.
    // color: 'foreground' keeps its transparent-canvas meaning here too,
    // mirroring the CPU backend's compositeFrame with background: null.
    const glyphTransparent = color === 'glyph' && (this.opts.color ?? 'mono') === 'foreground'
    const bd = this.opts.background ?? [0, 0, 0]
    const clear =
      view.clearColor ??
      (color === 'foreground' || glyphTransparent
        ? [0, 0, 0, 0]
        : color === 'glyph'
          ? [bd[0] / 255, bd[1] / 255, bd[2] / 255, 1]
          : [0, 0, 0, 1])

    const dv = new DataView(this.compScratch)
    const u = (i: number, v: number): void => dv.setUint32(i * 4, v, true)
    const f = (i: number, v: number): void => dv.setFloat32(i * 4, v, true)
    u(0, columns)
    u(1, rows)
    u(2, atlas.columns)
    u(3, atlas.pitchWidth)
    u(4, atlas.pitchHeight)
    u(5, atlas.padding)
    u(6, atlas.cellWidth)
    u(7, atlas.cellHeight)
    u(8, COLOR_MODE_CODE[color])
    u(9, color === 'glyph' && !glyphTransparent ? 1 : 0)
    u(10, bd[0] | (bd[1] << 8) | (bd[2] << 16))
    u(11, 0)
    f(12, atlas.width)
    f(13, atlas.height)
    f(14, originX)
    f(15, originY)
    f(16, cellScreenW)
    f(17, cellScreenH)
    f(18, lod)
    f(19, 0)
    dv.setFloat32(80, clear[0], true)
    dv.setFloat32(84, clear[1], true)
    dv.setFloat32(88, clear[2], true)
    dv.setFloat32(92, clear[3], true)
    this.engine.device.queue.writeBuffer(this.compBuf, 0, this.compScratch)
  }

  syncFx(fx: StreamFxState, canvasW: number, canvasH: number): void {
    const dv = new DataView(this.fxScratch)
    const i = fx.interaction
    const minDim = Math.min(canvasW, canvasH)
    dv.setUint32(0, i ? FX_KIND[i.type] : 0, true)
    dv.setFloat32(16, fx.pointerX, true)
    dv.setFloat32(20, fx.pointerY, true)
    dv.setFloat32(24, fx.velX, true)
    dv.setFloat32(28, fx.velY, true)
    dv.setFloat32(32, (i?.radius ?? 0.15) * minDim, true)
    dv.setFloat32(36, (i?.feather ?? 0.06) * minDim, true)
    dv.setFloat32(40, i?.intensity ?? 1, true)
    dv.setFloat32(44, fx.time, true)
    this.engine.device.queue.writeBuffer(this.fxBuf, 0, this.fxScratch)
  }

  encodeComposite(enc: GPUCommandEncoder, target: GPUTextureView): void {
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: target, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' },
      ],
    })
    pass.setPipeline(this.pipeComposite)
    pass.setBindGroup(0, this.bgComposite!)
    pass.draw(3)
    pass.end()
  }

  /** Explicit GPU→CPU readback (spec §33); never part of a render loop. */
  async captureFrame(): Promise<AsciiFrame> {
    if (!this.gridDims) throw new Error('captureFrame() requires a configured stream.')
    const { columns, rows } = this.gridDims
    const n = columns * rows
    const d = this.engine.device
    const enc = d.createCommandEncoder()
    enc.copyBufferToBuffer(this.cellsBuf!, 0, this.stagingBuf!, 0, n * 16)
    d.queue.submit([enc.finish()])
    await this.stagingBuf!.mapAsync(GPUMapMode.READ)
    const words = new Uint32Array(this.stagingBuf!.getMappedRange())
    const color = this.colorMode()
    const glyphIds = new Uint16Array(n)
    const flags = new Uint16Array(n)
    // 'glyph' is colourless on the wire for the same reason 'mono' is: the
    // colour is not per cell. Reading planes here would surface the zeros the
    // chromatic shader leaves behind as if they were fitted colours.
    const needFg = color !== 'mono' && color !== 'glyph'
    const needBg = color === 'full'
    const fg = needFg ? new Uint32Array(n) : undefined
    const bg = needBg ? new Uint32Array(n) : undefined
    for (let i = 0; i < n; i++) {
      const w0 = words[i * 4]
      glyphIds[i] = w0 & 0xffff
      const fl = w0 >>> 16
      flags[i] = fl
      const transparent = (fl & FLAG_TRANSPARENT) !== 0
      if (needFg) fg![i] = transparent ? 0 : ((words[i * 4 + 1] & 0xffffff) | 0xff000000) >>> 0
      if (needBg) bg![i] = transparent ? 0 : ((words[i * 4 + 2] & 0xffffff) | 0xff000000) >>> 0
    }
    this.stagingBuf!.unmap()
    return new AsciiFrame({
      columns,
      rows,
      colorMode: color,
      glyphIds,
      foreground: fg,
      background: bg,
      flags,
      profile: this.engine.profile,
    })
  }

  destroy(): void {
    this.reducedBuf?.destroy()
    this.prevReducedBuf?.destroy()
    this.featuresBuf?.destroy()
    this.cellsBuf?.destroy()
    this.stagingBuf?.destroy()
    this.paramsBuf.destroy()
    this.chromaticBuf?.destroy()
    this.compBuf.destroy()
    this.fxBuf.destroy()
  }
}
