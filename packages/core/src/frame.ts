import type { AsciiProfile, CellInfo, ColorMode } from './types.js'
import { unpackA, unpackB, unpackG, unpackR } from './color.js'

export interface AsciiFrameInit {
  columns: number
  rows: number
  colorMode: ColorMode
  glyphIds: Uint16Array
  foreground?: Uint32Array
  background?: Uint32Array
  flags?: Uint16Array
  profile: AsciiProfile
}

const unpackRGBA = (c: number): [number, number, number, number] => [
  unpackR(c),
  unpackG(c),
  unpackB(c),
  unpackA(c),
]

export class AsciiFrame {
  readonly columns: number
  readonly rows: number
  readonly colorMode: ColorMode
  readonly glyphIds: Uint16Array
  readonly foreground?: Uint32Array
  readonly background?: Uint32Array
  readonly flags: Uint16Array
  readonly profile: AsciiProfile

  constructor(init: AsciiFrameInit) {
    this.columns = init.columns
    this.rows = init.rows
    this.colorMode = init.colorMode
    this.glyphIds = init.glyphIds
    this.foreground = init.foreground
    this.background = init.background
    this.flags = init.flags ?? new Uint16Array(init.columns * init.rows)
    this.profile = init.profile
  }

  getCell(x: number, y: number): CellInfo {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) {
      throw new RangeError(`Cell (${x}, ${y}) is outside the ${this.columns}×${this.rows} grid.`)
    }
    const i = y * this.columns + x
    const id = this.glyphIds[i]
    return {
      glyph: this.profile.glyphs[id],
      glyphId: id,
      foreground: this.foreground ? unpackRGBA(this.foreground[i]) : null,
      background: this.background ? unpackRGBA(this.background[i]) : null,
      flags: this.flags[i],
    }
  }
}
