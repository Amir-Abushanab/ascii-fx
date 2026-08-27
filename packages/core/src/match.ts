import type { MatchOptions, RawImage } from './types.js'
import { FLAG_FLAT, FLAG_TRANSPARENT } from './types.js'
import { popcount32, rdiv } from './util.js'
import { luma8, packRGBA } from './color.js'
import { reduceSource } from './reduce.js'
import { AsciiFrame } from './frame.js'
import { blankGlyphId } from './blankGlyph.js'
import { deriveGrid } from './grid.js'
import { matchFrameRamp, matchFrameShape6 } from './shape6.js'
import { matchFrameChromatic } from './chromatic.js'

export const ALGORITHM_VERSION = 'structural-v1'
export { blankGlyphId }

/** The per-cell outputs of a structural match, without the profile a frame carries. */
export interface StructuralCells {
  glyphIds: Uint16Array
  foreground?: Uint32Array
  background?: Uint32Array
  flags: Uint16Array
}

/**
 * structural-v1 reference matcher (ALGORITHM.md §§3–11). Deterministic and
 * all-integer; this implementation defines correctness for every backend.
 * Approximate matchers (§18–19) are explicit opt-ins, never fallbacks.
 */
export function matchFrame(source: RawImage, options: MatchOptions): AsciiFrame {
  const profile = options.profile
  if (!profile)
    throw new Error('matchFrame requires options.profile (build one with @ascii-fx/compiler).')
  const matcher = options.matcher ?? 'structural'
  if (options.color === 'glyph' && matcher !== 'chromatic') {
    throw new Error(
      `color: 'glyph' is produced by matcher: 'chromatic'; ${matcher} fits colour to a mask.`,
    )
  }
  if (matcher === 'shape6') return matchFrameShape6(source, options)
  if (matcher === 'ramp') return matchFrameRamp(source, options)
  if (matcher === 'chromatic') return matchFrameChromatic(source, options)

  const { columns, rows } = deriveGrid(
    source.width,
    source.height,
    profile,
    options.columns,
    options.rows,
  )
  const reduced = reduceSource(source, columns, rows, (options.alpha ?? 'mask') === 'ignore')
  const cells = matchBand(reduced, columns, rows, options)

  return new AsciiFrame({
    columns,
    rows,
    colorMode: options.color ?? 'mono',
    glyphIds: cells.glyphIds,
    foreground: cells.foreground,
    background: cells.background,
    flags: cells.flags,
    profile,
  })
}

/**
 * structural-v1 over a band of `bandRows` cell rows, given that band's reduced
 * samples. Both the input and the outputs are band-local, and no step reads
 * outside the band — every cell in ALGORITHM.md §§5–10 is independent — so
 * concatenating bands reproduces `matchFrame` byte for byte. This is the one
 * implementation of the exact matcher; `matchFrame` is a whole-frame band.
 */
export function matchBand(
  reduced: Uint8Array,
  columns: number,
  bandRows: number,
  options: MatchOptions,
): StructuralCells {
  const profile = options.profile
  if (!profile)
    throw new Error('matchBand requires options.profile (build one with @ascii-fx/compiler).')
  const color = options.color ?? 'mono'
  const alphaMode = options.alpha ?? 'mask'
  const flatT = options.flatThreshold ?? 15
  const fgOpt = options.foreground ?? [255, 255, 255]
  const bgOpt = options.background ?? [0, 0, 0]

  // Polarity derives from the reconstruction objective (ALGORITHM.md §8):
  // there is no invert flag — swapping the fixed colors flips it coherently.
  const inkLight =
    color === 'mono'
      ? luma8(fgOpt[0], fgOpt[1], fgOpt[2]) >= luma8(bgOpt[0], bgOpt[1], bgOpt[2])
      : luma8(bgOpt[0], bgOpt[1], bgOpt[2]) < 128

  const SW = columns * 8

  const N = columns * bandRows
  const glyphIds = new Uint16Array(N)
  const needFg = color !== 'mono'
  const needBg = color === 'full'
  const fgArr = needFg ? new Uint32Array(N) : undefined
  const bgArr = needBg ? new Uint32Array(N) : undefined
  const flags = new Uint16Array(N)

  const { masksLo, masksHi, coverage } = profile.structural
  // The flat ramp (§6) maps mean luma onto glyph ink coverage, so its ceiling has to be
  // the densest glyph this profile actually has — not the 65535 a full block would score.
  // The default ascii charset tops out at '@' (16906/65535), so a fixed 65535 ceiling made
  // every cell above ~26% luma target a coverage no glyph could reach and clamp to '@'.
  let covMax = 0
  for (let g = 0; g < profile.glyphCount; g++) if (coverage[g] > covMax) covMax = coverage[g]
  if (covMax === 0) covMax = 1 // a profile of blanks: avoid a zero-width ramp
  const G = profile.glyphCount
  const blank = blankGlyphId(profile)
  const full = color === 'full'

  // Per-frame scratch; nothing allocates per cell.
  const sr = new Uint8Array(64)
  const sg = new Uint8Array(64)
  const sb = new Uint8Array(64)
  const candId = new Int32Array(8)
  const candScore = new Int32Array(8)

  for (let cy = 0; cy < bandRows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const ci = cy * columns + cx

      // Cell features (§5).
      let minL = 256
      let minI = 0
      let maxL = -1
      let maxI = 0
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
          if (l < minL) {
            minL = l
            minI = k
          }
          if (l > maxL) {
            maxL = l
            maxI = k
          }
          sumR += r
          sumG += g
          sumB += b
          sumL += l
          sumA += reduced[p + 3]
        }
      }

      if (alphaMode === 'mask' && rdiv(sumA, 64) < 128) {
        glyphIds[ci] = blank
        flags[ci] = FLAG_TRANSPARENT
        continue
      }

      const meanR = rdiv(sumR, 64)
      const meanG = rdiv(sumG, 64)
      const meanB = rdiv(sumB, 64)
      const meanL = rdiv(sumL, 64)

      // Flat path (§6).
      if (maxL - minL < flatT) {
        flags[ci] = FLAG_FLAT
        if (full) {
          glyphIds[ci] = blank
          const c = packRGBA(meanR, meanG, meanB)
          fgArr![ci] = c
          bgArr![ci] = c
        } else {
          const target = rdiv((inkLight ? meanL : 255 - meanL) * covMax, 255)
          let bestId = 0
          let bestD = 0x7fffffff
          for (let g = 0; g < G; g++) {
            const d = Math.abs(coverage[g] - target)
            if (d < bestD) {
              bestD = d
              bestId = g
            }
          }
          glyphIds[ci] = bestId
          if (needFg) fgArr![ci] = packRGBA(meanR, meanG, meanB)
        }
        continue
      }

      // Binary source mask (§7).
      const dR = sr[minI]
      const dG = sg[minI]
      const dB = sb[minI]
      const lR = sr[maxI]
      const lG = sg[maxI]
      const lB = sb[maxI]
      let mLo = 0
      let mHi = 0
      for (let k = 0; k < 64; k++) {
        const r = sr[k]
        const g = sg[k]
        const b = sb[k]
        const d0 = r - dR
        const d1 = g - dG
        const d2 = b - dB
        const l0 = r - lR
        const l1 = g - lG
        const l2 = b - lB
        const dd = d0 * d0 + d1 * d1 + d2 * d2
        const dl = l0 * l0 + l1 * l1 + l2 * l2
        if (dd <= dl) {
          if (k < 32) mLo |= 1 << k
          else mHi |= 1 << (k - 32)
        }
      }
      mLo >>>= 0
      mHi >>>= 0

      // Polarity (§8): mono/foreground match against ink; full uses the raw mask.
      const sLo = full ? mLo : inkLight ? ~mLo >>> 0 : mLo
      const sHi = full ? mHi : inkLight ? ~mHi >>> 0 : mHi

      // Prefilter (§9): first K=8 in (score, id) order.
      let count = 0
      for (let g = 0; g < G; g++) {
        let d = popcount32(sLo ^ masksLo[g]) + popcount32(sHi ^ masksHi[g])
        if (full && 64 - d < d) d = 64 - d
        if (count < 8) {
          let pos = count
          while (pos > 0 && candScore[pos - 1] > d) pos--
          for (let m = count; m > pos; m--) {
            candScore[m] = candScore[m - 1]
            candId[m] = candId[m - 1]
          }
          candScore[pos] = d
          candId[pos] = g
          count++
        } else if (d < candScore[7]) {
          let pos = 7
          while (pos > 0 && candScore[pos - 1] > d) pos--
          for (let m = 7; m > pos; m--) {
            candScore[m] = candScore[m - 1]
            candId[m] = candId[m - 1]
          }
          candScore[pos] = d
          candId[pos] = g
        }
      }

      // Exact rerank (§10).
      let bestErr = 0x7fffffff
      let bestId = candId[0]
      let bestFg = 0
      let bestBg = 0
      for (let c = 0; c < count; c++) {
        const g = candId[c]
        const gLo = masksLo[g]
        const gHi = masksHi[g]
        let fR: number
        let fG: number
        let fB: number
        let bR: number
        let bG: number
        let bB: number
        if (color === 'mono') {
          fR = fgOpt[0]
          fG = fgOpt[1]
          fB = fgOpt[2]
          bR = bgOpt[0]
          bG = bgOpt[1]
          bB = bgOpt[2]
        } else {
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
          if (full) {
            const hasInk = iN > 0
            const hasOff = oN > 0
            const inkR = hasInk ? rdiv(iR, iN) : rdiv(oR, oN)
            const inkG = hasInk ? rdiv(iG, iN) : rdiv(oG, oN)
            const inkB = hasInk ? rdiv(iB, iN) : rdiv(oB, oN)
            const offR = hasOff ? rdiv(oR, oN) : inkR
            const offG = hasOff ? rdiv(oG, oN) : inkG
            const offB = hasOff ? rdiv(oB, oN) : inkB
            fR = inkR
            fG = inkG
            fB = inkB
            bR = offR
            bG = offG
            bB = offB
          } else {
            fR = iN > 0 ? rdiv(iR, iN) : bgOpt[0]
            fG = iN > 0 ? rdiv(iG, iN) : bgOpt[1]
            fB = iN > 0 ? rdiv(iB, iN) : bgOpt[2]
            bR = bgOpt[0]
            bG = bgOpt[1]
            bB = bgOpt[2]
          }
        }
        let err = 0
        for (let k = 0; k < 64; k++) {
          const on = k < 32 ? (gLo >>> k) & 1 : (gHi >>> (k - 32)) & 1
          const e0 = sr[k] - (on ? fR : bR)
          const e1 = sg[k] - (on ? fG : bG)
          const e2 = sb[k] - (on ? fB : bB)
          err += e0 * e0 + e1 * e1 + e2 * e2
          if (err >= bestErr) break
        }
        if (err < bestErr) {
          bestErr = err
          bestId = g
          bestFg = packRGBA(fR, fG, fB)
          bestBg = packRGBA(bR, bG, bB)
        }
      }

      glyphIds[ci] = bestId
      if (needFg) fgArr![ci] = bestFg
      if (needBg) bgArr![ci] = bestBg
    }
  }

  return { glyphIds, foreground: fgArr, background: bgArr, flags }
}
