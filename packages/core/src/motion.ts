import type { MotionOptions } from './types.js'
import { luma8 } from './color.js'
import { rdiv } from './util.js'

/**
 * Per-cell motion field (ALGORITHM.md §21).
 *
 * Integer throughout, like every other path here (§0), so a GPU implementation
 * can agree bit-for-bit instead of drifting. That rules out the float smoothstep
 * and sqrt the effect is usually written with; both are done in fixed point
 * below, and the integer square root is the adjusted kind so a shader's
 * imprecise `sqrt` lands on the same value.
 */
export interface MotionField {
  columns: number
  rows: number
  /** Per-cell 0..255: 0 still, 255 moving hard. Row-major, `columns · rows`. */
  magnitude: Uint8Array
}

/**
 * Retained state for a motion field: the previous frame's per-cell mean luma and
 * the decaying trail. Band-local, and the caller owns keeping it with the band
 * it describes — the same contract `BandReuse` carries.
 */
export interface MotionState {
  columns: number
  rows: number
  luma: Uint8Array
  trail: Uint8Array
  primed: boolean
}

export function createMotionState(columns: number, rows: number): MotionState {
  const n = columns * rows
  return { columns, rows, luma: new Uint8Array(n), trail: new Uint8Array(n), primed: false }
}

/**
 * floor(sqrt(n)) for n ≥ 0, exact.
 *
 * `Math.sqrt` is correctly rounded and WGSL's is not, so neither can be floored
 * and trusted near a perfect square. The adjustment makes both exact from any
 * starting estimate that is close, which is what lets the two implementations
 * agree.
 */
export function isqrt(n: number): number {
  if (n <= 0) return 0
  let r = Math.floor(Math.sqrt(n))
  while ((r + 1) * (r + 1) <= n) r++
  while (r * r > n) r--
  return r
}

const ONE = 65535

/** 0..255 option → 0..255 integer, which is what the field is actually defined on. */
const quantize = (v: number, fallback: number): number => {
  const q = Math.round((v ?? fallback) * 255)
  return q < 0 ? 0 : q > 255 ? 255 : q
}

/**
 * Advance `state` by one frame of reduced samples and return the field.
 *
 * `reduced` is reduce-v1 output (§4) for this band: `columns · 8` by `rows · 8`
 * RGBA samples. Cells are read exactly as §5 reads them, so the motion field is
 * defined over the same mean luma the matcher already computes — it just is not
 * emitted there, and deriving it here keeps structural-v1 and its conformance
 * contract untouched.
 */
export function motionField(
  reduced: Uint8Array,
  columns: number,
  rows: number,
  state: MotionState,
  options: MotionOptions = {},
): MotionField {
  if (state.columns !== columns || state.rows !== rows)
    throw new Error(
      `motion state is ${state.columns}×${state.rows}; this field is ${columns}×${rows}.`,
    )

  // A threshold of 0 would put the smoothstep's two edges on top of each other.
  const T = Math.max(1, quantize(options.threshold ?? 0.02, 0.02))
  const decay = quantize(options.decay ?? 0.85, 0.85)
  const magnitude = new Uint8Array(columns * rows)
  const SW = columns * 8

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const ci = cy * columns + cx

      let sumL = 0
      for (let j = 0; j < 8; j++) {
        let p = ((cy * 8 + j) * SW + cx * 8) * 4
        for (let i = 0; i < 8; i++, p += 4) {
          sumL += luma8(reduced[p], reduced[p + 1], reduced[p + 2])
        }
      }
      const meanL = rdiv(sumL, 64)

      // An unprimed state has no previous frame, so nothing has moved yet —
      // without this the first frame reads as motion everywhere.
      const delta = state.primed ? Math.abs(meanL - state.luma[ci]) : 0

      // smoothstep(T, 4T, delta) in 16-bit fixed point, then a square-root lift
      // so subtle movement is visible rather than crushed against zero.
      let t = rdiv((delta - T) * ONE, 3 * T)
      if (t < 0) t = 0
      else if (t > ONE) t = ONE
      const s = rdiv(t * t * (3 * ONE - 2 * t), ONE * ONE)
      const amount = isqrt(s * ONE) >> 8

      // The wake: the trail falls off geometrically with a constant floor, so it
      // reaches zero instead of asymptoting to a permanent dim smear.
      const decayed = Math.max(rdiv(state.trail[ci] * decay, 255) - 6, 0)
      const trail = Math.max(decayed, amount)

      state.luma[ci] = meanL
      state.trail[ci] = trail
      magnitude[ci] = trail
    }
  }

  state.primed = true
  return { columns, rows, magnitude }
}
