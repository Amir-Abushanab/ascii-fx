// shape6-v1 and ramp-v1 (ALGORITHM.md §18–19): explicit opt-in approximate
// matchers. Flat/transparent cells and color fitting reuse exact semantics.
import type { MatchOptions, RawImage } from './types.js'
import { FLAG_FLAT, FLAG_TRANSPARENT } from './types.js'
import { rdiv } from './util.js'
import { luma8, packRGBA } from './color.js'
import { reduceSource } from './reduce.js'
import { AsciiFrame } from './frame.js'
import { deriveGrid } from './grid.js'
import { blankGlyphId } from './blankGlyph.js'

/** Source descriptor from 64 polarity-adjusted lumas (ALGORITHM.md §18). */
export function computeShape6(pl: ArrayLike<number>, out: Int32Array): void {
  let sum = 0
  let top = 0
  let left = 0
  let tl = 0
  let tr = 0
  let bl = 0
  let br = 0
  let center = 0
  for (let k = 0; k < 64; k++) {
    const row = k >> 3
    const col = k & 7
    const v = pl[k]
    sum += v
    if (row < 4) top += v
    if (col < 4) left += v
    if (row < 4) {
      if (col < 4) tl += v
      else tr += v
    } else if (col < 4) bl += v
    else br += v
    if (row >= 2 && row < 6 && col >= 2 && col < 6) center += v
  }
  const v0 = rdiv(sum, 64)
  out[0] = v0
  out[1] = rdiv(top, 32) - rdiv(sum - top, 32)
  out[2] = rdiv(left, 32) - rdiv(sum - left, 32)
  out[3] = rdiv(tl + br - tr - bl, 32)
  out[4] = rdiv(center, 16) - rdiv(sum - center, 48)
  let dev = 0
  for (let k = 0; k < 64; k++) dev += Math.abs(pl[k] - v0)
  out[5] = rdiv(dev, 64)
}

const clamp07 = (x: number): number => (x < 0 ? 0 : x > 7 ? 7 : x)

/** 3-bit quantization → 18-bit LUT index (ALGORITHM.md §18). */
export function quantizeShape6(v: ArrayLike<number>): number {
  const q0 = clamp07(v[0] >> 5)
  const q1 = clamp07((v[1] + 256) >> 6)
  const q2 = clamp07((v[2] + 256) >> 6)
  const q3 = clamp07((v[3] + 256) >> 6)
  const q4 = clamp07((v[4] + 256) >> 6)
  const q5 = Math.min(7, v[5] >> 4)
  return q0 | (q1 << 3) | (q2 << 6) | (q3 << 9) | (q4 << 12) | (q5 << 15)
}

/** Dequantized bucket-center vector for LUT construction. */
export function shape6BucketCenter(index: number, out: Float64Array): void {
  out[0] = (index & 7) * 32 + 16
  out[1] = ((index >> 3) & 7) * 64 - 224
  out[2] = ((index >> 6) & 7) * 64 - 224
  out[3] = ((index >> 9) & 7) * 64 - 224
  out[4] = ((index >> 12) & 7) * 64 - 224
  out[5] = ((index >> 15) & 7) * 16 + 8
}

interface CellScaffold {
  columns: number
  rows: number
  reduced: Uint8Array
  glyphIds: Uint16Array
  fgArr?: Uint32Array
  bgArr?: Uint32Array
  flags: Uint16Array
}

/** Fit colors for a chosen glyph exactly as the structural rerank does (§10). */
function fitColors(
  gLo: number,
  gHi: number,
  sr: Uint8Array,
  sg: Uint8Array,
  sb: Uint8Array,
  color: 'mono' | 'foreground' | 'full',
  fgOpt: readonly [number, number, number],
  bgOpt: readonly [number, number, number],
): [number, number] {
  if (color === 'mono') return [packRGBA(fgOpt[0], fgOpt[1], fgOpt[2]), packRGBA(bgOpt[0], bgOpt[1], bgOpt[2])]
  let iR = 0
  let iG = 0
  let iB = 0
  let iN = 0
  let oR = 0
  let oG = 0
  let oB = 0
  let oN = 0
  for (let k = 0; k < 64; k++) {
    const on = k < 32 ? (gLo >>> k) & 1 : (gHi >>> (k - 32)) & 1
    if (on) {
      iR += sr[k]
      iG += sg[k]
      iB += sb[k]
      iN++
    } else {
      oR += sr[k]
      oG += sg[k]
      oB += sb[k]
      oN++
    }
  }
  if (color === 'full') {
    const inkR = iN > 0 ? rdiv(iR, iN) : rdiv(oR, oN)
    const inkG = iN > 0 ? rdiv(iG, iN) : rdiv(oG, oN)
    const inkB = iN > 0 ? rdiv(iB, iN) : rdiv(oB, oN)
    const offR = oN > 0 ? rdiv(oR, oN) : inkR
    const offG = oN > 0 ? rdiv(oG, oN) : inkG
    const offB = oN > 0 ? rdiv(oB, oN) : inkB
    return [packRGBA(inkR, inkG, inkB), packRGBA(offR, offG, offB)]
  }
  const fR = iN > 0 ? rdiv(iR, iN) : bgOpt[0]
  const fG = iN > 0 ? rdiv(iG, iN) : bgOpt[1]
  const fB = iN > 0 ? rdiv(iB, iN) : bgOpt[2]
  return [packRGBA(fR, fG, fB), packRGBA(bgOpt[0], bgOpt[1], bgOpt[2])]
}

/**
 * Shared per-cell scaffold for the approximate matchers: gathers samples,
 * handles transparent and flat cells with exact semantics, then delegates the
 * structural decision to `pick`.
 */
function runApproxMatcher(
  source: RawImage,
  options: MatchOptions,
  pick: (
    pl: Uint8Array,
    sr: Uint8Array,
    sg: Uint8Array,
    sb: Uint8Array,
    meanL: number,
  ) => number,
): AsciiFrame {
  const profile = options.profile
  const color = options.color ?? 'mono'
  if (color === 'glyph') {
    throw new Error("color: 'glyph' is produced by matcher: 'chromatic'; shape6 and ramp fit colour to a mask.")
  }
  const alphaMode = options.alpha ?? 'mask'
  const flatT = options.flatThreshold ?? 15
  const fgOpt = options.foreground ?? ([255, 255, 255] as const)
  const bgOpt = options.background ?? ([0, 0, 0] as const)
  const inkLight =
    color === 'full'
      ? true
      : color === 'mono'
        ? luma8(fgOpt[0], fgOpt[1], fgOpt[2]) >= luma8(bgOpt[0], bgOpt[1], bgOpt[2])
        : luma8(bgOpt[0], bgOpt[1], bgOpt[2]) < 128

  const { columns, rows } = deriveGrid(source.width, source.height, profile, options.columns, options.rows)
  const SW = columns * 8
  const reduced = reduceSource(source, columns, rows, alphaMode === 'ignore')
  const n = columns * rows
  const s: CellScaffold = {
    columns,
    rows,
    reduced,
    glyphIds: new Uint16Array(n),
    fgArr: color !== 'mono' ? new Uint32Array(n) : undefined,
    bgArr: color === 'full' ? new Uint32Array(n) : undefined,
    flags: new Uint16Array(n),
  }
  const { coverage, masksLo, masksHi } = profile.structural
  const G = profile.glyphCount
  const blank = blankGlyphId(profile)

  const sr = new Uint8Array(64)
  const sg = new Uint8Array(64)
  const sb = new Uint8Array(64)
  const pl = new Uint8Array(64)

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const ci = cy * columns + cx
      let minL = 256
      let maxL = -1
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let sumL = 0
      let sumA = 0
      for (let j = 0; j < 8; j++) {
        let p = ((cy * 8 + j) * SW + cx * 8) * 4
        for (let i = 0; i < 8; i++, p += 4) {
          const k = j * 8 + i
          const r = reduced[p]
          const g = reduced[p + 1]
          const b = reduced[p + 2]
          sr[k] = r
          sg[k] = g
          sb[k] = b
          const l = luma8(r, g, b)
          pl[k] = inkLight ? l : 255 - l
          if (l < minL) minL = l
          if (l > maxL) maxL = l
          sumR += r
          sumG += g
          sumB += b
          sumL += l
          sumA += reduced[p + 3]
        }
      }
      if (alphaMode === 'mask' && rdiv(sumA, 64) < 128) {
        s.glyphIds[ci] = blank
        s.flags[ci] = FLAG_TRANSPARENT
        continue
      }
      const meanR = rdiv(sumR, 64)
      const meanG = rdiv(sumG, 64)
      const meanB = rdiv(sumB, 64)
      const meanL = rdiv(sumL, 64)
      if (maxL - minL < flatT) {
        s.flags[ci] = FLAG_FLAT
        if (color === 'full') {
          s.glyphIds[ci] = blank
          const c = packRGBA(meanR, meanG, meanB)
          s.fgArr![ci] = c
          s.bgArr![ci] = c
        } else {
          const covTarget = inkLight ? meanL * 257 : (255 - meanL) * 257
          let bestId = 0
          let bestD = 0x7fffffff
          for (let g = 0; g < G; g++) {
            const d = Math.abs(coverage[g] - covTarget)
            if (d < bestD) {
              bestD = d
              bestId = g
            }
          }
          s.glyphIds[ci] = bestId
          if (s.fgArr) s.fgArr[ci] = packRGBA(meanR, meanG, meanB)
        }
        continue
      }
      const id = pick(pl, sr, sg, sb, meanL)
      s.glyphIds[ci] = id
      if (s.fgArr) {
        const [fg, bg] = fitColors(masksLo[id], masksHi[id], sr, sg, sb, color, fgOpt, bgOpt)
        s.fgArr[ci] = fg
        if (s.bgArr) s.bgArr[ci] = bg
      }
    }
  }

  return new AsciiFrame({
    columns,
    rows,
    colorMode: color,
    glyphIds: s.glyphIds,
    foreground: s.fgArr,
    background: s.bgArr,
    flags: s.flags,
    profile,
  })
}

export function matchFrameShape6(source: RawImage, options: MatchOptions): AsciiFrame {
  const shape6 = options.profile.shape6
  if (!shape6) {
    throw new Error(
      'matcher "shape6" requires a profile compiled with shape6 data. ' +
        'Rebuild it with buildProfile({ ..., shape6: true }) or `ascii-fx profile build --shape6`.',
    )
  }
  const { vectors6, lut3 } = shape6
  const G = options.profile.glyphCount
  const desc = new Int32Array(6)
  return runApproxMatcher(source, options, (pl) => {
    computeShape6(pl, desc)
    if (lut3) return lut3[quantizeShape6(desc)]
    let best = 0
    let bestD = Infinity
    for (let g = 0; g < G; g++) {
      let d = 0
      for (let c = 0; c < 6; c++) {
        const e = desc[c] - vectors6[g * 6 + c]
        d += e * e
      }
      if (d < bestD) {
        bestD = d
        best = g
      }
    }
    return best
  })
}

export function matchFrameRamp(source: RawImage, options: MatchOptions): AsciiFrame {
  const { coverage } = options.profile.structural
  const G = options.profile.glyphCount
  const color = options.color ?? 'mono'
  const fgOpt = options.foreground ?? ([255, 255, 255] as const)
  const bgOpt = options.background ?? ([0, 0, 0] as const)
  const inkLight =
    color === 'full'
      ? true
      : color === 'mono'
        ? luma8(fgOpt[0], fgOpt[1], fgOpt[2]) >= luma8(bgOpt[0], bgOpt[1], bgOpt[2])
        : luma8(bgOpt[0], bgOpt[1], bgOpt[2]) < 128
  return runApproxMatcher(source, options, (_pl, _sr, _sg, _sb, meanL) => {
    const covTarget = inkLight ? meanL * 257 : (255 - meanL) * 257
    let best = 0
    let bestD = 0x7fffffff
    for (let g = 0; g < G; g++) {
      const d = Math.abs(coverage[g] - covTarget)
      if (d < bestD) {
        bestD = d
        best = g
      }
    }
    return best
  })
}
