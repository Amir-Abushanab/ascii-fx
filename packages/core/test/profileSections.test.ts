// §14: profile sections are written in ascending type order. The encoder
// pushes them grouped by feature and sorts at emit; this pins the invariant,
// which originally shipped broken for the chromatic sections (11 before 10).
import { describe, expect, it } from 'vitest'
import { decodeProfile, encodeProfile } from '@ascii-fx/core'
import { makeChromaticProfile, solid } from './synthetic.js'

describe('profile section table (§14)', () => {
  it('chromatic profiles emit sections in strictly ascending type order', () => {
    const profile = makeChromaticProfile([solid('🌊', 10, 80, 200), solid('🔥', 220, 60, 10, 128)])
    const bytes = encodeProfile(profile)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint32(8, true)
    const types = Array.from({ length: count }, (_, i) => view.getUint32(172 + i * 12, true))
    expect(types.length).toBeGreaterThanOrEqual(6)
    for (let i = 1; i < types.length; i++) {
      expect(
        types[i],
        `section table ${JSON.stringify(types)} not ascending at index ${i}`,
      ).toBeGreaterThan(types[i - 1])
    }
    const decoded = decodeProfile(bytes)
    expect(decoded.glyphs).toEqual(profile.glyphs)
    expect(decoded.chromatic?.samples).toEqual(profile.chromatic?.samples)
    expect(decoded.atlas.rgba).toEqual(profile.atlas.rgba)
  })
})
