import { describe, expect, it } from 'vitest'
import type { RawImage } from '@ascii-fx/core'
import { createMotionState, isqrt, motionField, reduceSource } from '@ascii-fx/core'
import { mulberry32 } from './synthetic.js'

const COLUMNS = 12
const ROWS = 8
const W = COLUMNS * 8
const H = ROWS * 8

/** Flat grey field, with an optional brighter rectangle in cell coordinates. */
const scene = (
  grey: number,
  box?: { x: number; y: number; w: number; h: number; v: number },
): RawImage => {
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4
      const inBox =
        box !== undefined &&
        x >= box.x * 8 &&
        x < (box.x + box.w) * 8 &&
        y >= box.y * 8 &&
        y < (box.y + box.h) * 8
      const v = inBox ? box.v : grey
      data[p] = v
      data[p + 1] = v
      data[p + 2] = v
      data[p + 3] = 255
    }
  }
  return { width: W, height: H, data }
}

const reduce = (img: RawImage): Uint8Array => reduceSource(img, COLUMNS, ROWS, true)
const at = (f: { magnitude: Uint8Array }, cx: number, cy: number): number =>
  f.magnitude[cy * COLUMNS + cx]

describe('isqrt', () => {
  it('is exact around perfect squares, where a floored float sqrt is not', () => {
    for (const n of [0, 1, 2, 3, 4, 8, 9, 15, 16, 24, 25, 65535, 65536, 4294836225]) {
      const r = isqrt(n)
      expect(r * r).toBeLessThanOrEqual(n)
      expect((r + 1) * (r + 1)).toBeGreaterThan(n)
    }
  })

  it('agrees with a brute-force floor over a dense range', () => {
    for (let n = 0; n < 5000; n++) {
      let r = 0
      while ((r + 1) * (r + 1) <= n) r++
      expect(isqrt(n)).toBe(r)
    }
  })
})

describe('motion field (§22)', () => {
  it('reads nothing on the first frame — there is no previous to differ from', () => {
    const state = createMotionState(COLUMNS, ROWS)
    const field = motionField(
      reduce(scene(40, { x: 2, y: 2, w: 3, h: 2, v: 240 })),
      COLUMNS,
      ROWS,
      state,
    )
    expect(Array.from(field.magnitude).every((v) => v === 0)).toBe(true)
    expect(state.primed).toBe(true)
  })

  it('reads nothing on a still frame', () => {
    const state = createMotionState(COLUMNS, ROWS)
    const still = reduce(scene(40, { x: 2, y: 2, w: 3, h: 2, v: 240 }))
    motionField(still, COLUMNS, ROWS, state)
    const field = motionField(still, COLUMNS, ROWS, state)
    expect(Array.from(field.magnitude).every((v) => v === 0)).toBe(true)
  })

  it('lights the cells that changed and leaves the rest alone', () => {
    const state = createMotionState(COLUMNS, ROWS)
    motionField(reduce(scene(40, { x: 2, y: 2, w: 3, h: 2, v: 240 })), COLUMNS, ROWS, state)
    // The box moves two columns right; the cells it left and the cells it
    // arrived at both changed, and the ones it never touched did not.
    const field = motionField(
      reduce(scene(40, { x: 4, y: 2, w: 3, h: 2, v: 240 })),
      COLUMNS,
      ROWS,
      state,
    )
    expect(at(field, 2, 2)).toBeGreaterThan(0) // vacated
    expect(at(field, 6, 2)).toBeGreaterThan(0) // newly covered
    expect(at(field, 4, 2)).toBe(0) // covered before and after
    expect(at(field, 9, 6)).toBe(0) // never touched
  })

  it('leaves a wake that decays to nothing rather than smearing forever', () => {
    const state = createMotionState(COLUMNS, ROWS)
    const before = reduce(scene(40, { x: 2, y: 2, w: 3, h: 2, v: 240 }))
    const after = reduce(scene(40, { x: 4, y: 2, w: 3, h: 2, v: 240 }))
    motionField(before, COLUMNS, ROWS, state)
    const moved = at(motionField(after, COLUMNS, ROWS, state), 2, 2)
    expect(moved).toBeGreaterThan(0)

    // Hold the frame still and watch the vacated cell fade out.
    const trail: number[] = []
    for (let i = 0; i < 80; i++) trail.push(at(motionField(after, COLUMNS, ROWS, state), 2, 2))
    expect(trail[0]).toBeLessThan(moved)
    for (let i = 1; i < trail.length; i++) expect(trail[i]).toBeLessThanOrEqual(trail[i - 1])
    expect(trail.at(-1)).toBe(0)
  })

  it('a lower decay is a shorter wake', () => {
    const before = reduce(scene(40, { x: 2, y: 2, w: 3, h: 2, v: 240 }))
    const after = reduce(scene(40, { x: 4, y: 2, w: 3, h: 2, v: 240 }))
    const framesToZero = (decay: number): number => {
      const state = createMotionState(COLUMNS, ROWS)
      motionField(before, COLUMNS, ROWS, state, { decay })
      motionField(after, COLUMNS, ROWS, state, { decay })
      let n = 0
      while (at(motionField(after, COLUMNS, ROWS, state, { decay }), 2, 2) > 0 && n < 500) n++
      return n
    }
    expect(framesToZero(0.4)).toBeLessThan(framesToZero(0.9))
  })

  it('thresholds out drift that a zero threshold would pass', () => {
    // Per-pixel grain never gets this far — reduce-v1 averages 64 samples per
    // cell, so ±2 of it moves the mean luma by less than one unit. What the
    // threshold is actually for is cell-level drift: exposure hunting, a
    // compressor re-quantizing a flat wall. So that is what this shifts.
    const rnd = mulberry32(7)
    const base = scene(128)
    const drifted: RawImage = { width: W, height: H, data: new Uint8Array(base.data) }
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLUMNS; cx++) {
        const shift = Math.round((rnd() - 0.5) * 6) // ±3, under the default ≈5
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 8; i++) {
            const p = ((cy * 8 + j) * W + cx * 8 + i) * 4
            const v = Math.max(0, Math.min(255, 128 + shift))
            drifted.data[p] = v
            drifted.data[p + 1] = v
            drifted.data[p + 2] = v
          }
        }
      }
    }

    const quiet = createMotionState(COLUMNS, ROWS)
    motionField(reduce(base), COLUMNS, ROWS, quiet)
    const thresholded = motionField(reduce(drifted), COLUMNS, ROWS, quiet)
    expect(Array.from(thresholded.magnitude).every((v) => v === 0)).toBe(true)

    const raw = createMotionState(COLUMNS, ROWS)
    motionField(reduce(base), COLUMNS, ROWS, raw, { threshold: 0 })
    const unthresholded = motionField(reduce(drifted), COLUMNS, ROWS, raw, { threshold: 0 })
    expect(Array.from(unthresholded.magnitude).some((v) => v > 0)).toBe(true)
  })

  it('per-pixel grain does not reach the field at all', () => {
    const rnd = mulberry32(11)
    const base = scene(128)
    const grainy: RawImage = { width: W, height: H, data: new Uint8Array(base.data) }
    for (let i = 0; i < W * H; i++) {
      const d = Math.round((rnd() - 0.5) * 8) // ±4 per pixel, uncorrelated
      const v = Math.max(0, Math.min(255, 128 + d))
      grainy.data[i * 4] = v
      grainy.data[i * 4 + 1] = v
      grainy.data[i * 4 + 2] = v
    }
    // Even with the threshold off, averaging 64 samples leaves nothing to see.
    const state = createMotionState(COLUMNS, ROWS)
    motionField(reduce(base), COLUMNS, ROWS, state, { threshold: 0 })
    const field = motionField(reduce(grainy), COLUMNS, ROWS, state, { threshold: 0 })
    expect(Array.from(field.magnitude).every((v) => v === 0)).toBe(true)
  })

  it('is deterministic and stays in range', () => {
    const frames = [
      reduce(scene(40, { x: 1, y: 1, w: 2, h: 2, v: 200 })),
      reduce(scene(40, { x: 3, y: 1, w: 2, h: 2, v: 200 })),
      reduce(scene(90, { x: 5, y: 4, w: 4, h: 3, v: 10 })),
    ]
    const run = (): number[] => {
      const state = createMotionState(COLUMNS, ROWS)
      const out: number[] = []
      for (const f of frames) out.push(...motionField(f, COLUMNS, ROWS, state).magnitude)
      return out
    }
    const a = run()
    expect(a).toEqual(run())
    expect(a.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true)
  })

  it('refuses a state that describes a different grid', () => {
    const state = createMotionState(COLUMNS, ROWS)
    expect(() => motionField(reduce(scene(40)), COLUMNS + 1, ROWS, state)).toThrow(
      /motion state is/,
    )
  })
})
