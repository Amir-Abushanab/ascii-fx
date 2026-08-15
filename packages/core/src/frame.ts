import type { AsciiProfile, CellInfo, ColorMode } from './types.js'
import { FLAG_TRANSPARENT } from './types.js'
import { rgbHex, unpackA, unpackB, unpackG, unpackR } from './color.js'

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

const escapeHtml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

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
    const unpack = (c: number): [number, number, number, number] => [
      unpackR(c),
      unpackG(c),
      unpackB(c),
      unpackA(c),
    ]
    return {
      glyph: this.profile.glyphs[id],
      glyphId: id,
      foreground: this.foreground ? unpack(this.foreground[i]) : null,
      background: this.background ? unpack(this.background[i]) : null,
      flags: this.flags[i],
    }
  }

  toText(): string {
    const { glyphs } = this.profile
    const lines: string[] = []
    for (let y = 0; y < this.rows; y++) {
      let line = ''
      for (let x = 0; x < this.columns; x++) {
        const i = y * this.columns + x
        line += this.flags[i] & FLAG_TRANSPARENT ? ' ' : glyphs[this.glyphIds[i]]
      }
      lines.push(line)
    }
    return lines.join('\n')
  }

  toAnsi(): string {
    if (this.colorMode === 'mono' || !this.foreground) return this.toText()
    const { glyphs } = this.profile
    const useBg = this.colorMode === 'full' && this.background !== undefined
    let out = ''
    for (let y = 0; y < this.rows; y++) {
      let lastFg = -1
      let lastBg = -1
      for (let x = 0; x < this.columns; x++) {
        const i = y * this.columns + x
        if (this.flags[i] & FLAG_TRANSPARENT) {
          if (lastFg !== -1 || lastBg !== -1) {
            out += '\x1b[0m'
            lastFg = -1
            lastBg = -1
          }
          out += ' '
          continue
        }
        const fg = this.foreground[i]
        if (fg !== lastFg) {
          out += `\x1b[38;2;${fg & 0xff};${(fg >>> 8) & 0xff};${(fg >>> 16) & 0xff}m`
          lastFg = fg
        }
        if (useBg) {
          const bg = this.background![i]
          if (bg !== lastBg) {
            out += `\x1b[48;2;${bg & 0xff};${(bg >>> 8) & 0xff};${(bg >>> 16) & 0xff}m`
            lastBg = bg
          }
        }
        out += glyphs[this.glyphIds[i]]
      }
      out += '\x1b[0m'
      if (y < this.rows - 1) out += '\n'
    }
    return out
  }

  toHTML(): string {
    const { glyphs } = this.profile
    if (this.colorMode === 'mono' || !this.foreground) {
      return `<pre class="ascii-fx">${escapeHtml(this.toText())}</pre>`
    }
    const useBg = this.colorMode === 'full' && this.background !== undefined
    let out = '<pre class="ascii-fx">'
    for (let y = 0; y < this.rows; y++) {
      let run = ''
      let runFg = -1
      let runBg = -1
      const flush = (): void => {
        if (run === '') return
        if (runFg === -1) {
          out += escapeHtml(run)
        } else {
          const bgStyle = useBg ? `;background:${rgbHex(runBg)}` : ''
          out += `<span style="color:${rgbHex(runFg)}${bgStyle}">${escapeHtml(run)}</span>`
        }
        run = ''
      }
      for (let x = 0; x < this.columns; x++) {
        const i = y * this.columns + x
        const transparent = (this.flags[i] & FLAG_TRANSPARENT) !== 0
        const fg = transparent ? -1 : this.foreground[i]
        const bg = transparent ? -1 : useBg ? this.background![i] : -1
        if (fg !== runFg || bg !== runBg) {
          flush()
          runFg = fg
          runBg = bg
        }
        run += transparent ? ' ' : glyphs[this.glyphIds[i]]
      }
      flush()
      if (y < this.rows - 1) out += '\n'
    }
    out += '</pre>'
    return out
  }
}
