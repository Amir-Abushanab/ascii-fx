import type { RawImage } from './types.js'
import { idiv, rdiv } from './util.js'

/**
 * A horizontal slice of a source image. `data` holds `height` image rows
 * starting at `yOffset`; `sourceHeight` is the full image's height, because
 * reduce-v1's row mapping is defined on the *global* grid — a band that
 * re-derived it from its own height would land on different source rows and
 * stop agreeing with a whole-frame reduction.
 */
export interface SourceStrip {
  width: number
  height: number
  sourceHeight: number
  yOffset: number
  data: Uint8Array | Uint8ClampedArray
}

/** Image rows a cell-row band reads, per reduce-v1's mapping. */
export function bandSourceRows(
  sourceHeight: number,
  rows: number,
  rowStart: number,
  rowEnd: number,
): { y0: number; y1: number } {
  const SH = rows * 8
  const first = rowStart * 8
  const last = rowEnd * 8 - 1
  const y0 = idiv(first * sourceHeight, SH)
  const lastY0 = idiv(last * sourceHeight, SH)
  const y1 = Math.max(lastY0 + 1, idiv((last + 1) * sourceHeight, SH))
  return { y0, y1: Math.min(y1, sourceHeight) }
}

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
  return reduceBand(
    { width: W, height: H, sourceHeight: H, yOffset: 0, data },
    columns,
    rows,
    ignoreAlpha,
    0,
    rows,
  )
}

/**
 * reduce-v1 over cell rows [rowStart, rowEnd) only, reading a strip that must
 * cover `bandSourceRows`. Output is band-local: (8·columns) × (8·(rowEnd−rowStart)).
 * Every sample is byte-identical to the same region of a whole-frame reduction —
 * the row mapping below is computed from the global `ty`, never from the band.
 */
export function reduceBand(
  strip: SourceStrip,
  columns: number,
  rows: number,
  ignoreAlpha: boolean,
  rowStart: number,
  rowEnd: number,
): Uint8Array {
  const { width: W, sourceHeight: H, yOffset, data } = strip
  if (data.length < W * strip.height * 4) {
    throw new Error(
      `Strip data is ${data.length} bytes; expected ${W * strip.height * 4} (${W}×${strip.height} RGBA).`,
    )
  }
  const SW = columns * 8
  const SH = rows * 8
  const tyStart = rowStart * 8
  const tyEnd = rowEnd * 8
  const out = new Uint8Array(SW * (tyEnd - tyStart) * 4)
  for (let ty = tyStart; ty < tyEnd; ty++) {
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
        let p = ((y - yOffset) * W + x0) * 4
        for (let x = x0; x < x1; x++, p += 4) {
          const a = ignoreAlpha ? 255 : data[p + 3]
          sr += data[p] * a
          sg += data[p + 1] * a
          sb += data[p + 2] * a
          sa += a
          n++
        }
      }
      const o = ((ty - tyStart) * SW + tx) * 4
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
