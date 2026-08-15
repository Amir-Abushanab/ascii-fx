import {
  DataTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  PlaneGeometry,
  RedFormat,
  UnsignedByteType,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { add, attribute, div, float, floor, mix, mod, mul, texture, uv, vec2 } from 'three/tsl'
import type { AsciiFrame, AsciiProfile } from '@ascii-fx/core'
import { FLAG_TRANSPARENT, unpackB, unpackG, unpackR } from '@ascii-fx/core'

export interface AsciiGlyphsOptions {
  profile: AsciiProfile
  columns: number
  rows: number
  /** World-space cell height. Default 1. */
  cellSize?: number
}

/**
 * Instanced 3D glyph renderer (spec §8 'instances', §30): one plane instance
 * per cell, glyph/colors as instanced attributes, atlas sampled via TSL.
 * Instance transforms live in the standard instanceMatrix so effects can
 * animate them (GPU-side via node materials, or CPU-side via setMatrixAt).
 *
 * v1 data path: populate from a captured AsciiFrame (`updateFromFrame`).
 * A zero-readback bridge from the GPU cell buffer is a planned optimization.
 */
export class AsciiGlyphs {
  readonly mesh: InstancedMesh
  readonly material: MeshBasicNodeMaterial
  readonly columns: number
  readonly rows: number

  private readonly aGlyph: InstancedBufferAttribute
  private readonly aFg: InstancedBufferAttribute
  private readonly aBg: InstancedBufferAttribute
  private readonly atlasTexture: DataTexture

  constructor(options: AsciiGlyphsOptions) {
    const { profile, columns, rows } = options
    const cellSize = options.cellSize ?? 1
    this.columns = columns
    this.rows = rows
    const { atlas } = profile
    const aspect = atlas.cellWidth / atlas.cellHeight
    const count = columns * rows

    const geometry = new PlaneGeometry(cellSize * aspect, cellSize)
    this.aGlyph = new InstancedBufferAttribute(new Float32Array(count), 1)
    this.aFg = new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3)
    this.aBg = new InstancedBufferAttribute(new Float32Array(count * 3), 3)
    geometry.setAttribute('aGlyph', this.aGlyph)
    geometry.setAttribute('aFg', this.aFg)
    geometry.setAttribute('aBg', this.aBg)

    this.atlasTexture = new DataTexture(
      atlas.data as Uint8Array<ArrayBuffer>,
      atlas.width,
      atlas.height,
      RedFormat,
      UnsignedByteType,
    )
    this.atlasTexture.flipY = false
    this.atlasTexture.magFilter = LinearFilter
    this.atlasTexture.minFilter = LinearMipmapLinearFilter
    this.atlasTexture.generateMipmaps = true
    this.atlasTexture.needsUpdate = true

    this.material = new MeshBasicNodeMaterial()
    // @types/three cannot yet type composed TSL node graphs; the runtime API
    // is stable, so the graph is built through a single contained cast.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const n = { add, attribute, div, float, floor, mix, mod, mul, texture, uv, vec2 } as unknown as Record<
      'add' | 'attribute' | 'div' | 'float' | 'floor' | 'mix' | 'mod' | 'mul' | 'texture' | 'uv' | 'vec2',
      (...args: any[]) => any
    >
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const id = n.attribute('aGlyph')
    const col = n.mod(id, n.float(atlas.columns))
    const row = n.floor(n.div(id, n.float(atlas.columns)))
    const tile = n.vec2(
      n.add(n.mul(col, n.float(atlas.pitchWidth)), n.float(atlas.padding)),
      n.add(n.mul(row, n.float(atlas.pitchHeight)), n.float(atlas.padding)),
    )
    // PlaneGeometry uv has v=0 at the bottom; the atlas is y-down: flip v.
    const guv = n.add(n.mul(n.uv(), n.vec2(1, -1)), n.vec2(0, 1))
    const texel = n.add(tile, n.mul(guv, n.vec2(atlas.cellWidth, atlas.cellHeight)))
    const auv = n.div(texel, n.vec2(atlas.width, atlas.height))
    const alpha = n.texture(this.atlasTexture, auv).r
    this.material.colorNode = n.mix(n.attribute('aBg'), n.attribute('aFg'), alpha)

    this.mesh = new InstancedMesh(geometry, this.material, count)
    this.mesh.frustumCulled = false
    const m = new Matrix4()
    const cw = cellSize * aspect
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < columns; cx++) {
        m.makeTranslation((cx - (columns - 1) / 2) * cw, ((rows - 1) / 2 - cy) * cellSize, 0)
        this.mesh.setMatrixAt(cy * columns + cx, m)
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /** Load glyph ids and colors from a matched frame (same grid dimensions). */
  updateFromFrame(frame: AsciiFrame): void {
    if (frame.columns !== this.columns || frame.rows !== this.rows) {
      throw new Error(
        `Frame grid ${frame.columns}×${frame.rows} does not match AsciiGlyphs grid ${this.columns}×${this.rows}.`,
      )
    }
    const n = this.columns * this.rows
    const g = this.aGlyph.array as Float32Array
    const fg = this.aFg.array as Float32Array
    const bg = this.aBg.array as Float32Array
    for (let i = 0; i < n; i++) {
      const transparent = (frame.flags[i] & FLAG_TRANSPARENT) !== 0
      g[i] = transparent ? 0 : frame.glyphIds[i]
      const fgc = frame.foreground?.[i]
      const bgc = frame.background?.[i]
      fg[i * 3] = fgc !== undefined ? unpackR(fgc) / 255 : 1
      fg[i * 3 + 1] = fgc !== undefined ? unpackG(fgc) / 255 : 1
      fg[i * 3 + 2] = fgc !== undefined ? unpackB(fgc) / 255 : 1
      bg[i * 3] = bgc !== undefined ? unpackR(bgc) / 255 : 0
      bg[i * 3 + 1] = bgc !== undefined ? unpackG(bgc) / 255 : 0
      bg[i * 3 + 2] = bgc !== undefined ? unpackB(bgc) / 255 : 0
    }
    this.aGlyph.needsUpdate = true
    this.aFg.needsUpdate = true
    this.aBg.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.atlasTexture.dispose()
  }
}
