import type { RGB, RawImage } from './types.js'
import { FLAG_TRANSPARENT } from './types.js'
import type { AsciiFrame } from './frame.js'
import { idiv, rdiv } from './util.js'
import { packRGBA } from './color.js'

export interface CompositeOptions {
  /** mono only; default white. */
  foreground?: RGB
  /** mono default black; 'foreground' mode default null (transparent backdrop). */
  background?: RGB | null
}

/**
 * Reference CPU compositor: blends the profile atlas with per-cell colors into
 * RGBA pixels at native atlas cell size. Pure function — no DOM. Pass `reuse`
 * (a previous result) to avoid reallocating the pixel buffer every frame.
 */
export function compositeFrame(
  frame: AsciiFrame,
  options: CompositeOptions = {},
  reuse?: RawImage,
): RawImage {
  const { atlas } = frame.profile
  const cw = atlas.cellWidth
  const ch = atlas.cellHeight
  const width = frame.columns * cw
  const height = frame.rows * ch
  const out =
    reuse && reuse.width === width && reuse.height === height && reuse.data instanceof Uint8Array
      ? (reuse.data.fill(0), reuse.data)
      : new Uint8Array(width * height * 4)

  const monoFg = packRGBA(...(options.foreground ?? [255, 255, 255]))
  const monoBgOpt = options.background
  const monoBg = packRGBA(...(monoBgOpt ?? [0, 0, 0]))
  const fgBackdrop = options.background === undefined ? null : options.background

  // chromatic-v1 (ALGORITHM.md §C): the glyph carries its own colour, so there
  // is nothing to tint. Sample the RGBA atlas and composite it over the
  // backdrop with the same integer rule the matcher used to choose the glyph,
  // so what is drawn is what was optimised for.
  if (frame.colorMode === 'glyph') {
    const rgba = atlas.rgba
    if (!rgba) {
      throw new Error(
        `Profile ${frame.profile.id} has no RGBA atlas, so its glyph-coloured cells cannot be drawn. ` +
          'Compile it with @ascii-fx/compiler buildChromaticProfile.',
      )
    }
    const bd = options.background === undefined ? [0, 0, 0] : options.background
    const opaque = bd !== null
    const bR = opaque ? bd[0] : 0
    const bG = opaque ? bd[1] : 0
    const bB = opaque ? bd[2] : 0
    for (let cy = 0; cy < frame.rows; cy++) {
      for (let cx = 0; cx < frame.columns; cx++) {
        const ci = cy * frame.columns + cx
        if (frame.flags[ci] & FLAG_TRANSPARENT) continue
        const id = frame.glyphIds[ci]
        const tileX = (id % atlas.columns) * atlas.pitchWidth + atlas.padding
        const tileY = idiv(id, atlas.columns) * atlas.pitchHeight + atlas.padding
        for (let py = 0; py < ch; py++) {
          const src = ((tileY + py) * atlas.width + tileX) * 4
          let dst = ((cy * ch + py) * width + cx * cw) * 4
          for (let px = 0; px < cw; px++, dst += 4) {
            const sp = src + px * 4
            const a = rgba[sp + 3]
            if (!opaque) {
              // Premultiplying here would lose the glyph's own colour wherever
              // it is partly transparent; keep straight alpha and let the
              // consumer blend.
              out[dst] = rgba[sp]
              out[dst + 1] = rgba[sp + 1]
              out[dst + 2] = rgba[sp + 2]
              out[dst + 3] = a
            } else {
              out[dst] = rdiv(rgba[sp] * a + bR * (255 - a), 255)
              out[dst + 1] = rdiv(rgba[sp + 1] * a + bG * (255 - a), 255)
              out[dst + 2] = rdiv(rgba[sp + 2] * a + bB * (255 - a), 255)
              out[dst + 3] = 255
            }
          }
        }
      }
    }
    return { width, height, data: out }
  }

  for (let cy = 0; cy < frame.rows; cy++) {
    for (let cx = 0; cx < frame.columns; cx++) {
      const ci = cy * frame.columns + cx
      if (frame.flags[ci] & FLAG_TRANSPARENT) continue

      let fg: number
      let bg: number | null
      if (frame.colorMode === 'mono') {
        fg = monoFg
        bg = monoBgOpt === null ? null : monoBg
      } else if (frame.colorMode === 'foreground') {
        fg = frame.foreground![ci]
        bg = fgBackdrop === null || fgBackdrop === undefined ? null : packRGBA(...fgBackdrop)
      } else {
        fg = frame.foreground![ci]
        bg = frame.background![ci]
      }

      const id = frame.glyphIds[ci]
      const tileX = (id % atlas.columns) * atlas.pitchWidth + atlas.padding
      const tileY = idiv(id, atlas.columns) * atlas.pitchHeight + atlas.padding
      const fR = fg & 0xff
      const fG = (fg >>> 8) & 0xff
      const fB = (fg >>> 16) & 0xff
      const bR = bg === null ? 0 : bg & 0xff
      const bG = bg === null ? 0 : (bg >>> 8) & 0xff
      const bB = bg === null ? 0 : (bg >>> 16) & 0xff

      for (let py = 0; py < ch; py++) {
        const src = (tileY + py) * atlas.width + tileX
        let dst = ((cy * ch + py) * width + cx * cw) * 4
        for (let px = 0; px < cw; px++, dst += 4) {
          const a = atlas.data[src + px]
          if (bg === null) {
            out[dst] = fR
            out[dst + 1] = fG
            out[dst + 2] = fB
            out[dst + 3] = a
          } else {
            out[dst] = bR + rdiv((fR - bR) * a, 255)
            out[dst + 1] = bG + rdiv((fG - bG) * a, 255)
            out[dst + 2] = bB + rdiv((fB - bB) * a, 255)
            out[dst + 3] = 255
          }
        }
      }
    }
  }
  return { width, height, data: out }
}
