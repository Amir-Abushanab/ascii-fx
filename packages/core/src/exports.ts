// Text, ANSI, HTML and SVG renderings of a frame. Standalone functions rather than AsciiFrame
// methods so that each one is tree-shaken on its own: a bundler drops an unused export, but never an
// unused method, since it cannot prove nothing reaches it through the prototype.
import type { AsciiProfile, RGB } from './types.js'
import { FLAG_TRANSPARENT } from './types.js'
import { rgbHex } from './color.js'
import type { AsciiFrame } from './frame.js'

export interface SvgExportOptions {
  /** Height of one cell in SVG user units. Default 16; width follows the profile's cell aspect. */
  cellHeight?: number
  /** CSS font-family. Default the profile's family, falling back to monospace. */
  fontFamily?: string
  /** mono only: glyph colour. Default white. */
  foreground?: RGB
  /**
   * The ground behind the grid. Default black for mono, none for foreground. `null` leaves the SVG
   * transparent. full has its own per-cell background and ignores this.
   */
  background?: RGB | null
}

const escapeHtml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Trim an SVG coordinate to what a viewer can resolve, without trailing zeros. */
const num = (v: number): string => String(Math.round(v * 100) / 100)

const rgbCss = (c: readonly [number, number, number]): string =>
  `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, '0')}`

// Scripts written right to left. A viewer that applies the bidi algorithm reverses runs of
// these, which turns a row of glyph art into a different picture.
const RTL =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}]/u

// Glyphs a terminal or editor gives two columns (East Asian Wide and Fullwidth), by script and by
// the CJK symbol and fullwidth-form blocks. Not the whole East_Asian_Width property, which a
// regex cannot name, but the sets people build from CJK fonts.
const WIDE =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u3000-\u303f\u30a0-\u30ff\uff01-\uff60\uffe0-\uffe6]/u

/** U+0020 is one column wide; a set whose glyphs are all two columns needs U+3000 as its blank. */
const IDEOGRAPHIC_SPACE = '\u3000'

interface TextGlyphs {
  /** The profile's glyphs as they go into text, with a full-width blank where the set is wide. */
  glyphs: readonly string[]
  /** What a transparent cell is written as. */
  blank: string
  /** Whether rows need forcing left to right. */
  rtl: boolean
}

const textGlyphsCache = new WeakMap<AsciiProfile, TextGlyphs>()

/**
 * How a profile's glyphs are written into text. Two things a viewer does to text would otherwise
 * break the grid: lay a full-width set's half-width spaces out at half a cell, and reorder
 * right-to-left runs. Exports of a Latin set are byte-for-byte what they were.
 */
function textGlyphs(profile: AsciiProfile): TextGlyphs {
  let t = textGlyphsCache.get(profile)
  if (!t) {
    const inked = profile.glyphs.filter((g) => g.trim() !== '')
    const wide = inked.length > 0 && inked.every((g) => WIDE.test(g))
    t = {
      glyphs: wide
        ? profile.glyphs.map((g) => (g === ' ' ? IDEOGRAPHIC_SPACE : g))
        : profile.glyphs,
      blank: wide ? IDEOGRAPHIC_SPACE : ' ',
      rtl: profile.glyphs.some((g) => RTL.test(g)),
    }
    textGlyphsCache.set(profile, t)
  }
  return t
}

// LEFT-TO-RIGHT OVERRIDE … POP DIRECTIONAL FORMATTING: lay this line out in cell order whatever
// scripts are in it. Plain text has no other way to say so.
const LRO = '\u202d'
const PDF = '\u202c'

export function frameToText(frame: AsciiFrame): string {
  const { glyphs, blank, rtl } = textGlyphs(frame.profile)
  const lines: string[] = []
  for (let y = 0; y < frame.rows; y++) {
    let line = ''
    for (let x = 0; x < frame.columns; x++) {
      const i = y * frame.columns + x
      line += frame.flags[i] & FLAG_TRANSPARENT ? blank : glyphs[frame.glyphIds[i]]
    }
    lines.push(rtl ? LRO + line + PDF : line)
  }
  return lines.join('\n')
}

export function frameToAnsi(frame: AsciiFrame): string {
  if (frame.colorMode === 'mono' || !frame.foreground) return frameToText(frame)
  const { glyphs, blank, rtl } = textGlyphs(frame.profile)
  const useBg = frame.colorMode === 'full' && frame.background !== undefined
  let out = ''
  for (let y = 0; y < frame.rows; y++) {
    if (rtl) out += LRO
    let lastFg = -1
    let lastBg = -1
    for (let x = 0; x < frame.columns; x++) {
      const i = y * frame.columns + x
      if (frame.flags[i] & FLAG_TRANSPARENT) {
        if (lastFg !== -1 || lastBg !== -1) {
          out += '\x1b[0m'
          lastFg = -1
          lastBg = -1
        }
        out += blank
        continue
      }
      const fg = frame.foreground[i]
      if (fg !== lastFg) {
        out += `\x1b[38;2;${fg & 0xff};${(fg >>> 8) & 0xff};${(fg >>> 16) & 0xff}m`
        lastFg = fg
      }
      if (useBg) {
        const bg = frame.background![i]
        if (bg !== lastBg) {
          out += `\x1b[48;2;${bg & 0xff};${(bg >>> 8) & 0xff};${(bg >>> 16) & 0xff}m`
          lastBg = bg
        }
      }
      out += glyphs[frame.glyphIds[i]]
    }
    out += '\x1b[0m'
    if (rtl) out += PDF
    if (y < frame.rows - 1) out += '\n'
  }
  return out
}

export function frameToHTML(frame: AsciiFrame): string {
  const { glyphs, blank, rtl } = textGlyphs(frame.profile)
  // On the element rather than as LRO/PDF in the text, which a copy out of the page would carry.
  let out = `<pre class="ascii-fx"${rtl ? ' dir="ltr" style="unicode-bidi:bidi-override"' : ''}>`
  if (frame.colorMode === 'mono' || !frame.foreground) {
    const text = frameToText(frame)
    return `${out}${escapeHtml(rtl ? text.replaceAll(LRO, '').replaceAll(PDF, '') : text)}</pre>`
  }
  const useBg = frame.colorMode === 'full' && frame.background !== undefined
  for (let y = 0; y < frame.rows; y++) {
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
    for (let x = 0; x < frame.columns; x++) {
      const i = y * frame.columns + x
      const transparent = (frame.flags[i] & FLAG_TRANSPARENT) !== 0
      const fg = transparent ? -1 : frame.foreground[i]
      const bg = transparent ? -1 : useBg ? frame.background![i] : -1
      if (fg !== runFg || bg !== runBg) {
        flush()
        runFg = fg
        runBg = bg
      }
      run += transparent ? blank : glyphs[frame.glyphIds[i]]
    }
    flush()
    if (y < frame.rows - 1) out += '\n'
  }
  out += '</pre>'
  return out
}

/**
 * The frame as a standalone SVG: vector glyphs that stay sharp at any size and paste into a
 * design tool as editable text. Every glyph gets an explicit x, so columns stay on the grid even
 * when the viewer substitutes a font with different advances. `glyph` frames carry their colour
 * in the glyph art rather than in the frame, so they export as plain text in the foreground colour.
 */
export function frameToSVG(frame: AsciiFrame, options: SvgExportOptions = {}): string {
  const { glyphs, metrics } = frame.profile
  const cellH = options.cellHeight ?? 16
  const scale = cellH / metrics.cellHeight
  const cellW = metrics.cellWidth * scale
  const fontSize =
    (metrics.cellHeight * metrics.unitsPerEm * scale) / (metrics.ascent - metrics.descent)
  const baseline = metrics.baseline * scale
  const width = frame.columns * cellW
  const height = frame.rows * cellH
  const family =
    options.fontFamily ??
    (frame.profile.metadata.fontFamily
      ? `'${frame.profile.metadata.fontFamily.replaceAll("'", '')}', monospace`
      : 'monospace')
  const perCell = frame.colorMode !== 'mono' && frame.colorMode !== 'glyph' && !!frame.foreground
  const fgFixed = rgbCss(options.foreground ?? [255, 255, 255])
  const ground =
    options.background === undefined
      ? frame.colorMode === 'mono'
        ? ([0, 0, 0] as const)
        : null
      : options.background

  let out =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="0 0 ${num(width)} ${num(height)}">`
  if (ground && frame.colorMode !== 'full') {
    out += `<rect width="100%" height="100%" fill="${rgbCss(ground)}"/>`
  }

  // full: one rect per horizontal run of equal background, under the text.
  if (frame.colorMode === 'full' && frame.background) {
    out += '<g shape-rendering="crispEdges">'
    for (let y = 0; y < frame.rows; y++) {
      let x = 0
      while (x < frame.columns) {
        const i = y * frame.columns + x
        if (frame.flags[i] & FLAG_TRANSPARENT) {
          x++
          continue
        }
        const bg = frame.background[i]
        let end = x + 1
        while (
          end < frame.columns &&
          !(frame.flags[i + end - x] & FLAG_TRANSPARENT) &&
          frame.background[i + end - x] === bg
        ) {
          end++
        }
        out +=
          `<rect x="${num(x * cellW)}" y="${num(y * cellH)}" width="${num((end - x) * cellW)}" ` +
          `height="${num(cellH)}" fill="${rgbHex(bg)}"/>`
        x = end
      }
    }
    out += '</g>'
  }

  // Every glyph is positioned on its own, but a viewer may still shape and reorder a run of
  // right-to-left text before placing it, so the override goes on the group.
  const bidi = textGlyphs(frame.profile).rtl ? ' direction="ltr" unicode-bidi="bidi-override"' : ''
  out += `<g font-family="${escapeHtml(family)}" font-size="${num(fontSize)}"${bidi}${perCell ? '' : ` fill="${fgFixed}"`}>`
  for (let y = 0; y < frame.rows; y++) {
    const by = num(y * cellH + baseline)
    let x = 0
    while (x < frame.columns) {
      const i = y * frame.columns + x
      const g = glyphs[frame.glyphIds[i]]
      if (frame.flags[i] & FLAG_TRANSPARENT || g.trim() === '') {
        x++
        continue
      }
      // A run is consecutive inked cells of one colour; blanks end it rather than padding it.
      const fg = perCell ? frame.foreground![i] : 0
      let text = ''
      const xs: string[] = []
      while (x < frame.columns) {
        const j = y * frame.columns + x
        const gj = glyphs[frame.glyphIds[j]]
        if (frame.flags[j] & FLAG_TRANSPARENT || gj.trim() === '') break
        if (perCell && frame.foreground![j] !== fg) break
        text += gj
        xs.push(num(x * cellW))
        x++
      }
      const fill = perCell ? ` fill="${rgbHex(fg)}"` : ''
      out += `<text x="${xs.join(' ')}" y="${by}"${fill}>${escapeHtml(text)}</text>`
    }
  }
  out += '</g></svg>'
  return out
}
