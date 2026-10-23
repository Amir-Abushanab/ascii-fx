import { describe, expect, it } from 'vitest'
import {
  AsciiFrame,
  FLAG_TRANSPARENT,
  compositeFrame,
  frameToAnsi,
  frameToHTML,
  frameToSVG,
  frameToText,
  matchFrame,
} from '@ascii-fx/core'
import { STANDARD_SIX, makeCell, makeProfile } from './synthetic.js'

const profile = makeProfile(STANDARD_SIX)
const topDark = makeCell((_, j) => (j < 4 ? [0, 0, 0] : [255, 255, 255]))

describe('AsciiFrame exports', () => {
  it('toText renders glyph rows', () => {
    const frame = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'mono' })
    expect(frameToText(frame)).toBe('▄')
  })

  it('toAnsi emits truecolor codes in full mode and resets per line', () => {
    const frame = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'full' })
    const ansi = frameToAnsi(frame)
    expect(ansi).toContain('\x1b[38;2;0;0;0m')
    expect(ansi).toContain('\x1b[48;2;255;255;255m')
    expect(ansi.endsWith('\x1b[0m')).toBe(true)
  })

  it('toAnsi in mono is plain text', () => {
    const frame = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'mono' })
    expect(frameToAnsi(frame)).toBe('▄')
  })

  it('toHTML wraps in pre and escapes markup', () => {
    const mono = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'mono' })
    expect(frameToHTML(mono)).toBe('<pre class="ascii-fx">▄</pre>')
    const full = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'full' })
    expect(frameToHTML(full)).toContain('<span style="color:#000000;background:#ffffff">▀</span>')
  })

  it('toSVG places every glyph on the grid and escapes markup', () => {
    const full = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'full' })
    const svg = frameToSVG(full, { cellHeight: 10 })
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('<rect x="0" y="0" width="10" height="10" fill="#ffffff"/>')
    expect(svg).toMatch(/<text x="0" y="[\d.]+" fill="#000000">▀<\/text>/)
    const mono = matchFrame(topDark, { profile, columns: 1, rows: 1, color: 'mono' })
    const monoSvg = frameToSVG(mono, { background: null, foreground: [255, 0, 0] })
    expect(monoSvg).not.toContain('<rect')
    expect(monoSvg).toContain('fill="#ff0000"')
  })

  it('toSVG skips blank cells instead of emitting them', () => {
    const blank = matchFrame(
      makeCell(() => [0, 0, 0]),
      { profile, columns: 1, rows: 1, color: 'mono' },
    )
    expect(frameToSVG(blank)).not.toContain('<text')
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

// Two-glyph profiles where glyph 1 is the ink: a frame of every cell on glyph 1, one cell clear.
const frameOf = (glyphs: string[]): AsciiFrame => {
  const p = { ...makeProfile(STANDARD_SIX.slice(0, 2)), glyphs }
  return new AsciiFrame({
    columns: 3,
    rows: 1,
    colorMode: 'mono',
    glyphIds: new Uint16Array([1, 0, 1]),
    flags: new Uint16Array([0, 0, FLAG_TRANSPARENT]),
    profile: p,
  })
}

describe('text exports of non-Latin sets', () => {
  it('Latin output is unchanged: no bidi controls, half-width blanks', () => {
    expect(frameToText(frameOf([' ', '#']))).toBe('#  ')
  })

  it('forces right-to-left rows into cell order', () => {
    const frame = frameOf([' ', 'ب'])
    expect(frameToText(frame)).toBe('‭ب  ‬')
    expect(frameToHTML(frame)).toBe(
      '<pre class="ascii-fx" dir="ltr" style="unicode-bidi:bidi-override">ب  </pre>',
    )
    expect(frameToSVG(frame)).toContain('direction="ltr" unicode-bidi="bidi-override"')
  })

  it('writes blank cells of a full-width set as U+3000, so columns stay aligned', () => {
    expect(frameToText(frameOf([' ', '漢']))).toBe('漢　　')
  })
})
