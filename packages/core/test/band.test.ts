import { describe, expect, it } from 'vitest'
import type { AlphaMode, ColorMode, RawImage } from '@ascii-fx/core'
import { bandSourceRows, matchBand, matchFrame, reduceBand, reduceSource } from '@ascii-fx/core'
import { randomImage, randomProfile } from './synthetic.js'

const profile = randomProfile(48, 7)

/** Split [0, rows) into `n` bands the way the worker pool does. */
const bands = (rows: number, n: number): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  const per = Math.ceil(rows / n)
  for (let r = 0; r < rows; r += per) out.push([r, Math.min(rows, r + per)])
  return out
}

/** Reduce + match a band from its own strip, as the worker does. */
const runBand = (
  source: RawImage,
  columns: number,
  rows: number,
  rowStart: number,
  rowEnd: number,
  color: ColorMode,
  alpha: AlphaMode,
) => {
  const { y0, y1 } = bandSourceRows(source.height, rows, rowStart, rowEnd)
  const strip = source.data.slice(y0 * source.width * 4, y1 * source.width * 4)
  const reduced = reduceBand(
    {
      width: source.width,
      height: y1 - y0,
      sourceHeight: source.height,
      yOffset: y0,
      data: strip,
    },
    columns,
    rows,
    alpha === 'ignore',
    rowStart,
    rowEnd,
  )
  return matchBand(reduced, columns, rowEnd - rowStart, { profile, color, alpha })
}

describe('band decomposition', () => {
  it('reduceBand over a strip equals the same region of a whole-frame reduce', () => {
    const source = randomImage(157, 91, 3, true)
    const columns = 19
    const rows = 11
    const whole = reduceSource(source, columns, rows, false)
    const SW = columns * 8
    for (const [r0, r1] of bands(rows, 4)) {
      const { y0, y1 } = bandSourceRows(source.height, rows, r0, r1)
      const band = reduceBand(
        {
          width: source.width,
          height: y1 - y0,
          sourceHeight: source.height,
          yOffset: y0,
          data: source.data.slice(y0 * source.width * 4, y1 * source.width * 4),
        },
        columns,
        rows,
        false,
        r0,
        r1,
      )
      expect(band).toEqual(whole.subarray(r0 * 8 * SW * 4, r1 * 8 * SW * 4))
    }
  })

  it('the strip a band asks for never runs past the image', () => {
    const rows = 11
    for (const [r0, r1] of bands(rows, 4)) {
      const { y0, y1 } = bandSourceRows(91, rows, r0, r1)
      expect(y0).toBeGreaterThanOrEqual(0)
      expect(y1).toBeLessThanOrEqual(91)
      expect(y1).toBeGreaterThan(y0)
    }
  })

  // The exactness contract: a banded match is the same bytes as a whole-frame
  // one, or the worker backend is not the CPU backend.
  for (const color of ['mono', 'foreground', 'full'] as const) {
    for (const alpha of ['mask', 'ignore'] as const) {
      it(`banded match is byte-identical to matchFrame (${color}/${alpha})`, () => {
        // 157×91 into a 19×11 grid: neither axis divides evenly, and 11 rows
        // over 4 bands leaves a short last band.
        const source = randomImage(157, 91, 5, true)
        const columns = 19
        const rows = 11
        const whole = matchFrame(source, { profile, columns, rows, color, alpha })

        for (const n of [1, 2, 3, 4, 7, 11]) {
          const glyphIds = new Uint16Array(columns * rows)
          const flags = new Uint16Array(columns * rows)
          const fg = new Uint32Array(columns * rows)
          const bg = new Uint32Array(columns * rows)
          for (const [r0, r1] of bands(rows, n)) {
            const cells = runBand(source, columns, rows, r0, r1, color, alpha)
            glyphIds.set(cells.glyphIds, r0 * columns)
            flags.set(cells.flags, r0 * columns)
            if (cells.foreground) fg.set(cells.foreground, r0 * columns)
            if (cells.background) bg.set(cells.background, r0 * columns)
          }
          expect(glyphIds, `${n} bands`).toEqual(whole.glyphIds)
          expect(flags, `${n} bands`).toEqual(whole.flags)
          if (whole.foreground) expect(fg, `${n} bands`).toEqual(whole.foreground)
          if (whole.background) expect(bg, `${n} bands`).toEqual(whole.background)
        }
      })
    }
  }

  it('a single whole-frame band is exactly matchFrame', () => {
    const source = randomImage(64, 64, 9)
    const columns = 8
    const rows = 8
    const whole = matchFrame(source, { profile, columns, rows, color: 'full' })
    const cells = matchBand(reduceSource(source, columns, rows, false), columns, rows, {
      profile,
      color: 'full',
    })
    expect(cells.glyphIds).toEqual(whole.glyphIds)
    expect(cells.foreground).toEqual(whole.foreground)
    expect(cells.background).toEqual(whole.background)
    expect(cells.flags).toEqual(whole.flags)
  })
})
