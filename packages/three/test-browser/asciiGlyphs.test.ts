import { describe, expect, it } from 'vitest'
import { AsciiFrame, FLAG_TRANSPARENT } from '@ascii-fx/core'
import { AsciiGlyphs } from '@ascii-fx/three'
import { G_FULL, STANDARD_SIX, makeProfile } from '../../core/test/synthetic.js'

describe('AsciiGlyphs frame validation and transparency', () => {
  it('makes transparent cells invisible and validates the frame profile', () => {
    const profile = makeProfile(STANDARD_SIX)
    const glyphs = new AsciiGlyphs({ profile, columns: 1, rows: 1 })
    try {
      const frame = new AsciiFrame({
        columns: 1,
        rows: 1,
        colorMode: 'foreground',
        glyphIds: new Uint16Array([1]),
        foreground: new Uint32Array([0xff_ff_ff_ff]),
        flags: new Uint16Array([FLAG_TRANSPARENT]),
        profile,
      })
      glyphs.updateFromFrame(frame)
      const geometry = glyphs.mesh.geometry
      expect(geometry.getAttribute('aGlyph').getX(0)).toBe(0)
      expect(geometry.getAttribute('aVisible').getX(0)).toBe(0)
      expect(geometry.getAttribute('aUseBackground').getX(0)).toBe(0)
      expect(glyphs.material.transparent).toBe(true)
      expect(glyphs.material.depthWrite).toBe(false)

      const otherProfile = makeProfile([G_FULL])
      const mismatched = new AsciiFrame({
        columns: 1,
        rows: 1,
        colorMode: 'mono',
        glyphIds: new Uint16Array([0]),
        profile: otherProfile,
      })
      expect(() => glyphs.updateFromFrame(mismatched)).toThrow(/does not match/)
    } finally {
      glyphs.dispose()
    }
  })
})
