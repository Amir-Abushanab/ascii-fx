import { describe, expect, it } from 'vitest'
import {
  FLAG_TRANSPARENT,
  matchFrame,
  quantizeColor,
  quantizeFrame,
  resolvePalette,
} from '@ascii-fx/core'
import type { RGB } from '@ascii-fx/core'
import { STANDARD_SIX, makeProfile, randomImage } from './synthetic.js'

const profile = makeProfile(STANDARD_SIX)
const GAMEBOY: RGB[] = [
  [15, 56, 15],
  [48, 98, 48],
  [139, 172, 15],
  [155, 188, 15],
]
const pack = (r: number, g: number, b: number): number =>
  (r | (g << 8) | (b << 16) | 0xff000000) >>> 0

describe('palette-v1 (ALGORITHM.md §22)', () => {
  it('Bayer offsets are the pinned table', () => {
    // B2 = [[0,2],[3,1]], spread 64: floor((2t+1)·64/8) − 32.
    expect([...resolvePalette({ colors: GAMEBOY, dither: 'bayer2' }).offsets]).toEqual([
      -24, 8, 24, -8,
    ])
    expect([...resolvePalette({ colors: GAMEBOY }).offsets]).toEqual([0])
  })

  it('every Bayer matrix is a permutation of 0..n²−1, so offsets span ±spread/2', () => {
    for (const [dither, n] of [
      ['bayer4', 4],
      ['bayer8', 8],
    ] as const) {
      const { offsets, size } = resolvePalette({ colors: GAMEBOY, dither, spread: 128 })
      expect(size).toBe(n)
      const sorted = [...offsets].toSorted((a, b) => a - b)
      expect(new Set(sorted).size).toBe(n * n)
      expect(sorted[0]).toBeGreaterThanOrEqual(-64)
      expect(sorted.at(-1)).toBeLessThan(64)
    }
  })

  it('snaps to the nearest entry, ties to the earlier one', () => {
    const p = resolvePalette({
      colors: [
        [0, 0, 0],
        [100, 100, 100],
        [200, 200, 200],
      ],
    })
    expect(quantizeColor(pack(40, 40, 40), 0, 0, p)).toBe(pack(0, 0, 0))
    expect(quantizeColor(pack(160, 160, 160), 0, 0, p)).toBe(pack(200, 200, 200))
    // 50 is equidistant from 0 and 100.
    expect(quantizeColor(pack(50, 50, 50), 0, 0, p)).toBe(pack(0, 0, 0))
  })

  it('carries the alpha byte through', () => {
    const p = resolvePalette({ colors: [[10, 20, 30]] })
    expect(quantizeColor(0x12345678, 0, 0, p) >>> 24).toBe(0x12)
  })

  it('dither moves a mid-tone between neighbours by cell position', () => {
    const p = resolvePalette({
      colors: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      dither: 'bayer2',
      spread: 255,
    })
    const mid = pack(128, 128, 128)
    const cells = [
      quantizeColor(mid, 0, 0, p),
      quantizeColor(mid, 1, 0, p),
      quantizeColor(mid, 0, 1, p),
      quantizeColor(mid, 1, 1, p),
    ]
    expect(new Set(cells).size).toBe(2)
    // The pattern repeats with the matrix.
    expect(quantizeColor(mid, 2, 2, p)).toBe(cells[0])
  })

  it('quantizeFrame snaps both planes and leaves glyphs alone', () => {
    const src = randomImage(64, 64, 7)
    const frame = matchFrame(src, { profile, columns: 8, rows: 8, color: 'full' })
    const q = quantizeFrame(frame, { colors: GAMEBOY, dither: 'bayer4' })
    expect(q.glyphIds).toBe(frame.glyphIds)
    const allowed = new Set(GAMEBOY.map(([r, g, b]) => pack(r, g, b)))
    for (let i = 0; i < 64; i++) {
      expect(allowed.has(q.foreground![i])).toBe(true)
      expect(allowed.has(q.background![i])).toBe(true)
    }
  })

  it('transparent cells keep their (empty) colour', () => {
    const src = randomImage(16, 16, 3, true)
    for (let i = 0; i < 64; i++) src.data[i * 4 + 3] = 0
    const frame = matchFrame(src, { profile, columns: 2, rows: 2, color: 'foreground' })
    const q = quantizeFrame(frame, { colors: GAMEBOY })
    for (let i = 0; i < 4; i++) {
      if (frame.flags[i] & FLAG_TRANSPARENT) expect(q.foreground![i]).toBe(frame.foreground![i])
    }
  })

  it('mono frames come back unchanged', () => {
    const frame = matchFrame(randomImage(16, 16, 1), { profile, columns: 2, rows: 2 })
    expect(quantizeFrame(frame, { colors: GAMEBOY })).toBe(frame)
  })

  it('rejects malformed palettes with the reason', () => {
    expect(() => resolvePalette({ colors: [] })).toThrow(/1\.\.256/)
    expect(() => resolvePalette({ colors: [[0, 0, 256]] })).toThrow(/0\.\.255/)
    expect(() => resolvePalette({ colors: [[0, 0, 0.5]] })).toThrow(/integer/)
    expect(() => resolvePalette({ colors: GAMEBOY, spread: Number.NaN })).toThrow(/finite/)
  })
})
