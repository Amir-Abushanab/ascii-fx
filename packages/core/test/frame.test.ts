import { describe, expect, it } from 'vitest'
import { compositeFrame, matchFrame } from '@ascii-fx/core'
import { STANDARD_SIX, makeCell, makeProfile } from './synthetic.js'

const profile = makeProfile(STANDARD_SIX)
const topDark = makeCell((_, j) => (j < 4 ? [0, 0, 0] : [255, 255, 255]))

describe('AsciiFrame exports', () => {
  it('toText renders glyph rows', () => {
    const frame = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'mono' })
    expect(frame.toText()).toBe('▄')
  })

  it('toAnsi emits truecolor codes in full mode and resets per line', () => {
    const frame = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'full' })
    const ansi = frame.toAnsi()
    expect(ansi).toContain('\x1b[38;2;0;0;0m')
    expect(ansi).toContain('\x1b[48;2;255;255;255m')
    expect(ansi.endsWith('\x1b[0m')).toBe(true)
  })

  it('toAnsi in mono is plain text', () => {
    const frame = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'mono' })
    expect(frame.toAnsi()).toBe('▄')
  })

  it('toHTML wraps in pre and escapes markup', () => {
    const mono = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'mono' })
    expect(mono.toHTML()).toBe('<pre class="ascii-fx">▄</pre>')
    const full = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'full' })
    expect(full.toHTML()).toContain('<span style="color:#000000;background:#ffffff">▀</span>')
  })

  it('getCell bounds-checks', () => {
    const frame = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'mono' })
    expect(() => frame.getCell(1, 0)).toThrow(RangeError)
  })

  it('compositeFrame reproduces an exact half-split cell in full mode', () => {
    const frame = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'full' })
    const img = compositeFrame(frame)
    expect(img.width).toBe(8)
    expect(img.height).toBe(8)
    // '▀' with fg black over bg white: top rows black, bottom rows white.
    expect(Array.from(img.data.slice(0, 4))).toEqual([0, 0, 0, 255])
    const last = (8 * 7 + 7) * 4
    expect(Array.from(img.data.slice(last, last + 4))).toEqual([255, 255, 255, 255])
  })
})
