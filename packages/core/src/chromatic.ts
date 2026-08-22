import type { MatchOptions, RawImage } from './types.js'
import { FLAG_TRANSPARENT } from './types.js'
import { rdiv } from './util.js'
import { reduceSource } from './reduce.js'
import { AsciiFrame } from './frame.js'
import { blankGlyphId } from './blankGlyph.js'
import { deriveGrid } from './grid.js'

export const CHROMATIC_VERSION = 'chromatic-v1'

/**
 * chromatic-v1 reference matcher (ALGORITHM.md §C). Deterministic and
 * all-integer; like structural-v1 this implementation defines correctness for
 * every backend.
 *
 * It is a different algorithm rather than an approximation of structural-v1.
 * structural-v1 matches a 1-bit mask and *fits* colour to it, which is why a
 * free foreground and background make its rerank exact. A colour glyph's colour
 * is baked, so there is nothing to fit: the objective is direct squared error
 * between the cell's 64 reduced samples and the glyph's own, composited over
 * the backdrop it will be drawn on. That removes the flat path (§6), polarity
 * (§8), and the candidate prefilter (§9) — measurements showed a shortlist over
 * a curated palette costs more quality than it saves time.
 */
export function matchFrameChromatic(source: RawImage, options: MatchOptions): AsciiFrame {
  const profile = options.profile
  const chromatic = profile.chromatic
  if (!chromatic) {
    throw new Error(
      `Profile ${profile.id} carries no chromatic glyph data. ` +
        'Compile it with `chromatic: true` to use `matcher: "chromatic"`.',
    )
  }
  const alphaMode = options.alpha ?? 'mask'
  const bd = options.background ?? [0, 0, 0]
  const hysteresis = options.hysteresis ?? 0
  const previous = options.previous

  const { columns, rows } = deriveGrid(
    source.width,
    source.height,
    profile,
    options.columns,
    options.rows,
  )
  const SW = columns * 8
  const reduced = reduceSource(source, columns, rows, alphaMode === 'ignore')

  const N = columns * rows
  const G = profile.glyphCount
  const glyphIds = new Uint16Array(N)
  const flags = new Uint16Array(N)
  const blank = blankGlyphId(profile)

  if (previous !== undefined && previous.length !== N) {
    throw new Error(
      `options.previous has ${previous.length} cells but this frame has ${N} (${columns}×${rows}). ` +
        'Hysteresis needs the previous frame on the same grid.',
    )
  }

  // §C3 backdrop composite. Done once per frame, not once per candidate: the
  // glyph table is fixed and only the backdrop varies, so hoisting it here
  // costs G·64 against the cells·G·64 of the search. A real-time backend
  // should hoist it further, recomputing only when the backdrop changes.
  const recon = new Uint8Array(G * 192)
  const src = chromatic.samples
  for (let g = 0; g < G; g++) {
    for (let k = 0; k < 64; k++) {
      const p = g * 256 + k * 4
      const a = src[p + 3]
      const q = g * 192 + k * 3
      recon[q] = rdiv(src[p] * a + bd[0] * (255 - a), 255)
      recon[q + 1] = rdiv(src[p + 1] * a + bd[1] * (255 - a), 255)
      recon[q + 2] = rdiv(src[p + 2] * a + bd[2] * (255 - a), 255)
    }
  }

  // Per-frame scratch; nothing allocates per cell.
  const sr = new Uint8Array(64)
  const sg = new Uint8Array(64)
  const sb = new Uint8Array(64)

  /** §C4 objective. Full evaluation, no early exit — used to score an incumbent. */
  const errorOf = (g: number): number => {
    let err = 0
    const base = g * 192
    for (let k = 0; k < 64; k++) {
      const q = base + k * 3
      const dr = sr[k] - recon[q]
      const dg = sg[k] - recon[q + 1]
      const db = sb[k] - recon[q + 2]
      err += dr * dr + dg * dg + db * db
    }
    return err
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const ci = cy * columns + cx

      let sumA = 0
      for (let j = 0; j < 8; j++) {
        let p = ((cy * 8 + j) * SW + cx * 8) * 4
        for (let i = 0; i < 8; i++, p += 4) {
          const k = j * 8 + i
          sr[k] = reduced[p]
          sg[k] = reduced[p + 1]
          sb[k] = reduced[p + 2]
          sumA += reduced[p + 3]
        }
      }

      // Transparent cell (§5), unchanged from structural-v1.
      if (alphaMode === 'mask' && rdiv(sumA, 64) < 128) {
        glyphIds[ci] = blank
        flags[ci] = FLAG_TRANSPARENT
        continue
      }

      // §C4 exhaustive search. Early exit cannot change the winner.
      let best = 0x7fffffff
      let bestG = 0
      for (let g = 0; g < G; g++) {
        let err = 0
        const base = g * 192
        for (let k = 0; k < 64; k++) {
          const q = base + k * 3
          const dr = sr[k] - recon[q]
          const dg = sg[k] - recon[q + 1]
          const db = sb[k] - recon[q + 2]
          err += dr * dr + dg * dg + db * db
          if (err >= best) break
        }
        // Strictly smaller replaces, so ties keep the lower glyph id.
        if (err < best) {
          best = err
          bestG = g
        }
      }

      // §C5 hysteresis. The incumbent may have been early-exited out of the
      // search above, so it is scored in full before the flip is allowed.
      if (previous !== undefined && hysteresis > 0) {
        const inc = previous[ci]
        if (
          inc !== bestG &&
          inc < G &&
          best * 1000 >= errorOf(inc) * (1000 - Math.round(hysteresis * 1000))
        ) {
          bestG = inc
        }
      }

      glyphIds[ci] = bestG
    }
  }

  return new AsciiFrame({ columns, rows, colorMode: 'glyph', glyphIds, flags, profile })
}
