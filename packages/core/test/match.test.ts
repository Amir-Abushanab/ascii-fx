import { describe, expect, it } from 'vitest'
import type { AsciiProfile, ColorMode, RGB } from '@ascii-fx/core'
import { FLAG_FLAT, FLAG_TRANSPARENT, luma8, matchFrame, rdiv, reduceSource } from '@ascii-fx/core'
import { STANDARD_SIX, makeCell, makeProfile, randomImage, randomProfile } from './synthetic.js'

const profile6 = makeProfile(STANDARD_SIX)
// glyph ids: 0=' ' 1='█' 2='▀' 3='▄' 4='▌' 5='▐'

const topDarkBottomLight = makeCell((_, j) => (j < 4 ? [10, 10, 10] : [240, 240, 240]))

describe('structural-v1 matcher', () => {
  it('full mode reconstructs a half-split cell exactly', () => {
    const frame = matchFrame(topDarkBottomLight, {
      profile: profile6,
      columns: 1,
      rows: 1,
      color: 'full',
    })
    const cell = frame.getCell(0, 0)
    expect(cell.glyphId).toBe(2) // '▀' wins its tie with '▄' by candidate order
    expect(cell.foreground).toEqual([10, 10, 10, 255]) // ink side = top
    expect(cell.background).toEqual([240, 240, 240, 255])
  })

  it('mono default polarity puts ink on the light side', () => {
    const frame = matchFrame(topDarkBottomLight, {
      profile: profile6,
      columns: 1,
      rows: 1,
      color: 'mono',
    })
    expect(frame.getCell(0, 0).glyphId).toBe(3) // '▄'
  })

  it('swapping mono colors flips polarity coherently (no invert flag)', () => {
    const frame = matchFrame(topDarkBottomLight, {
      profile: profile6,
      columns: 1,
      rows: 1,
      color: 'mono',
      foreground: [0, 0, 0],
      background: [255, 255, 255],
    })
    expect(frame.getCell(0, 0).glyphId).toBe(2) // '▀': dark ink where the source is dark
  })

  it('foreground mode derives polarity from the backdrop', () => {
    const frame = matchFrame(topDarkBottomLight, {
      profile: profile6,
      columns: 1,
      rows: 1,
      color: 'foreground',
      background: [255, 255, 255],
    })
    const cell = frame.getCell(0, 0)
    expect(cell.glyphId).toBe(2) // light backdrop ⇒ ink on the dark side
    expect(cell.foreground).toEqual([10, 10, 10, 255])
  })

  it('flat cell in full mode emits blank glyph with fg = bg = mean', () => {
    const frame = matchFrame(
      makeCell(() => [128, 128, 128]),
      { profile: profile6, columns: 1, rows: 1, color: 'full' },
    )
    const cell = frame.getCell(0, 0)
    expect(cell.glyphId).toBe(0)
    expect(cell.flags & FLAG_FLAT).toBe(FLAG_FLAT)
    expect(cell.foreground).toEqual([128, 128, 128, 255])
    expect(cell.background).toEqual([128, 128, 128, 255])
  })

  it('flat cell in mono picks nearest coverage, ties to lowest id', () => {
    // meanLuma 128 → target 32896; coverages [0, 65535, 32768, 32768, 32768, 32768].
    const frame = matchFrame(
      makeCell(() => [128, 128, 128]),
      { profile: profile6, columns: 1, rows: 1, color: 'mono' },
    )
    expect(frame.getCell(0, 0).glyphId).toBe(2) // first glyph at distance 128
    expect(frame.getCell(0, 0).flags & FLAG_FLAT).toBe(FLAG_FLAT)
  })

  it('flat threshold boundary: diff 14 flat, diff 15 structural', () => {
    // luma(g,g,g) = g exactly for the pinned coefficients.
    const flat = matchFrame(
      makeCell((i) => (i < 4 ? [100, 100, 100] : [114, 114, 114])),
      { profile: profile6, columns: 1, rows: 1, color: 'mono' },
    )
    expect(flat.getCell(0, 0).flags & FLAG_FLAT).toBe(FLAG_FLAT)
    const structural = matchFrame(
      makeCell((i) => (i < 4 ? [100, 100, 100] : [115, 115, 115])),
      { profile: profile6, columns: 1, rows: 1, color: 'mono' },
    )
    expect(structural.getCell(0, 0).flags & FLAG_FLAT).toBe(0)
    // Against fixed white-on-black, a dim 100/115 cell reconstructs best as
    // empty — the rerank objective decides, not the Hamming shortlist.
    expect(structural.getCell(0, 0).glyphId).toBe(0)
  })

  it('high-contrast half cells pick the structural glyph', () => {
    const frame = matchFrame(
      makeCell((i) => (i < 4 ? [20, 20, 20] : [235, 235, 235])),
      { profile: profile6, columns: 1, rows: 1, color: 'mono' },
    )
    expect(frame.getCell(0, 0).glyphId).toBe(5) // '▐': ink on the bright right side
  })

  it('transparent cells respect alpha mode', () => {
    const clear = makeCell(() => [200, 50, 50, 0])
    const masked = matchFrame(clear, { profile: profile6, columns: 1, rows: 1, color: 'full' })
    expect(masked.getCell(0, 0).flags & FLAG_TRANSPARENT).toBe(FLAG_TRANSPARENT)
    expect(masked.getCell(0, 0).glyphId).toBe(0)
    const ignored = matchFrame(clear, {
      profile: profile6,
      columns: 1,
      rows: 1,
      color: 'full',
      alpha: 'ignore',
    })
    expect(ignored.getCell(0, 0).flags & FLAG_TRANSPARENT).toBe(0)
  })

  it('is deterministic across repeated runs', () => {
    const img = randomImage(64, 64, 42)
    const a = matchFrame(img, { profile: profile6, columns: 8, color: 'full' })
    const b = matchFrame(img, { profile: profile6, columns: 8, color: 'full' })
    expect(b.glyphIds).toEqual(a.glyphIds)
    expect(b.foreground).toEqual(a.foreground)
    expect(b.background).toEqual(a.background)
    expect(b.flags).toEqual(a.flags)
  })
})

// ————— Naive oracle: an independent, sort-based implementation of the same
// ALGORITHM.md semantics, no prefilter insertion tricks, no early exit. —————

interface NaiveResult {
  id: number
  fg: [number, number, number]
  bg: [number, number, number]
  flat: boolean
}

function naiveCell(
  samples: { r: Uint8Array; g: Uint8Array; b: Uint8Array },
  profile: AsciiProfile,
  color: ColorMode,
  fgOpt: RGB,
  bgOpt: RGB,
): NaiveResult {
  const inkLight =
    color === 'mono'
      ? luma8(fgOpt[0], fgOpt[1], fgOpt[2]) >= luma8(bgOpt[0], bgOpt[1], bgOpt[2])
      : luma8(bgOpt[0], bgOpt[1], bgOpt[2]) < 128
  const { r, g, b } = samples
  const lum = Array.from({ length: 64 }, (_, k) => luma8(r[k], g[k], b[k]))
  let minI = 0
  let maxI = 0
  for (let k = 1; k < 64; k++) {
    if (lum[k] < lum[minI]) minI = k
    if (lum[k] > lum[maxI]) maxI = k
  }
  // The naive reference reads as one block; hoisting its two arithmetic shorthands
  // would split the thing under test.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const sum = (arr: Uint8Array): number => arr.reduce((a, v) => a + v, 0)
  const meanR = rdiv(sum(r), 64)
  const meanG = rdiv(sum(g), 64)
  const meanB = rdiv(sum(b), 64)
  const meanL = rdiv(
    lum.reduce((a, v) => a + v, 0),
    64,
  )

  if (lum[maxI] - lum[minI] < 15) {
    if (color === 'full') {
      const space = profile.glyphs.indexOf(' ')
      let blank = 0
      if (space >= 0) {
        blank = space
      } else {
        for (let gi = 1; gi < profile.glyphCount; gi++) {
          if (profile.structural.coverage[gi] < profile.structural.coverage[blank]) blank = gi
        }
      }
      return { id: blank, fg: [meanR, meanG, meanB], bg: [meanR, meanG, meanB], flat: true }
    }
    const target = inkLight ? meanL * 257 : (255 - meanL) * 257
    let best = 0
    for (let gi = 1; gi < profile.glyphCount; gi++) {
      if (
        Math.abs(profile.structural.coverage[gi] - target) <
        Math.abs(profile.structural.coverage[best] - target)
      )
        best = gi
    }
    return {
      id: best,
      fg: color === 'foreground' ? [meanR, meanG, meanB] : ([...fgOpt] as [number, number, number]),
      bg: [...bgOpt] as [number, number, number],
      flat: true,
    }
  }

  const bits: number[] = []
  for (let k = 0; k < 64; k++) {
    const dd = (r[k] - r[minI]) ** 2 + (g[k] - g[minI]) ** 2 + (b[k] - b[minI]) ** 2
    const dl = (r[k] - r[maxI]) ** 2 + (g[k] - g[maxI]) ** 2 + (b[k] - b[maxI]) ** 2
    bits.push(dd <= dl ? 1 : 0)
  }
  const matchBits = color === 'full' ? bits : inkLight ? bits.map((v) => 1 - v) : bits

  const glyphBit = (gi: number, k: number): number =>
    k < 32
      ? (profile.structural.masksLo[gi] >>> k) & 1
      : (profile.structural.masksHi[gi] >>> (k - 32)) & 1

  const scored = Array.from({ length: profile.glyphCount }, (_, gi) => {
    let d = 0
    for (let k = 0; k < 64; k++) if (glyphBit(gi, k) !== matchBits[k]) d++
    if (color === 'full') d = Math.min(d, 64 - d)
    return { gi, d }
  })
  scored.sort((a, z) => a.d - z.d || a.gi - z.gi)
  const candidates = scored.slice(0, 8)

  let bestErr = Infinity
  let best: NaiveResult = { id: candidates[0].gi, fg: [0, 0, 0], bg: [0, 0, 0], flat: false }
  for (const { gi } of candidates) {
    let fg: [number, number, number]
    let bg: [number, number, number]
    if (color === 'mono') {
      fg = [...fgOpt] as [number, number, number]
      bg = [...bgOpt] as [number, number, number]
    } else {
      const ink: number[] = []
      const off: number[] = []
      for (let k = 0; k < 64; k++) (glyphBit(gi, k) ? ink : off).push(k)
      // See `sum` above: the partition means belong next to the ink/off split they
      // average over.
      // eslint-disable-next-line unicorn/consistent-function-scoping
      const mean = (ks: number[], arr: Uint8Array): number =>
        rdiv(
          ks.reduce((a, k) => a + arr[k], 0),
          ks.length,
        )
      if (color === 'full') {
        const inkKs = ink.length > 0 ? ink : off
        const offKs = off.length > 0 ? off : ink
        fg = [mean(inkKs, r), mean(inkKs, g), mean(inkKs, b)]
        bg = [mean(offKs, r), mean(offKs, g), mean(offKs, b)]
      } else {
        fg =
          ink.length > 0
            ? [mean(ink, r), mean(ink, g), mean(ink, b)]
            : ([...bgOpt] as [number, number, number])
        bg = [...bgOpt] as [number, number, number]
      }
    }
    let err = 0
    for (let k = 0; k < 64; k++) {
      const c = glyphBit(gi, k) ? fg : bg
      err += (r[k] - c[0]) ** 2 + (g[k] - c[1]) ** 2 + (b[k] - c[2]) ** 2
    }
    if (err < bestErr) {
      bestErr = err
      best = { id: gi, fg, bg, flat: false }
    }
  }
  return best
}

describe('oracle conformance: matchFrame ≡ naive sort-based implementation', () => {
  const profiles = [profile6, randomProfile(40, 7)]
  const modes: Array<[string, ColorMode, RGB, RGB]> = [
    ['mono white-on-black', 'mono', [255, 255, 255], [0, 0, 0]],
    ['mono black-on-white', 'mono', [0, 0, 0], [255, 255, 255]],
    ['foreground dark backdrop', 'foreground', [255, 255, 255], [0, 0, 0]],
    ['foreground light backdrop', 'foreground', [255, 255, 255], [240, 240, 240]],
    ['full', 'full', [255, 255, 255], [0, 0, 0]],
  ]

  for (const profile of profiles) {
    for (const [label, color, fgOpt, bgOpt] of modes) {
      it(`${profile.glyphCount} glyphs / ${label}`, () => {
        const cols = 10
        const rows = 10
        const img = randomImage(cols * 8, rows * 8, 1234 + profile.glyphCount)
        const frame = matchFrame(img, {
          profile,
          columns: cols,
          rows,
          color,
          foreground: fgOpt,
          background: bgOpt,
          alpha: 'ignore',
        })
        const reduced = reduceSource(img, cols, rows, true)
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            const r = new Uint8Array(64)
            const g = new Uint8Array(64)
            const b = new Uint8Array(64)
            for (let j = 0; j < 8; j++) {
              for (let i = 0; i < 8; i++) {
                const p = ((cy * 8 + j) * cols * 8 + cx * 8 + i) * 4
                const k = j * 8 + i
                r[k] = reduced[p]
                g[k] = reduced[p + 1]
                b[k] = reduced[p + 2]
              }
            }
            const naive = naiveCell({ r, g, b }, profile, color, fgOpt, bgOpt)
            const ci = cy * cols + cx
            expect(frame.glyphIds[ci], `glyph at (${cx},${cy})`).toBe(naive.id)
            if (color !== 'mono') {
              const fg = frame.foreground![ci]
              expect(
                [fg & 0xff, (fg >>> 8) & 0xff, (fg >>> 16) & 0xff],
                `fg at (${cx},${cy})`,
              ).toEqual(naive.fg)
            }
            if (color === 'full') {
              const bg = frame.background![ci]
              expect(
                [bg & 0xff, (bg >>> 8) & 0xff, (bg >>> 16) & 0xff],
                `bg at (${cx},${cy})`,
              ).toEqual(naive.bg)
            }
          }
        }
      })
    }
  }
})
