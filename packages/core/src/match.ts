import type { MatchOptions, RawImage } from './types.js'
import { FLAG_FLAT, FLAG_TRANSPARENT } from './types.js'
import { popcount32, rdiv } from './util.js'
import { luma8, packRGBA } from './color.js'
import { reduceSource } from './reduce.js'
import { AsciiFrame } from './frame.js'
import { blankGlyphId } from './blankGlyph.js'
import { deriveGrid } from './grid.js'
import { jitterHash } from './jitter.js'

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

/** The function each non-structural matcher moved to when `matchFrame` stopped dispatching. */
const MOVED: Record<string, string> = {
  shape6: 'matchFrameShape6',
  ramp: 'matchFrameRamp',
  chromatic: 'matchFrameChromatic',
}

/**
 * structural-v1 reference matcher (ALGORITHM.md §§3–11). Deterministic and
 * all-integer; this implementation defines correctness for every backend.
 *
 * Structural only. The approximate matchers (§18–19) and chromatic-v1 are their
 * own functions — `matchFrameShape6`, `matchFrameRamp`, `matchFrameChromatic` —
 * so a bundle that never calls them never contains them, and opting into one is
 * an import rather than a flag.
 */
export function matchFrame(source: RawImage, options: MatchOptions): AsciiFrame {
  const profile = options.profile
  if (!profile)
    throw new Error('matchFrame requires options.profile (build one with @ascii-fx/compiler).')
  // `matcher` left the options in 0.9. Untyped callers still pass it, and quietly running
  // structural-v1 instead of what they asked for would be the silent fallback §11 rules out.
  const legacy = (options as { matcher?: string }).matcher
  if (legacy !== undefined && legacy !== 'structural') {
    throw new Error(
      `matchFrame is structural-v1 only; for matcher: '${legacy}' call ` +
        `${MOVED[legacy] ?? 'the matcher function'}(source, options) from @ascii-fx/core instead.`,
    )
  }
  if (options.color === 'glyph') {
    throw new Error(
      "color: 'glyph' is produced by matchFrameChromatic; matchFrame fits colour to a mask.",
    )
  }

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
  // r² + g² + b² per sample, for the closed-form rerank error (§10).
  const sq = new Int32Array(64)
  const candId = new Int32Array(8)
  const candScore = new Int32Array(8)
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
      let sumQ = 0
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
          const q = r * r + g * g + b * b
          sq[k] = q
          sumQ += q
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
      //
      // The error is evaluated in closed form rather than sample by sample. For a set S
      // of samples drawn in one colour c, Σ(s − c)² = Σs² − 2c·Σs + |S|·c² — an integer
      // identity, so with c the already-rounded fitted colour this is the same number the
      // 64-sample sum produces, bit for bit (peak 64·3·255² = 12,484,800). That leaves
      // one pass per candidate, over whichever side of its mask has fewer samples; the
      // other side is the cell totals minus it.
      let bestErr = 0x7fffffff
      let bestId = candId[0]
      let bestFg = 0
      let bestBg = 0
      for (let c = 0; c < count; c++) {
        const g = candId[c]
        const gLo = masksLo[g]
        const gHi = masksHi[g]
        const iN = popcount32(gLo) + popcount32(gHi)
        const oN = 64 - iN
        const flip = iN > 32
        let aR = 0
        let aG = 0
        let aB = 0
        let aQ = 0
        let m = flip ? ~gLo : gLo | 0
        while (m !== 0) {
          const t = m & -m
          const k = 31 - Math.clz32(t)
          aR += sr[k]
          aG += sg[k]
          aB += sb[k]
          aQ += sq[k]
          m ^= t
        }
        m = flip ? ~gHi : gHi | 0
        while (m !== 0) {
          const t = m & -m
          const k = 63 - Math.clz32(t)
          aR += sr[k]
          aG += sg[k]
          aB += sb[k]
          aQ += sq[k]
          m ^= t
        }
        const iR = flip ? sumR - aR : aR
        const iG = flip ? sumG - aG : aG
        const iB = flip ? sumB - aB : aB
        const iQ = flip ? sumQ - aQ : aQ
        const oR = sumR - iR
        const oG = sumG - iG
        const oB = sumB - iB
        const oQ = sumQ - iQ

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
        } else if (full) {
          const hasInk = iN > 0
          const hasOff = oN > 0
          fR = hasInk ? rdiv(iR, iN) : rdiv(oR, oN)
          fG = hasInk ? rdiv(iG, iN) : rdiv(oG, oN)
          fB = hasInk ? rdiv(iB, iN) : rdiv(oB, oN)
          bR = hasOff ? rdiv(oR, oN) : fR
          bG = hasOff ? rdiv(oG, oN) : fG
          bB = hasOff ? rdiv(oB, oN) : fB
        } else {
          fR = iN > 0 ? rdiv(iR, iN) : bgOpt[0]
          fG = iN > 0 ? rdiv(iG, iN) : bgOpt[1]
          fB = iN > 0 ? rdiv(iB, iN) : bgOpt[2]
          bR = bgOpt[0]
          bG = bgOpt[1]
          bB = bgOpt[2]
        }
        const err =
          iQ -
          2 * (fR * iR + fG * iG + fB * iB) +
          iN * (fR * fR + fG * fG + fB * fB) +
          (oQ - 2 * (bR * oR + bG * oG + bB * oB) + oN * (bR * bR + bG * bG + bB * bB))
        // jitter-v1 weights every candidate, so it carries each one's error and colours
        // out of the loop, not just the winner's.
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
