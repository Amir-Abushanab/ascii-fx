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
export function compositeFrame(frame: AsciiFrame, options: CompositeOptions = {}, reuse?: RawImage): RawImage {
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
