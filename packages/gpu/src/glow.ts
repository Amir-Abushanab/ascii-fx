import type { AsciiFrame, RGB } from '@ascii-fx/core'
import { FLAG_TRANSPARENT } from '@ascii-fx/core'

/**
 * The bloom field, one RGBA texel per cell: what each cell emits, blurred over a 7×7 neighbourhood.
 * GLOW_WGSL computes the same thing on the GPU from the cells buffer; this is the CPU backend's
 * copy, run on the frame it already holds. Float and not bit-exact between the two — it is a
 * composite effect, and the compositors themselves are float.
 *
 * A cell emits its ink and its ground in proportion to the glyph's coverage, each gated by how
 * bright it is: bloom is a glow around light, and a dark glyph on a dark ground gives off none.
 */

/** Gaussian sigma in cells, and the kernel radius it is truncated to. */
const SIGMA = 1.5
const RADIUS = 3
const KERNEL = (() => {
  const k = new Float32Array(2 * RADIUS + 1)
  let sum = 0
  for (let i = -RADIUS; i <= RADIUS; i++) {
    k[i + RADIUS] = Math.exp(-(i * i) / (2 * SIGMA * SIGMA))
    sum += k[i + RADIUS]
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
})()

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** How much of a colour (0..1 channels) passes the bright gate. Mirrors `bright()` in GLOW_WGSL. */
const bright = (r: number, g: number, b: number): number =>
  smoothstep(0.35, 0.9, 0.2126 * r + 0.7152 * g + 0.0722 * b)

export interface GlowInputs {
  /** mono only: the glyph colour the frame has no plane for. */
  foreground: RGB
  /** The ground a mono frame is drawn over, or null when it is see-through. */
  background: RGB | null
}

/** Float RGBA, `columns · rows · 4`, 0..1 per channel. */
export function glowField(frame: AsciiFrame, inputs: GlowInputs, out?: Float32Array): Float32Array {
  const { columns, rows } = frame
  const n = columns * rows
  const field = out && out.length === n * 4 ? out : new Float32Array(n * 4)
  if (frame.colorMode === 'glyph') return field.fill(0)
  const coverage = frame.profile.structural.coverage
  const emit = new Float32Array(n * 3)
  const monoFg = inputs.foreground
  const monoBg = inputs.background
  for (let i = 0; i < n; i++) {
    if (frame.flags[i] & FLAG_TRANSPARENT) continue
    const cov = coverage[frame.glyphIds[i]] / 65535
    let fr: number, fg: number, fb: number
    if (frame.foreground) {
      const c = frame.foreground[i]
      fr = (c & 0xff) / 255
      fg = ((c >>> 8) & 0xff) / 255
      fb = ((c >>> 16) & 0xff) / 255
    } else {
      fr = monoFg[0] / 255
      fg = monoFg[1] / 255
      fb = monoFg[2] / 255
    }
    const fw = bright(fr, fg, fb) * cov
    let r = fr * fw
    let g = fg * fw
    let b = fb * fw
    // Only a ground that is drawn can glow: full's per-cell plane, or mono's opaque backdrop.
    let bgc: number | undefined
    if (frame.colorMode === 'full' && frame.background) bgc = frame.background[i]
    else if (frame.colorMode === 'mono' && monoBg)
      bgc = monoBg[0] | (monoBg[1] << 8) | (monoBg[2] << 16)
    if (bgc !== undefined) {
      const br = (bgc & 0xff) / 255
      const bgg = ((bgc >>> 8) & 0xff) / 255
      const bb = ((bgc >>> 16) & 0xff) / 255
      const bw = bright(br, bgg, bb) * (1 - cov)
      r += br * bw
      g += bgg * bw
      b += bb * bw
    }
    emit[i * 3] = r
    emit[i * 3 + 1] = g
    emit[i * 3 + 2] = b
  }

  // Separable: rows into tmp, then columns into the field. Cells past the edge contribute nothing,
  // the same as the GPU kernel skipping them.
  const tmp = new Float32Array(n * 3)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = -RADIUS; k <= RADIUS; k++) {
        const xx = x + k
        if (xx < 0 || xx >= columns) continue
        const w = KERNEL[k + RADIUS]
        const j = (y * columns + xx) * 3
        r += emit[j] * w
        g += emit[j + 1] * w
        b += emit[j + 2] * w
      }
      const o = (y * columns + x) * 3
      tmp[o] = r
      tmp[o + 1] = g
      tmp[o + 2] = b
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = -RADIUS; k <= RADIUS; k++) {
        const yy = y + k
        if (yy < 0 || yy >= rows) continue
        const w = KERNEL[k + RADIUS]
        const j = (yy * columns + x) * 3
        r += tmp[j] * w
        g += tmp[j + 1] * w
        b += tmp[j + 2] * w
      }
      const o = (y * columns + x) * 4
      field[o] = r
      field[o + 1] = g
      field[o + 2] = b
      field[o + 3] = 1
    }
  }
  return field
}
