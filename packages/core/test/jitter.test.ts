import { describe, expect, it } from 'vitest'
import type { RawImage } from '@ascii-fx/core'
import {
  FLAG_FLAT,
  FLAG_TRANSPARENT,
  matchBand,
  matchFrame,
  rdiv,
  reduceSource,
} from '@ascii-fx/core'
import { jitterHash } from '../src/jitter.js'
import { makeCell, randomImage, sweepProfile } from './synthetic.js'

const profile = sweepProfile(95, 11)
const image = randomImage(40 * 8, 24 * 8, 5150)
const grid = { profile, columns: 40, rows: 24, alpha: 'ignore' } as const

const ids = (img: RawImage, opts: Record<string, unknown> = {}): Uint16Array =>
  matchFrame(img, { ...grid, color: 'full', ...opts }).glyphIds

describe('jitter-v1 (§20)', () => {
  it('leaves the §10 argmin alone when off', () => {
    const base = ids(image)
    expect(ids(image, { jitter: 0 })).toEqual(base)
    expect(ids(image, { jitter: 0, jitterSeed: 99 })).toEqual(base)
  })

  it('actually moves cells off the argmin', () => {
    const base = ids(image)
    const jittered = ids(image, { jitter: 40 })
    let moved = 0
    for (let i = 0; i < base.length; i++) if (base[i] !== jittered[i]) moved++
    expect(moved).toBeGreaterThan(0)
    // and it is a variation on the match, not a replacement of it
    expect(moved).toBeLessThan(base.length)
  })

  it('is reproducible, and the seed is what moves the pattern', () => {
    expect(ids(image, { jitter: 40 })).toEqual(ids(image, { jitter: 40 }))
    expect(ids(image, { jitter: 40, jitterSeed: 1 })).not.toEqual(ids(image, { jitter: 40 }))
  })

  it('widens the pool as jitter rises', () => {
    const base = ids(image)
    const moved = (j: number): number => {
      const out = ids(image, { jitter: j })
      let n = 0
      for (let i = 0; i < base.length; i++) if (base[i] !== out[i]) n++
      return n
    }
    expect(moved(10)).toBeLessThan(moved(120))
  })

  it('emits the colours fitted to the glyph it actually chose', () => {
    // A jittered cell that kept the winner's colours would be reconstructing
    // one glyph's mask with another glyph's means.
    const frame = matchFrame(image, { ...grid, color: 'full', jitter: 90 })
    const reduced = reduceSource(image, 40, 24, true)
    const SW = 40 * 8
    for (let cy = 0; cy < 24; cy++) {
      for (let cx = 0; cx < 40; cx++) {
        const cell = frame.getCell(cx, cy)
        if (cell.flags & (FLAG_FLAT | FLAG_TRANSPARENT)) continue
        const lo = profile.structural.masksLo[cell.glyphId]
        const hi = profile.structural.masksHi[cell.glyphId]
        const ink = [0, 0, 0]
        const off = [0, 0, 0]
        let iN = 0
        let oN = 0
        for (let k = 0; k < 64; k++) {
          const p = ((cy * 8 + (k >> 3)) * SW + cx * 8 + (k & 7)) * 4
          const on = k < 32 ? (lo >>> k) & 1 : (hi >>> (k - 32)) & 1
          const acc = on ? ink : off
          acc[0] += reduced[p]
          acc[1] += reduced[p + 1]
          acc[2] += reduced[p + 2]
          if (on) iN++
          else oN++
        }
        const fg = iN > 0 ? ink.map((v) => rdiv(v, iN)) : off.map((v) => rdiv(v, oN))
        const bg = oN > 0 ? off.map((v) => rdiv(v, oN)) : fg
        expect([cell.foreground?.[0], cell.foreground?.[1], cell.foreground?.[2]]).toEqual(fg)
        expect([cell.background?.[0], cell.background?.[1], cell.background?.[2]]).toEqual(bg)
      }
    }
  })

  it('leaves flat and transparent cells to §5–§6', () => {
    const flat = makeCell(() => [128, 130, 129, 255])
    const clear = makeCell(() => [200, 40, 90, 0])
    for (const [img, flag] of [
      [flat, FLAG_FLAT],
      [clear, FLAG_TRANSPARENT],
    ] as const) {
      const plain = matchFrame(img, { profile, columns: 1, rows: 1, color: 'full' })
      const wild = matchFrame(img, { profile, columns: 1, rows: 1, color: 'full', jitter: 255 })
      expect(wild.getCell(0, 0).flags & flag).toBe(flag)
      expect(wild.glyphIds).toEqual(plain.glyphIds)
    }
  })

  it('rejects a matcher with no rerank to vary', () => {
    for (const matcher of ['shape6', 'ramp'] as const) {
      expect(() => matchFrame(image, { ...grid, matcher, jitter: 20 })).toThrow(/structural-v1/)
    }
  })

  it('rejects a jitter outside 0..255', () => {
    for (const jitter of [-1, 256, 1.5]) {
      expect(() => matchFrame(image, { ...grid, jitter })).toThrow(/integer 0\.\.255/)
    }
  })
})

describe('jitter-v1 band decomposition', () => {
  const split = (rowOffsets: boolean): Uint16Array => {
    const reduced = reduceSource(image, 40, 24, true)
    const out = new Uint16Array(40 * 24)
    const SW = 40 * 8 * 4
    for (const [r0, r1] of [
      [0, 7],
      [7, 15],
      [15, 24],
    ]) {
      const cells = matchBand(reduced.slice(r0 * 8 * SW, r1 * 8 * SW), 40, r1 - r0, {
        profile,
        color: 'full',
        alpha: 'ignore',
        jitter: 90,
        rowOffset: rowOffsets ? r0 : 0,
      })
      out.set(cells.glyphIds, r0 * 40)
    }
    return out
  }

  it('reproduces the whole-frame match when bands carry their row offset', () => {
    expect(split(true)).toEqual(ids(image, { jitter: 90 }))
  })

  it('does not without it — rowOffset is load-bearing, not decoration', () => {
    expect(split(false)).not.toEqual(ids(image, { jitter: 90 }))
  })
})

describe('jitterHash', () => {
  it('is a u32 and depends on every input', () => {
    const h = jitterHash(3, 7, 0)
    expect(h).toBe(jitterHash(3, 7, 0))
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true)
    expect(jitterHash(4, 7, 0)).not.toBe(h)
    expect(jitterHash(3, 8, 0)).not.toBe(h)
    expect(jitterHash(3, 7, 1)).not.toBe(h)
  })

  it('spreads neighbouring cells across the range', () => {
    // Adjacent cells landing in the same octant would dither in visible blocks.
    const buckets = Array.from({ length: 8 }, () => 0)
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) buckets[Math.floor(jitterHash(x, y, 0) / 0x20000000)]++
    }
    for (const n of buckets) expect(n).toBeGreaterThan(1600 / 8 / 2)
  })
})
