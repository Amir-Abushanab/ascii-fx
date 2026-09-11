import type { MatchOptions, RawImage } from './types.js'
import { FLAG_FLAT, FLAG_TRANSPARENT } from './types.js'
import { popcount32, rdiv } from './util.js'
import { luma8, packRGBA } from './color.js'
import { reduceSource } from './reduce.js'
import { AsciiFrame } from './frame.js'
import { blankGlyphId } from './blankGlyph.js'
import { deriveGrid } from './grid.js'
import { jitterHash } from './jitter.js'
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
 * The previous match of the same band, for exact temporal reuse (spec §21).
 *
 * A cell's result is a pure function of its 64 source samples and the options,
 * so a cell whose samples are byte-identical to last time already has its answer
 * — comparing 256 bytes is far cheaper than a prefilter over the charset plus a
 * rerank. The caller owns the "identical options" half of that precondition:
 * pass `reuse` only when `options`, `columns`, and `bandRows` all match the
 * match these cells came from. Nothing here can detect an option change, and
 * reusing across one silently serves stale cells.
 */
export interface BandReuse {
  /** The reduced samples those cells were matched from; same layout as `reduced`. */
  reduced: Uint8Array
  /** That match's band-local outputs. */
  cells: StructuralCells
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
  if ((options.jitter ?? 0) > 0 && matcher !== 'structural') {
    throw new Error(
      `jitter is a structural-v1 effect (ALGORITHM.md §20); matcher: '${matcher}' has no rerank ` +
        'candidates to vary among.',
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
  reuse?: BandReuse,
): StructuralCells {
  const profile = options.profile
  if (!profile)
    throw new Error('matchBand requires options.profile (build one with @ascii-fx/compiler).')
  const color = options.color ?? 'mono'
  const alphaMode = options.alpha ?? 'mask'
  const flatT = options.flatThreshold ?? 15
  const fgOpt = options.foreground ?? [255, 255, 255]
  const bgOpt = options.background ?? [0, 0, 0]
  const jitter = options.jitter ?? 0
  const jitterSeed = options.jitterSeed ?? 0
  const rowOffset = options.rowOffset ?? 0
  if (jitter < 0 || jitter > 255 || !Number.isInteger(jitter))
    throw new Error(`jitter must be an integer 0..255; got ${jitter}`)
  // 0 is a bypass rather than a degenerate case of the formula: at 0 the
  // tolerance admits exact ties too, and §10 pins those to the earlier
  // candidate. Off has to mean untouched.
  const jitterOn = jitter > 0

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

  // Exact temporal reuse (spec §21). Shape is checked rather than trusted: a
  // caller that got the grid wrong would otherwise read another frame's cells
  // at the wrong offsets and emit a plausible-looking wrong picture.
  if (reuse) {
    const prevIds = reuse.cells.glyphIds
    if (reuse.reduced.length !== reduced.length)
      throw new Error(
        `reuse.reduced has ${reuse.reduced.length} bytes; this band's samples have ${reduced.length}.`,
      )
    if (prevIds.length !== N)
      throw new Error(`reuse.cells holds ${prevIds.length} cells; this band has ${N}.`)
    if (needFg && !reuse.cells.foreground)
      throw new Error(`reuse.cells carries no foreground, which color: '${color}' emits.`)
    if (needBg && !reuse.cells.background)
      throw new Error(`reuse.cells carries no background, which color: '${color}' emits.`)
  }
  const prev = reuse?.reduced
  const prevCells = reuse?.cells

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
  // jitter-v1 needs every candidate's error and its own fitted colours, not just
  // the winner's, so it carries them out of the rerank loop.
  const candErr = jitterOn ? new Int32Array(8) : undefined
  const candFg = jitterOn ? new Uint32Array(8) : undefined
  const candBg = jitterOn ? new Uint32Array(8) : undefined

  for (let cy = 0; cy < bandRows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const ci = cy * columns + cx

      // Exact temporal reuse (spec §21): a cell's result depends on nothing but
      // its own 64 samples and the options, so byte-identical samples already
      // have their answer. 256 byte compares — and on a changed cell usually one
      // or two, since the scan stops at the first difference.
      if (prev !== undefined) {
        let same = true
        for (let j = 0; j < 8 && same; j++) {
          const row = ((cy * 8 + j) * SW + cx * 8) * 4
          for (let p = row; p < row + 32; p++) {
            if (reduced[p] !== prev[p]) {
              same = false
              break
            }
          }
        }
        if (same) {
          glyphIds[ci] = prevCells!.glyphIds[ci]
          flags[ci] = prevCells!.flags[ci]
          if (needFg) fgArr![ci] = prevCells!.foreground![ci]
          if (needBg) bgArr![ci] = prevCells!.background![ci]
          continue
        }
      }

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
        // §10 permits stopping a candidate that has already lost. jitter-v1
        // weights every candidate, so it needs the full error and raises the
        // limit past anything reachable (max 64·3·255² = 12,484,800) instead of
        // branching inside the loop.
        const errLimit = jitterOn ? 0x7fffffff : bestErr
        let err = 0
        for (let k = 0; k < 64; k++) {
          const on = k < 32 ? (gLo >>> k) & 1 : (gHi >>> (k - 32)) & 1
          const e0 = sr[k] - (on ? fR : bR)
          const e1 = sg[k] - (on ? fG : bG)
          const e2 = sb[k] - (on ? fB : bB)
          err += e0 * e0 + e1 * e1 + e2 * e2
          if (err >= errLimit) break
        }
        if (jitterOn) {
          candErr![c] = err
          candFg![c] = packRGBA(fR, fG, fB)
          candBg![c] = packRGBA(bR, bG, bB)
        }
        if (err < bestErr) {
          bestErr = err
          bestId = g
          bestFg = packRGBA(fR, fG, fB)
          bestBg = packRGBA(bR, bG, bB)
        }
      }

      // jitter-v1 (§20): swap the argmin for a hash-chosen candidate within a
      // tolerance of it, weighted linearly toward the winner.
      if (jitterOn) {
        const tol = rdiv(bestErr * jitter, 255)
        let total = 0
        for (let c = 0; c < count; c++) {
          const delta = candErr![c] - bestErr
          total += delta <= tol ? tol + 1 - delta : 0
        }
        let r = jitterHash(cx, rowOffset + cy, jitterSeed) % total
        for (let c = 0; c < count; c++) {
          const delta = candErr![c] - bestErr
          const w = delta <= tol ? tol + 1 - delta : 0
          if (r < w) {
            bestId = candId[c]
            bestFg = candFg![c]
            bestBg = candBg![c]
            break
          }
          r -= w
        }
      }

      glyphIds[ci] = bestId
      if (needFg) fgArr![ci] = bestFg
      if (needBg) bgArr![ci] = bestBg
    }
  }

  return { glyphIds, foreground: fgArr, background: bgArr, flags }
}
