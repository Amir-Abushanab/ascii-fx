import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeProfile } from '@ascii-fx/core'
import { buildProfile } from '@ascii-fx/compiler'

const FONT_PATH = fileURLToPath(
  new URL('../../../fixtures/fonts/GeistMono-Regular.ttf', import.meta.url),
)
const FONT_SHA256 = '42d8ad2e610238e64e8abfcde3037c63f7850a73928742b7ab7229d897bcb155'

const fontBytes = new Uint8Array(readFileSync(FONT_PATH))
let cached: ReturnType<typeof buildProfile> | undefined
const build = (): ReturnType<typeof buildProfile> => (cached ??= buildProfile({ font: fontBytes }))

describe('profile compilation (Geist Mono fixture)', () => {
  it('pins the fixture font bytes', () => {
    expect(build().profile.fontHash).toBe(FONT_SHA256)
  })

  it('builds 95 ascii glyphs with sane cell geometry', () => {
    const { profile } = build()
    expect(profile.glyphCount).toBe(95)
    expect(profile.metadata.charset).toBe('ascii')
    expect(profile.atlas.cellHeight).toBe(64)
    expect(profile.atlas.cellWidth).toBeGreaterThan(8)
    expect(profile.atlas.cellWidth).toBeLessThan(64)
    expect(profile.metrics.baseline).toBeGreaterThan(32)
    expect(profile.metrics.baseline).toBeLessThan(64)
  })

  it('is byte-for-byte deterministic across builds', () => {
    const a = buildProfile({ font: fontBytes })
    const b = buildProfile({ font: fontBytes })
    expect(a.binary).toEqual(b.binary)
    expect(a.profile.fingerprint).toBe(b.profile.fingerprint)
  })

  it('space has zero coverage and an empty mask', () => {
    const { profile } = build()
    const space = profile.glyphs.indexOf(' ')
    expect(space).toBe(0)
    expect(profile.structural.coverage[space]).toBe(0)
    expect(profile.structural.masksLo[space]).toBe(0)
    expect(profile.structural.masksHi[space]).toBe(0)
  })

  it('coverage orders sanely: . < : < @', () => {
    const { profile } = build()
    const cov = (c: string): number => profile.structural.coverage[profile.glyphs.indexOf(c)]
    expect(cov('.')).toBeGreaterThan(0)
    expect(cov('.')).toBeLessThan(cov(':'))
    expect(cov(':')).toBeLessThan(cov('@'))
  })

  it('thin strokes produce empty masks but positive coverage (flat-path glyphs)', () => {
    // Consistent with source-side classification: a stroke covering < half a
    // mask cell blends toward the light endpoint on both sides (ALGORITHM.md §13).
    const { profile } = build()
    for (const ch of ['_', '-', '.']) {
      const i = profile.glyphs.indexOf(ch)
      expect(profile.structural.masksLo[i], ch).toBe(0)
      expect(profile.structural.masksHi[i], ch).toBe(0)
      expect(profile.structural.coverage[i], ch).toBeGreaterThan(0)
    }
  })

  it('pipe is a vertical stem through the cell middle (pinned mask)', () => {
    const { profile } = build()
    const i = profile.glyphs.indexOf('|')
    expect(profile.structural.masksLo[i]).toBe(0x08080000)
    expect(profile.structural.masksHi[i]).toBe(0x00080808)
  })

  it('A keeps its ink above the baseline rows', () => {
    const { profile } = build()
    const i = profile.glyphs.indexOf('A')
    expect(profile.structural.masksLo[i]).not.toBe(0)
    expect(profile.structural.masksHi[i] & 0xffff).not.toBe(0) // rows 4–5: legs
    expect(profile.structural.masksHi[i] >>> 16).toBe(0) // rows 6–7: below baseline, empty
  })

  it('roundtrips through the asciip codec with real data', () => {
    const { profile, binary } = build()
    const decoded = decodeProfile(binary)
    expect(decoded.glyphs).toEqual(profile.glyphs)
    expect(decoded.structural.masksLo).toEqual(profile.structural.masksLo)
    expect(decoded.structural.masksHi).toEqual(profile.structural.masksHi)
    expect(decoded.structural.coverage).toEqual(profile.structural.coverage)
    expect(decoded.atlas.data).toEqual(profile.atlas.data)
    expect(decoded.fingerprint).toBe(profile.fingerprint)
  })

  it('errors with the missing-glyph list for uncovered charsets', () => {
    expect(() => buildProfile({ font: fontBytes, characters: ' ☃' })).toThrow(/U\+2603/)
  })

  it('compiles deterministic shape6 vectors on demand', () => {
    const a = buildProfile({ font: fontBytes, shape6: true })
    const b = buildProfile({ font: fontBytes, shape6: true })
    expect(a.profile.shape6?.vectors6).toHaveLength(95 * 6)
    expect(a.profile.shape6?.lut3).toBeUndefined()
    expect(a.binary).toEqual(b.binary)
    // space glyph has no ink → zero vector
    expect(Array.from(a.profile.shape6!.vectors6.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0])
    // shape6 data does not change matching identity
    expect(a.profile.fingerprint).toBe(build().profile.fingerprint)
    const decoded = decodeProfile(a.binary)
    expect(decoded.shape6?.vectors6).toEqual(a.profile.shape6?.vectors6)
  })

  it('CPU compositor draws glyph shapes from the real atlas (not blocks)', async () => {
    const { compositeFrame, matchFrame } = await import('@ascii-fx/core')
    const { profile } = build()
    const data = new Uint8Array(32 * 16 * 4)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const v = x < 16 ? 0 : 255
        const p = (y * 32 + x) * 4
        data[p] = v
        data[p + 1] = v
        data[p + 2] = v
        data[p + 3] = 255
      }
    }
    const frame = matchFrame(
      { width: 32, height: 16, data },
      { profile, columns: 4, color: 'mono' },
    )
    const img = compositeFrame(frame)
    const cw = profile.atlas.cellWidth
    const litFraction = (cell: number): number => {
      let lit = 0
      let total = 0
      for (let y = 0; y < img.height; y++) {
        for (let x = cell * cw; x < (cell + 1) * cw; x++) {
          total++
          if (img.data[(y * img.width + x) * 4] > 128) lit++
        }
      }
      return lit / total
    }
    expect(litFraction(0), 'black cell near-empty').toBeLessThan(0.02)
    expect(litFraction(3), 'white cell is a glyph, not a block').toBeLessThan(0.6)
    expect(litFraction(3), 'white cell has visible ink').toBeGreaterThan(0.04)
  })

  it('builds and roundtrips the dense shape6 LUT', { timeout: 60_000 }, () => {
    const { profile, binary } = buildProfile({ font: fontBytes, shape6: { lut: true } })
    const lut = profile.shape6?.lut3
    expect(lut).toHaveLength(8 ** 6)
    let max = 0
    for (let i = 0; i < lut!.length; i++) if (lut![i] > max) max = lut![i]
    expect(max).toBeLessThan(95)
    const decoded = decodeProfile(binary)
    expect(decoded.shape6?.lut3).toEqual(lut)
  })
})
