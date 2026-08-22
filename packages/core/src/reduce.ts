import type { RawImage } from './types.js'
import { idiv, rdiv } from './util.js'

/**
 * reduce-v1 (ALGORITHM.md §4): integer box filter to exactly (8·columns) × (8·rows)
 * RGBA samples, alpha-weighted. `ignoreAlpha` treats every pixel as a = 255.
 */
export function reduceSource(
  source: RawImage,
  columns: number,
  rows: number,
  ignoreAlpha: boolean,
): Uint8Array {
  const { width: W, height: H, data } = source
  if (data.length < W * H * 4) {
    throw new Error(
      `RawImage data is ${data.length} bytes; expected ${W * H * 4} (${W}×${H} RGBA).`,
    )
  }
  const SW = columns * 8
  const SH = rows * 8
  const out = new Uint8Array(SW * SH * 4)
  for (let ty = 0; ty < SH; ty++) {
    const y0 = idiv(ty * H, SH)
    const y1 = Math.max(y0 + 1, idiv((ty + 1) * H, SH))
    for (let tx = 0; tx < SW; tx++) {
      const x0 = idiv(tx * W, SW)
      const x1 = Math.max(x0 + 1, idiv((tx + 1) * W, SW))
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        let p = (y * W + x0) * 4
        for (let x = x0; x < x1; x++, p += 4) {
          const a = ignoreAlpha ? 255 : data[p + 3]
          sr += data[p] * a
          sg += data[p + 1] * a
          sb += data[p + 2] * a
          sa += a
          n++
        }
      }
      const o = (ty * SW + tx) * 4
      if (sa > 0) {
        out[o] = rdiv(sr, sa)
        out[o + 1] = rdiv(sg, sa)
        out[o + 2] = rdiv(sb, sa)
        out[o + 3] = rdiv(sa, n)
      }
    }
  }
  return out
}
