import { describe, expect, it } from 'vitest'
import {
  compositeFrame,
  FLAG_TRANSPARENT,
  matchFrame,
  matchFrameChromatic,
  subsetProfile,
} from '@ascii-fx/core'
import { STANDARD_SIX, makeCell, makeChromaticProfile, makeProfile, solid } from './synthetic.js'

// Deliberately not equally spaced: red sits nearer black than green does, so a
// bug that compares the wrong channel shows up as a wrong winner rather than a tie.
const palette = makeChromaticProfile([
  solid(' ', 0, 0, 0, 0), // fully transparent — the blank glyph
  solid('🟥', 200, 20, 20),
  solid('🟩', 20, 200, 20),
  solid('🟦', 20, 20, 200),
  solid('⬜', 240, 240, 240),
])

const flat = (r: number, g: number, b: number, a = 255) => makeCell(() => [r, g, b, a])

describe('chromatic-v1 matcher', () => {
  it('picks the glyph whose baked colour is nearest', () => {
    for (const [rgb, expected] of [
      [[190, 30, 30], 1],
      [[30, 190, 30], 2],
      [[30, 30, 190], 3],
      [[250, 250, 250], 4],
    ] as const) {
      const frame = matchFrame(flat(...rgb), {
        profile: palette,
        columns: 1,
        rows: 1,
        matcher: 'chromatic',
      })
      expect(frame.getCell(0, 0).glyphId).toBe(expected)
    }
  })

  it('emits colorMode "glyph" and no colour planes — the colour is in the glyph', () => {
    const frame = matchFrame(flat(190, 30, 30), {
      profile: palette,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
    })
    expect(frame.colorMode).toBe('glyph')
    expect(frame.foreground).toBeUndefined()
    expect(frame.background).toBeUndefined()
  })

  it('composites glyph alpha over the backdrop, so the backdrop changes the winner', () => {
    // A half-transparent white glyph reads as mid-grey on black and as white on white.
    const p = makeChromaticProfile([solid('a', 255, 255, 255, 128), solid('b', 128, 128, 128)])
    const onBlack = matchFrame(flat(128, 128, 128), {
      profile: p,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
      background: [0, 0, 0],
    })
    // Over black the alpha-128 white composites to ~128, tying with the solid grey
    // and winning on lower id.
    expect(onBlack.getCell(0, 0).glyphId).toBe(0)
    const onWhite = matchFrame(flat(128, 128, 128), {
      profile: p,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
      background: [255, 255, 255],
    })
    // Over white it composites to ~255, so the solid grey now wins.
    expect(onWhite.getCell(0, 0).glyphId).toBe(1)
  })

  it('ties keep the lower glyph id', () => {
    const p = makeChromaticProfile([solid('a', 100, 100, 100), solid('b', 100, 100, 100)])
    const frame = matchFrame(flat(100, 100, 100), {
      profile: p,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
    })
    expect(frame.getCell(0, 0).glyphId).toBe(0)
  })

  it('flags a transparent cell and emits the blank glyph', () => {
    const frame = matchFrame(flat(200, 20, 20, 0), {
      profile: palette,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
    })
    const cell = frame.getCell(0, 0)
    expect(cell.flags & FLAG_TRANSPARENT).toBe(FLAG_TRANSPARENT)
    expect(cell.glyphId).toBe(0)
  })

  it('alpha: ignore matches a transparent cell on its colour instead', () => {
    const frame = matchFrame(flat(200, 20, 20, 0), {
      profile: palette,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
      alpha: 'ignore',
    })
    expect(frame.getCell(0, 0).flags).toBe(0)
    expect(frame.getCell(0, 0).glyphId).toBe(1)
  })

  it('matches sub-cell structure, not just the mean', () => {
    // Left half red, right half blue. A mean-colour matcher would pick something
    // purple; the structural objective has no such glyph and must split the cost.
    const split = makeChromaticProfile([
      solid('r', 200, 20, 20),
      solid('b', 20, 20, 200),
      { char: 'x', at: (i) => (i < 4 ? [200, 20, 20] : [20, 20, 200]) },
    ])
    const source = makeCell((i) => (i < 4 ? [200, 20, 20] : [20, 20, 200]))
    const frame = matchFrame(source, { profile: split, columns: 1, rows: 1, matcher: 'chromatic' })
    expect(frame.getCell(0, 0).glyphId).toBe(2)
  })

  describe('hysteresis', () => {
    const nearTie = makeChromaticProfile([solid('a', 100, 100, 100), solid('b', 104, 104, 104)])
    const source = flat(103, 103, 103) // 'b' wins outright

    it('is off by default', () => {
      const frame = matchFrame(source, {
        profile: nearTie,
        columns: 1,
        rows: 1,
        matcher: 'chromatic',
      })
      expect(frame.getCell(0, 0).glyphId).toBe(1)
    })

    it('keeps an incumbent the challenger only narrowly beats', () => {
      const frame = matchFrame(source, {
        profile: nearTie,
        columns: 1,
        rows: 1,
        matcher: 'chromatic',
        previous: new Uint16Array([0]),
        hysteresis: 0.9,
      })
      expect(frame.getCell(0, 0).glyphId).toBe(0)
    })

    it('still flips when the challenger wins by more than the margin', () => {
      const frame = matchFrame(flat(240, 240, 240), {
        profile: palette,
        columns: 1,
        rows: 1,
        matcher: 'chromatic',
        previous: new Uint16Array([1]),
        hysteresis: 0.1,
      })
      expect(frame.getCell(0, 0).glyphId).toBe(4)
    })

    it('rejects a previous frame from a different grid', () => {
      expect(() =>
        matchFrame(source, {
          profile: nearTie,
          columns: 2,
          rows: 2,
          matcher: 'chromatic',
          previous: new Uint16Array([0]),
          hysteresis: 0.5,
        }),
      ).toThrow(/previous/)
    })
  })

  describe('guards', () => {
    it('refuses a profile with no chromatic data', () => {
      expect(() =>
        matchFrame(flat(10, 10, 10), {
          profile: makeProfile(STANDARD_SIX),
          columns: 1,
          rows: 1,
          matcher: 'chromatic',
        }),
      ).toThrow(/no chromatic glyph data/)
    })

    it("refuses color: 'glyph' on the mask-fitting matchers", () => {
      const p = makeProfile(STANDARD_SIX)
      for (const matcher of ['structural', 'shape6', 'ramp'] as const) {
        expect(() =>
          matchFrame(flat(10, 10, 10), {
            profile: p,
            columns: 1,
            rows: 1,
            color: 'glyph',
            matcher,
          }),
        ).toThrow(/chromatic/)
      }
    })
  })

  it('matchFrameChromatic is reachable directly and agrees with the dispatcher', () => {
    const opts = { profile: palette, columns: 3, rows: 3 } as const
    const direct = matchFrameChromatic(flat(30, 190, 30), opts)
    const dispatched = matchFrame(flat(30, 190, 30), { ...opts, matcher: 'chromatic' })
    expect([...direct.glyphIds]).toEqual([...dispatched.glyphIds])
  })
})

describe('compositing chromatic-v1 frames', () => {
  const p = makeChromaticProfile([
    solid('r', 200, 20, 20),
    solid('b', 20, 20, 200),
    solid('h', 255, 255, 255, 128),
  ])

  it('draws the glyph colour rather than tinting coverage', () => {
    const frame = matchFrame(flat(190, 30, 30), {
      profile: p,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
    })
    const img = compositeFrame(frame, { background: [0, 0, 0] })
    expect([img.data[0], img.data[1], img.data[2], img.data[3]]).toEqual([200, 20, 20, 255])
  })

  it('composites glyph alpha over the backdrop with the matcher rule', () => {
    const frame = matchFrame(flat(128, 128, 128), {
      profile: p,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
      background: [0, 0, 0],
    })
    expect(frame.getCell(0, 0).glyphId).toBe(2)
    const img = compositeFrame(frame, { background: [0, 0, 0] })
    // rdiv(255 * 128 + 0 * 127, 255) = 128
    expect([img.data[0], img.data[1], img.data[2], img.data[3]]).toEqual([128, 128, 128, 255])
  })

  it('keeps straight alpha when the backdrop is transparent', () => {
    const frame = matchFrame(flat(128, 128, 128), {
      profile: p,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
      background: [0, 0, 0],
    })
    const img = compositeFrame(frame, { background: null })
    expect([img.data[0], img.data[1], img.data[2], img.data[3]]).toEqual([255, 255, 255, 128])
  })

  it('refuses to draw a chromatic frame whose profile has no RGBA atlas', () => {
    const stripped = { ...p, atlas: { ...p.atlas, rgba: undefined } }
    const frame = matchFrame(flat(190, 30, 30), {
      profile: stripped,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
    })
    expect(() => compositeFrame(frame)).toThrow(/no RGBA atlas/)
  })
})

describe('narrowing a chromatic palette', () => {
  const p = makeChromaticProfile([
    solid('r', 200, 20, 20),
    solid('g', 20, 200, 20),
    solid('b', 20, 20, 200),
    solid('w', 240, 240, 240),
  ])

  it('carries chromatic samples and the RGBA atlas through a subset', () => {
    const sub = subsetProfile(p, ['b', 'r'])
    expect(sub.chromatic).toBeDefined()
    expect(sub.atlas.rgba).toBeDefined()
    // Order follows the requested list, so ids are remapped, not preserved.
    expect(sub.glyphs).toEqual(['b', 'r'])
    expect(sub.chromatic!.samples.subarray(0, 3)).toEqual(
      p.chromatic!.samples.subarray(2 * 256, 2 * 256 + 3),
    )
    expect(sub.chromatic!.samples.subarray(256, 259)).toEqual(p.chromatic!.samples.subarray(0, 3))
  })

  it('keeps the atlas and the descriptors in lockstep after repacking', () => {
    const sub = subsetProfile(p, ['w', 'g'])
    // What the matcher scores and what the compositor draws must be the same glyph.
    for (let id = 0; id < sub.glyphCount; id++) {
      const frame = matchFrame(
        makeCell(() => [
          sub.chromatic!.samples[id * 256],
          sub.chromatic!.samples[id * 256 + 1],
          sub.chromatic!.samples[id * 256 + 2],
        ]),
        { profile: sub, columns: 1, rows: 1, matcher: 'chromatic' },
      )
      expect(frame.getCell(0, 0).glyphId).toBe(id)
      const img = compositeFrame(frame, { background: [0, 0, 0] })
      expect([img.data[0], img.data[1], img.data[2]]).toEqual([
        sub.chromatic!.samples[id * 256],
        sub.chromatic!.samples[id * 256 + 1],
        sub.chromatic!.samples[id * 256 + 2],
      ])
    }
  })

  it('stops the matcher reaching for a glyph that was removed', () => {
    const white = flat(240, 240, 240)
    expect(
      matchFrame(white, { profile: p, columns: 1, rows: 1, matcher: 'chromatic' }).getCell(0, 0)
        .glyph,
    ).toBe('w')
    const narrowed = subsetProfile(p, ['r', 'g', 'b'])
    const picked = matchFrame(white, {
      profile: narrowed,
      columns: 1,
      rows: 1,
      matcher: 'chromatic',
    }).getCell(0, 0)
    expect(picked.glyph).not.toBe('w')
    expect(['r', 'g', 'b']).toContain(picked.glyph)
  })
})
