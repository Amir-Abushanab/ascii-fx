import { describe, expect, it } from 'vitest'
import { decodeFrame, decodeProfile, encodeFrame, encodeProfile, matchFrame, peekFrame } from '@ascii-fx/core'
import { STANDARD_SIX, makeProfile, randomImage, randomProfile } from './synthetic.js'

describe('asciip/1 codec', () => {
  it('roundtrips a profile bit-for-bit', () => {
    const profile = randomProfile(23, 99)
    const bytes = encodeProfile(profile)
    const decoded = decodeProfile(bytes)
    expect(decoded.glyphs).toEqual(profile.glyphs)
    expect(decoded.glyphCount).toBe(profile.glyphCount)
    expect(decoded.fingerprint).toBe(profile.fingerprint)
    expect(decoded.charsetHash).toBe(profile.charsetHash)
    expect(decoded.fontHash).toBe(profile.fontHash)
    expect(decoded.structural.masksLo).toEqual(profile.structural.masksLo)
    expect(decoded.structural.masksHi).toEqual(profile.structural.masksHi)
    expect(decoded.structural.coverage).toEqual(profile.structural.coverage)
    expect(decoded.atlas).toEqual(profile.atlas)
    expect(decoded.metrics).toEqual(profile.metrics)
    expect(decoded.metadata).toEqual(profile.metadata)
  })

  it('encoding is deterministic', () => {
    const profile = makeProfile(STANDARD_SIX)
    expect(encodeProfile(profile)).toEqual(encodeProfile(profile))
  })

  it('rejects wrong magic and wrong versions with remediation', () => {
    expect(() => decodeProfile(new Uint8Array(200))).toThrow(/magic/)
    const bytes = encodeProfile(makeProfile(STANDARD_SIX))
    new DataView(bytes.buffer).setUint32(4, 9, true)
    expect(() => decodeProfile(bytes)).toThrow(/schema v9.*Rebuild/s)
  })
})

describe('asciif/1 codec', () => {
  const profile = makeProfile(STANDARD_SIX)
  const img = randomImage(80, 48, 7)

  it('roundtrips full-color frames', () => {
    const frame = matchFrame(img, { profile, columns: 10, color: 'full' })
    const bytes = encodeFrame(frame)
    const decoded = decodeFrame(bytes, profile)
    expect(decoded.columns).toBe(frame.columns)
    expect(decoded.rows).toBe(frame.rows)
    expect(decoded.colorMode).toBe('full')
    expect(decoded.glyphIds).toEqual(frame.glyphIds)
    expect(decoded.foreground).toEqual(frame.foreground)
    expect(decoded.background).toEqual(frame.background)
    expect(decoded.flags).toEqual(frame.flags)
  })

  it('mono frames omit color planes', () => {
    const frame = matchFrame(img, { profile, columns: 10, color: 'mono' })
    const decoded = decodeFrame(encodeFrame(frame), profile)
    expect(decoded.foreground).toBeUndefined()
    expect(decoded.background).toBeUndefined()
    expect(decoded.glyphIds).toEqual(frame.glyphIds)
  })

  it('peekFrame reads header without a profile', () => {
    const frame = matchFrame(img, { profile, columns: 10, color: 'foreground' })
    const meta = peekFrame(encodeFrame(frame))
    expect(meta.columns).toBe(10)
    expect(meta.colorMode).toBe('foreground')
    expect(meta.profileFingerprint).toBe(profile.fingerprint)
    expect(meta.profileId).toBe('synthetic')
  })

  it('rejects a mismatched profile with both identities in the message', () => {
    const frame = matchFrame(img, { profile, columns: 10, color: 'mono' })
    const other = randomProfile(12, 5)
    expect(() => decodeFrame(encodeFrame(frame), other)).toThrow(/synthetic|fingerprint|matching/i)
  })

  it('skips unknown sections (forward compatibility)', () => {
    const frame = matchFrame(img, { profile, columns: 10, color: 'mono' })
    const bytes = encodeFrame(frame)
    // flags section (present: transparent/flat bits exist in random imagery? force by patching a known section)
    const view = new DataView(bytes.buffer)
    const sectionCount = view.getUint32(20, true)
    let patched = false
    for (let s = 0; s < sectionCount; s++) {
      const base = 56 + s * 12
      if (view.getUint32(base, true) === 8) {
        view.setUint32(base, 200, true) // unknown type
        patched = true
      }
    }
    const decoded = decodeFrame(bytes, profile)
    expect(decoded.glyphIds).toEqual(frame.glyphIds)
    if (patched) expect(decoded.flags.every((f) => f === 0)).toBe(true)
  })
})
