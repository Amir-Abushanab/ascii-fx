import { describe, expect, it } from 'vitest'
import type { ColorMode, RawImage, StructuralCells } from '@ascii-fx/core'
import { matchBand, reduceSource } from '@ascii-fx/core'
import { randomImage, sweepProfile } from './synthetic.js'

const profile = sweepProfile(95, 11)
const COLUMNS = 24
const ROWS = 16

const reduce = (img: RawImage): Uint8Array => reduceSource(img, COLUMNS, ROWS, true)
const opts = (color: ColorMode) => ({ profile, color, alpha: 'ignore' as const })
const run = (reduced: Uint8Array, color: ColorMode, reuse?: Parameters<typeof matchBand>[4]) =>
  matchBand(reduced, COLUMNS, ROWS, opts(color), reuse)

const expectSameCells = (a: StructuralCells, b: StructuralCells): void => {
  expect(a.glyphIds).toEqual(b.glyphIds)
  expect(a.flags).toEqual(b.flags)
  expect(a.foreground).toEqual(b.foreground)
  expect(a.background).toEqual(b.background)
}

/** Copy `patch` over the top-left region of `base`, leaving the rest untouched. */
const patched = (base: RawImage, patch: RawImage, w: number, h: number): RawImage => {
  const data = new Uint8Array(base.data)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = (y * base.width + x) * 4
      const s = (y * patch.width + x) * 4
      data[d] = patch.data[s]
      data[d + 1] = patch.data[s + 1]
      data[d + 2] = patch.data[s + 2]
      data[d + 3] = patch.data[s + 3]
    }
  }
  return { width: base.width, height: base.height, data }
}

const frameA = randomImage(COLUMNS * 8, ROWS * 8, 21)
const frameB = randomImage(COLUMNS * 8, ROWS * 8, 22)

describe('exact temporal reuse (spec §21)', () => {
  for (const color of ['mono', 'foreground', 'full'] as const) {
    describe(color, () => {
      it('an unchanged frame reuses every cell and lands on the same bytes', () => {
        const reduced = reduce(frameA)
        const first = run(reduced, color)
        const second = run(reduced, color, { reduced, cells: first })
        expectSameCells(second, first)
      })

      it('a partly changed frame equals a full match of it', () => {
        const oldReduced = reduce(frameA)
        const first = run(oldReduced, color)
        // A quarter of the frame moves; the rest is byte-identical.
        const next = patched(frameA, frameB, COLUMNS * 4, ROWS * 4)
        const newReduced = reduce(next)
        expectSameCells(
          run(newReduced, color, { reduced: oldReduced, cells: first }),
          run(newReduced, color),
        )
      })

      it('a fully changed frame equals a full match of it', () => {
        const oldReduced = reduce(frameA)
        const first = run(oldReduced, color)
        const newReduced = reduce(frameB)
        expectSameCells(
          run(newReduced, color, { reduced: oldReduced, cells: first }),
          run(newReduced, color),
        )
      })
    })
  }

  it('really skips — a doctored cache comes back out unmatched', () => {
    // If the cells were being recomputed rather than copied, the poisoned glyph
    // would be overwritten and this would fail.
    const reduced = reduce(frameA)
    const first = run(reduced, 'full')
    const poisoned: StructuralCells = {
      glyphIds: new Uint16Array(first.glyphIds),
      flags: new Uint16Array(first.flags),
      foreground: new Uint32Array(first.foreground!),
      background: new Uint32Array(first.background!),
    }
    poisoned.glyphIds[0] = (first.glyphIds[0] + 7) % profile.glyphCount
    const out = run(reduced, 'full', { reduced, cells: poisoned })
    expect(out.glyphIds[0]).toBe(poisoned.glyphIds[0])
    expect(out.glyphIds[0]).not.toBe(first.glyphIds[0])
    // and only that cell differs — the rest still reused faithfully
    expect(out.glyphIds.slice(1)).toEqual(first.glyphIds.slice(1))
  })

  it('a one-byte change re-matches exactly that cell', () => {
    const reduced = reduce(frameA)
    const first = run(reduced, 'full')
    const nudged = new Uint8Array(reduced)
    const cell = 5 * COLUMNS + 9
    // sample 0 of that cell, red channel
    const at = (5 * 8 * COLUMNS * 8 + 9 * 8) * 4
    nudged[at] = nudged[at] ^ 0xff
    const out = run(nudged, 'full', { reduced, cells: first })
    expectSameCells(out, run(nudged, 'full'))
    let differing = 0
    for (let i = 0; i < out.glyphIds.length; i++) {
      if (out.foreground![i] !== first.foreground![i] || out.glyphIds[i] !== first.glyphIds[i])
        differing++
    }
    expect(differing).toBeLessThanOrEqual(1)
    expect(out.foreground![cell] === first.foreground![cell] && differing === 1).toBe(false)
  })

  it('checks the shapes it is handed', () => {
    const reduced = reduce(frameA)
    const cells = run(reduced, 'full')
    expect(() => run(reduced, 'full', { reduced: reduced.slice(0, 64), cells })).toThrow(
      /reuse\.reduced has/,
    )
    expect(() =>
      run(reduced, 'full', { reduced, cells: { ...cells, glyphIds: new Uint16Array(3) } }),
    ).toThrow(/reuse\.cells holds/)
    expect(() =>
      run(reduced, 'full', { reduced, cells: { ...cells, foreground: undefined } }),
    ).toThrow(/no foreground/)
    expect(() =>
      run(reduced, 'full', { reduced, cells: { ...cells, background: undefined } }),
    ).toThrow(/no background/)
  })
})
