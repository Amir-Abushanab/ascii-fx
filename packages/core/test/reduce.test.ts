import { describe, expect, it } from 'vitest'
import { reduceSource } from '@ascii-fx/core'
import { makeCell } from './synthetic.js'

describe('reduce-v1 (ALGORITHM.md §4)', () => {
  it('is the identity when source resolution equals sample resolution', () => {
    const img = makeCell((i, j) => [i * 10, j * 20, (i + j) * 5])
    const out = reduceSource(img, 1, 1, true)
    for (let k = 0; k < 64; k++) {
      expect(out[k * 4]).toBe(img.data[k * 4])
      expect(out[k * 4 + 1]).toBe(img.data[k * 4 + 1])
      expect(out[k * 4 + 2]).toBe(img.data[k * 4 + 2])
      expect(out[k * 4 + 3]).toBe(255)
    }
  })

  it('2× downscale is the exact rounded block mean', () => {
    // 16×16 source → 8×8 samples; each sample = mean of a 2×2 block.
    const data = new Uint8Array(16 * 16 * 4)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const p = (y * 16 + x) * 4
        data[p] = x * 16 + y // deterministic pattern, ≤ 255
        data[p + 1] = 7
        data[p + 2] = 200
        data[p + 3] = 255
      }
    }
    const out = reduceSource({ width: 16, height: 16, data }, 1, 1, true)
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const vals = [
          data[(ty * 2 * 16 + tx * 2) * 4],
          data[(ty * 2 * 16 + tx * 2 + 1) * 4],
          data[((ty * 2 + 1) * 16 + tx * 2) * 4],
          data[((ty * 2 + 1) * 16 + tx * 2 + 1) * 4],
        ]
        const sum = vals.reduce((a, b) => a + b, 0)
        const expected = Math.floor((2 * sum * 255 + 4 * 255) / (2 * 4 * 255)) // rdiv(sum·a, Σa) with a=255
        expect(out[(ty * 8 + tx) * 4]).toBe(expected)
        expect(out[(ty * 8 + tx) * 4 + 1]).toBe(7)
        expect(out[(ty * 8 + tx) * 4 + 2]).toBe(200)
      }
    }
  })

  it('alpha weighting excludes transparent pixels; ignore mode does not', () => {
    // 16×16: even columns opaque value 100, odd columns transparent value 200.
    const data = new Uint8Array(16 * 16 * 4)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const p = (y * 16 + x) * 4
        const even = x % 2 === 0
        data[p] = even ? 100 : 200
        data[p + 1] = even ? 100 : 200
        data[p + 2] = even ? 100 : 200
        data[p + 3] = even ? 255 : 0
      }
    }
    const weighted = reduceSource({ width: 16, height: 16, data }, 1, 1, false)
    const ignored = reduceSource({ width: 16, height: 16, data }, 1, 1, true)
    expect(weighted[0]).toBe(100) // transparent 200s contribute nothing
    expect(weighted[3]).toBe(128) // mean alpha rdiv(2·255, 4) = 128
    expect(ignored[0]).toBe(150)
    expect(ignored[3]).toBe(255)
  })

  it('fully transparent region yields zero sample', () => {
    const img = makeCell(() => [123, 45, 67, 0])
    const out = reduceSource(img, 1, 1, false)
    expect(out[0]).toBe(0)
    expect(out[3]).toBe(0)
  })

  it('upscales by sample duplication (min 1px rects)', () => {
    const data = new Uint8Array([
      10, 20, 30, 255, 200, 210, 220, 255, 50, 60, 70, 255, 90, 100, 110, 255,
    ])
    const out = reduceSource({ width: 2, height: 2, data }, 1, 1, true)
    expect(out[0]).toBe(10) // top-left quadrant of samples reads pixel (0,0)
    expect(out[(7 * 8 + 7) * 4]).toBe(90)
  })
})
