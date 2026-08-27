import type { AsciiFrame, AsciiProfile, ColorMode, RGB } from '@ascii-fx/core'
import { COMPOSITE_FRAG_GLSL, COMPOSITE_VERT_GLSL } from './glShaders.js'

const COLOR_MODE_CODE: Record<ColorMode, number> = { mono: 0, foreground: 1, full: 2, glyph: 3 }

/** Same codes the WGSL compositor uses, so one shader body serves both. */
export const GL_FX_KIND: Record<string, number> = {
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

/** Atlas mip count, exported so callers derive `lod` against the same ceiling. */
export const GL_ATLAS_MIPS = 4

const pack24 = (rgb: RGB): number =>
  (rgb[0] & 0xff) | ((rgb[1] & 0xff) << 8) | ((rgb[2] & 0xff) << 16)

/** Everything the composite needs that is not the frame itself. */
export interface GlViewParams {
  canvasWidth: number
  canvasHeight: number
  colorMode: ColorMode
  originX: number
  originY: number
  cellScreenW: number
  cellScreenH: number
  lod: number
  useBackdrop: boolean
  backdrop: RGB
  clearColor: readonly [number, number, number, number]
  /** mono has no per-cell colour planes; these fill in for them. */
  foreground: RGB
  background: RGB
}

export interface GlFxParams {
  kind: number
  pointerX: number
  pointerY: number
  radiusPx: number
  featherPx: number
  intensity: number
  time: number
  /** Only reveal (1) and original-mix (8) sample it. */
  source?: TexImageSource
}

const UNIFORMS = [
  'uCells',
  'uAtlas',
  'uAtlasRgba',
  'uSrc',
  'uGrid',
  'uAtlasLayout',
  'uCell',
  'uColorMode',
  'uUseBackdrop',
  'uBackdrop',
  'uAtlasSize',
  'uOrigin',
  'uCellScreen',
  'uLod',
  'uClearColor',
  'uCanvas',
  'uFxKind',
  'uFxPointer',
  'uFxRadius',
  'uFxFeather',
  'uFxIntensity',
  'uFxTime',
] as const

type UniformName = (typeof UNIFORMS)[number]

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`ASCII FX composite shader failed to compile: ${log}`)
  }
  return shader
}

/**
 * WebGL2 compositor for the CPU backend (spec §12: "CPU/Worker structural
 * matcher → compact glyph field → WebGL2 fullscreen composite").
 *
 * It runs the same compositor the WebGPU backend runs — one fullscreen draw
 * that reads the glyph field and the atlas — instead of building a
 * full-resolution RGBA buffer on the CPU and blitting it. That also makes the
 * interactions the real shader rather than the Canvas2D path's cell-granular
 * approximation of it.
 */
export class GlCompositor {
  readonly kind = 'webgl2' as const
  private gl: WebGL2RenderingContext
  private program!: WebGLProgram
  private loc = new Map<UniformName, WebGLUniformLocation | null>()
  private vao!: WebGLVertexArrayObject
  private atlasTex!: WebGLTexture
  private atlasRgbaTex!: WebGLTexture
  private cellsTex!: WebGLTexture
  private srcTex!: WebGLTexture
  private cellData?: Uint32Array
  private cellDims = { columns: 0, rows: 0 }
  private lost = false
  private destroyed = false

  private constructor(
    gl: WebGL2RenderingContext,
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    private readonly profile: AsciiProfile,
  ) {
    this.gl = gl
    this.build()
    if ('addEventListener' in canvas) {
      // Default-prevented so the browser will try to restore rather than leave
      // a dead context: without this the fallback silently stops painting.
      canvas.addEventListener('webglcontextlost', this.onLost)
      canvas.addEventListener('webglcontextrestored', this.onRestored)
    }
  }

  /**
   * Acquire a WebGL2 context on `canvas` and build the pipeline, or return
   * undefined where that is not possible — the caller then composites on
   * Canvas2D, which is slower and produces the same picture.
   */
  static tryCreate(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    profile: AsciiProfile,
  ): GlCompositor | undefined {
    let gl: WebGL2RenderingContext | null = null
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        // Kept so the canvas can be read back after the frame it was drawn in
        // — canvas.toBlob(), drawImage(canvas, …), and any screenshot see a
        // cleared buffer otherwise, which reads as "the fallback renders
        // nothing" rather than as a timing rule.
        preserveDrawingBuffer: true,
      }) as WebGL2RenderingContext | null
    } catch {
      return undefined
    }
    if (!gl) return undefined
    try {
      return new GlCompositor(gl, canvas, profile)
    } catch {
      return undefined
    }
  }

  private onLost = (event: Event): void => {
    event.preventDefault()
    this.lost = true
  }

  private onRestored = (): void => {
    if (this.destroyed) return
    const gl = this.canvas.getContext('webgl2') as WebGL2RenderingContext | null
    if (!gl) return
    this.gl = gl
    this.cellDims = { columns: 0, rows: 0 }
    try {
      this.build()
      this.lost = false
    } catch {
      this.lost = true
    }
  }

  /** True when the context is gone and present() would paint nothing. */
  get unavailable(): boolean {
    return this.lost || this.destroyed || this.gl.isContextLost()
  }

  private build(): void {
    const gl = this.gl
    const vs = compile(gl, gl.VERTEX_SHADER, COMPOSITE_VERT_GLSL)
    const fs = compile(gl, gl.FRAGMENT_SHADER, COMPOSITE_FRAG_GLSL)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`ASCII FX composite program failed to link: ${log}`)
    }
    this.program = program
    this.loc.clear()
    for (const name of UNIFORMS) this.loc.set(name, gl.getUniformLocation(program, name))
    this.vao = gl.createVertexArray()!

    const { atlas } = this.profile
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    // R8 coverage atlas, mipped so `lod` minification matches the WebGPU path.
    this.atlasTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    gl.texStorage2D(gl.TEXTURE_2D, GL_ATLAS_MIPS, gl.R8, atlas.width, atlas.height)
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      atlas.width,
      atlas.height,
      gl.RED,
      gl.UNSIGNED_BYTE,
      atlas.data,
    )
    gl.generateMipmap(gl.TEXTURE_2D)
    this.setSampling(gl.LINEAR_MIPMAP_LINEAR)

    // RGBA atlas: real for chromatic profiles, a 1×1 stand-in otherwise, since
    // the sampler has to be bound either way.
    this.atlasRgbaTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.atlasRgbaTex)
    if (atlas.rgba) {
      gl.texStorage2D(gl.TEXTURE_2D, GL_ATLAS_MIPS, gl.RGBA8, atlas.width, atlas.height)
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        atlas.width,
        atlas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        atlas.rgba,
      )
      gl.generateMipmap(gl.TEXTURE_2D)
      this.setSampling(gl.LINEAR_MIPMAP_LINEAR)
    } else {
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
      this.setSampling(gl.LINEAR)
    }

    // Glyph field. Integer textures cannot be filtered.
    this.cellsTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.cellsTex)
    this.setSampling(gl.NEAREST)

    this.srcTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    this.setSampling(gl.LINEAR)

    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
  }

  private setSampling(filter: number): void {
    const gl = this.gl
    const min = filter
    const mag = filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /**
   * Pack the frame into the RGBA32UI layout the shader reads: x = glyph id with
   * flags in the high half, y = foreground, z = background. Same layout the
   * WebGPU matcher writes, so the shader is unchanged between backends.
   */
  private uploadCells(frame: AsciiFrame, view: GlViewParams): void {
    const gl = this.gl
    const { columns, rows } = frame
    const n = columns * rows
    if (!this.cellData || this.cellData.length !== n * 4) this.cellData = new Uint32Array(n * 4)
    const out = this.cellData
    const monoFg = pack24(view.foreground)
    const monoBg = pack24(view.background)
    const fg = frame.foreground
    const bg = frame.background
    for (let i = 0; i < n; i++) {
      const o = i * 4
      out[o] = frame.glyphIds[i] | (frame.flags[i] << 16)
      out[o + 1] = fg ? fg[i] & 0xffffff : monoFg
      out[o + 2] = bg ? bg[i] & 0xffffff : monoBg
      out[o + 3] = 0
    }
    gl.bindTexture(gl.TEXTURE_2D, this.cellsTex)
    if (this.cellDims.columns !== columns || this.cellDims.rows !== rows) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32UI,
        columns,
        rows,
        0,
        gl.RGBA_INTEGER,
        gl.UNSIGNED_INT,
        out,
      )
      this.cellDims = { columns, rows }
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, columns, rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out)
    }
  }

  present(frame: AsciiFrame, view: GlViewParams, fx: GlFxParams): void {
    if (this.unavailable) return
    const gl = this.gl
    const { atlas } = this.profile
    const u = (name: UniformName): WebGLUniformLocation | null => this.loc.get(name) ?? null

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.viewport(0, 0, view.canvasWidth, view.canvasHeight)

    this.uploadCells(frame, view)

    if (fx.source && (fx.kind === 1 || fx.kind === 8)) {
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fx.source)
    }

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.cellsTex)
    gl.uniform1i(u('uCells'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    gl.uniform1i(u('uAtlas'), 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.atlasRgbaTex)
    gl.uniform1i(u('uAtlasRgba'), 2)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.uniform1i(u('uSrc'), 3)

    gl.uniform2ui(u('uGrid'), frame.columns, frame.rows)
    gl.uniform4ui(
      u('uAtlasLayout'),
      atlas.columns,
      atlas.pitchWidth,
      atlas.pitchHeight,
      atlas.padding,
    )
    gl.uniform2ui(u('uCell'), atlas.cellWidth, atlas.cellHeight)
    gl.uniform1ui(u('uColorMode'), COLOR_MODE_CODE[view.colorMode])
    gl.uniform1ui(u('uUseBackdrop'), view.useBackdrop ? 1 : 0)
    gl.uniform1ui(u('uBackdrop'), pack24(view.backdrop))
    gl.uniform2f(u('uAtlasSize'), atlas.width, atlas.height)
    gl.uniform2f(u('uOrigin'), view.originX, view.originY)
    gl.uniform2f(u('uCellScreen'), view.cellScreenW, view.cellScreenH)
    gl.uniform1f(u('uLod'), view.lod)
    gl.uniform4f(
      u('uClearColor'),
      view.clearColor[0],
      view.clearColor[1],
      view.clearColor[2],
      view.clearColor[3],
    )
    gl.uniform2f(u('uCanvas'), view.canvasWidth, view.canvasHeight)

    gl.uniform1ui(u('uFxKind'), fx.kind)
    gl.uniform2f(u('uFxPointer'), fx.pointerX, fx.pointerY)
    gl.uniform1f(u('uFxRadius'), fx.radiusPx)
    gl.uniform1f(u('uFxFeather'), fx.featherPx)
    gl.uniform1f(u('uFxIntensity'), fx.intensity)
    gl.uniform1f(u('uFxTime'), fx.time)

    // Every pixel is written by the triangle — including the letterbox, which
    // the shader returns clearColor for — so there is nothing to clear first.
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  destroy(): void {
    this.destroyed = true
    if ('removeEventListener' in this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onLost)
      this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    }
    const gl = this.gl
    if (gl.isContextLost()) return
    gl.deleteTexture(this.atlasTex)
    gl.deleteTexture(this.atlasRgbaTex)
    gl.deleteTexture(this.cellsTex)
    gl.deleteTexture(this.srcTex)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
  }
}
