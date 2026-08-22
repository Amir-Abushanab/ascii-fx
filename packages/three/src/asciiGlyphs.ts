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
import { FLAG_TRANSPARENT, blankGlyphId, unpackB, unpackG, unpackR } from '@ascii-fx/core'

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
  private readonly aVisible: InstancedBufferAttribute
  private readonly aUseBackground: InstancedBufferAttribute
  private readonly atlasTexture: DataTexture
  private readonly profileFingerprint: string
  private readonly glyphCount: number
  private readonly blankGlyph: number

  constructor(options: AsciiGlyphsOptions) {
    const { profile, columns, rows } = options
    const cellSize = options.cellSize ?? 1
    this.columns = columns
    this.rows = rows
    this.profileFingerprint = profile.fingerprint
    this.glyphCount = profile.glyphCount
    this.blankGlyph = blankGlyphId(profile)
    const { atlas } = profile
    const aspect = atlas.cellWidth / atlas.cellHeight
    const count = columns * rows

    const geometry = new PlaneGeometry(cellSize * aspect, cellSize)
    this.aGlyph = new InstancedBufferAttribute(new Float32Array(count), 1)
    this.aFg = new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3)
    this.aBg = new InstancedBufferAttribute(new Float32Array(count * 3), 3)
    this.aVisible = new InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
    this.aUseBackground = new InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
    geometry.setAttribute('aGlyph', this.aGlyph)
    geometry.setAttribute('aFg', this.aFg)
    geometry.setAttribute('aBg', this.aBg)
    geometry.setAttribute('aVisible', this.aVisible)
    geometry.setAttribute('aUseBackground', this.aUseBackground)

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
    const n = {
      add,
      attribute,
      div,
      float,
      floor,
      mix,
      mod,
      mul,
      texture,
      uv,
      vec2,
    } as unknown as Record<
      | 'add'
      | 'attribute'
      | 'div'
      | 'float'
      | 'floor'
      | 'mix'
      | 'mod'
      | 'mul'
      | 'texture'
      | 'uv'
      | 'vec2',
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
    const foreground = n.attribute('aFg')
    const useBackground = n.attribute('aUseBackground')
    const cellColor = n.mix(n.attribute('aBg'), foreground, alpha)
    this.material.colorNode = n.mix(foreground, cellColor, useBackground)
    this.material.opacityNode = n.mul(
      n.attribute('aVisible'),
      n.mix(alpha, n.float(1), useBackground),
    )
    this.material.transparent = true
    this.material.depthWrite = false

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
    if (frame.profile.fingerprint !== this.profileFingerprint) {
      throw new Error(
        `Frame profile "${frame.profile.id}" (${frame.profile.fingerprint.slice(0, 12)}…) does not match ` +
          `AsciiGlyphs profile (${this.profileFingerprint.slice(0, 12)}…).`,
      )
    }
    if (frame.columns !== this.columns || frame.rows !== this.rows) {
      throw new Error(
        `Frame grid ${frame.columns}×${frame.rows} does not match AsciiGlyphs grid ${this.columns}×${this.rows}.`,
      )
    }
    const n = this.columns * this.rows
    const g = this.aGlyph.array as Float32Array
    const fg = this.aFg.array as Float32Array
    const bg = this.aBg.array as Float32Array
    const visible = this.aVisible.array as Float32Array
    const useBackground = this.aUseBackground.array as Float32Array
    for (let i = 0; i < n; i++) {
      const transparent = (frame.flags[i] & FLAG_TRANSPARENT) !== 0
      const glyphId = frame.glyphIds[i]
      if (glyphId >= this.glyphCount) {
        throw new Error(
          `Frame cell ${i} references glyph ${glyphId}, but the profile has ${this.glyphCount} glyphs.`,
        )
      }
      g[i] = transparent ? this.blankGlyph : glyphId
      visible[i] = transparent ? 0 : 1
      useBackground[i] = frame.colorMode === 'foreground' ? 0 : 1
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
    this.aVisible.needsUpdate = true
    this.aUseBackground.needsUpdate = true
  }

  dispose(): void {
    // The mesh's own dispose releases its instanced attributes (instanceMatrix et al.);
    // without it their GPU buffers wait on backend WeakMap GC.
    this.mesh.dispose()
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.atlasTexture.dispose()
  }
}
