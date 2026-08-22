import { describe, expect, it } from 'vitest'
import type { RawImage } from '@ascii-fx/core'
import { decodeProfile, encodeProfile, matchFrame } from '@ascii-fx/core'
import { buildChromaticProfile } from '@ascii-fx/compiler'

const solidImage = (w: number, h: number, r: number, g: number, b: number, a = 255): RawImage => {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  }
  return { width: w, height: h, data }
}

/** Left half one colour, right half another — gives the glyph real sub-cell structure. */
const splitImage = (w: number, h: number, left: number[], right: number[]): RawImage => {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = x < w / 2 ? left : right
      const p = (y * w + x) * 4
      data[p] = c[0]
      data[p + 1] = c[1]
      data[p + 2] = c[2]
      data[p + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

const build = () =>
  buildChromaticProfile({
    glyphs: [
      { char: 'r', image: solidImage(64, 64, 200, 20, 20) },
      { char: 'g', image: solidImage(48, 48, 20, 200, 20) },
      { char: 'b', image: solidImage(128, 128, 20, 20, 200) },
      { char: 'x', image: splitImage(64, 64, [200, 20, 20], [20, 20, 200]) },
      { char: 't', image: solidImage(64, 64, 255, 255, 255, 0) },
    ],
    id: 'test-chromatic',
  })

describe('buildChromaticProfile', () => {
  it('carries chromatic samples and an RGBA atlas alongside the coverage plane', () => {
    const { profile } = build()
    expect(profile.chromatic).toBeDefined()
    expect(profile.chromatic!.samples.length).toBe(profile.glyphCount * 256)
    expect(profile.atlas.rgba).toBeDefined()
    expect(profile.atlas.rgba!.length).toBe(profile.atlas.width * profile.atlas.height * 4)
    expect(profile.atlas.data.length).toBe(profile.atlas.width * profile.atlas.height)
  })

  it('derives a square cell so grid-v1 gives square cells', () => {
    const { profile } = build()
    expect(profile.metrics.cellWidth).toBe(profile.metrics.cellHeight)
  })

  it('normalises differently sized sources to the same descriptor', () => {
    const { profile } = build()
    // 'r' came from 64x64 and 'g' from 48x48; both must reduce to a flat 8x8.
    for (const [id, rgb] of [
      [0, [200, 20, 20]],
      [1, [20, 200, 20]],
      [2, [20, 20, 200]],
    ] as const) {
      for (let k = 0; k < 64; k++) {
        const p = id * 256 + k * 4
        expect([
          profile.chromatic!.samples[p],
          profile.chromatic!.samples[p + 1],
          profile.chromatic!.samples[p + 2],
        ]).toEqual([...rgb])
      }
    }
  })

  it('keeps sub-cell structure in the descriptor', () => {
    const { profile } = build()
    const at = (k: number) =>
      profile.chromatic!.samples.subarray(3 * 256 + k * 4, 3 * 256 + k * 4 + 3)
    expect([...at(0)]).toEqual([200, 20, 20]) // top-left
    expect([...at(7)]).toEqual([20, 20, 200]) // top-right
  })

  it('derives structural masks and coverage from alpha', () => {
    const { profile } = build()
    expect(profile.structural.masksLo[0] >>> 0).toBe(0xffffffff) // opaque glyph
    expect(profile.structural.masksLo[4] >>> 0).toBe(0) // transparent glyph
    expect(profile.structural.coverage[4]).toBe(0)
    expect(profile.structural.coverage[0]).toBe(65535)
  })

  it('is byte-for-byte reproducible from identical inputs', () => {
    expect(build().binary).toEqual(build().binary)
    expect(build().profile.fingerprint).toBe(build().profile.fingerprint)
  })

  it('rejects duplicate graphemes and malformed images', () => {
    const img = solidImage(8, 8, 1, 2, 3)
    expect(() =>
      buildChromaticProfile({
        glyphs: [
          { char: 'a', image: img },
          { char: 'a', image: img },
        ],
      }),
    ).toThrow(/Duplicate/)
    expect(() => buildChromaticProfile({ glyphs: [] })).toThrow(/at least one glyph/)
    expect(() =>
      buildChromaticProfile({
        glyphs: [{ char: 'a', image: { width: 4, height: 4, data: new Uint8Array(3) } }],
      }),
    ).toThrow(/width \* height \* 4/)
    expect(() =>
      buildChromaticProfile({ glyphs: [{ char: 'a', image: img }], cellSize: 4 }),
    ).toThrow(/cellSize/)
  })
})

describe('chromatic profile binary round-trip', () => {
  it('preserves samples and the RGBA atlas exactly', () => {
    const { profile, binary } = build()
    const decoded = decodeProfile(binary)
    expect(decoded.chromatic!.samples).toEqual(profile.chromatic!.samples)
    expect(decoded.atlas.rgba).toEqual(profile.atlas.rgba)
    expect(decoded.atlas.data).toEqual(profile.atlas.data)
    expect(decoded.glyphs).toEqual(profile.glyphs)
    expect(decoded.fingerprint).toBe(profile.fingerprint)
    expect(encodeProfile(decoded)).toEqual(binary)
  })

  it('matches identically before and after a round-trip', () => {
    const { profile, binary } = build()
    const source = solidImage(16, 16, 190, 30, 30)
    const before = matchFrame(source, { profile, columns: 2, rows: 2, matcher: 'chromatic' })
    const after = matchFrame(source, {
      profile: decodeProfile(binary),
      columns: 2,
      rows: 2,
      matcher: 'chromatic',
    })
    expect([...after.glyphIds]).toEqual([...before.glyphIds])
  })

  it('refuses a profile carrying one chromatic half without the other', () => {
    const { profile } = build()
    expect(() => encodeProfile({ ...profile, chromatic: undefined })).not.toThrow()
    // Samples without the atlas would match correctly and then draw blank tiles.
    const samplesOnly = encodeProfile({ ...profile, atlas: { ...profile.atlas, rgba: undefined } })
    expect(() => decodeProfile(samplesOnly)).toThrow(/without the RGBA atlas/)
    const atlasOnly = encodeProfile({ ...profile, chromatic: undefined })
    expect(() => decodeProfile(atlasOnly)).toThrow(/without the chromatic samples/)
  })
})
