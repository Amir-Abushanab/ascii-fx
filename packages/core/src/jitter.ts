/**
 * Cell hash for jitter-v1 (ALGORITHM.md §20).
 *
 * Integer-only (§0) and expressed in operations a shader has too, so a GPU
 * backend can reproduce it exactly rather than approximate it. The row is
 * frame-global, not band-local, which is what keeps a band-split match
 * byte-identical to a whole-frame one.
 */
export function jitterHash(cx: number, cy: number, seed: number): number {
  let h = (seed ^ Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cy, 0x165667b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
