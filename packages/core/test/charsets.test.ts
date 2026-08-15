import { describe, expect, it } from 'vitest'
import { BUILTIN_CHARSETS, resolveCharset } from '@ascii-fx/core'

describe('charsets (ALGORITHM.md §12)', () => {
  it('ascii is exactly U+0020..U+007E, 95 glyphs, space preserved', () => {
    const { name, glyphs } = resolveCharset('ascii')
    expect(name).toBe('ascii')
    expect(glyphs).toHaveLength(95)
    expect(glyphs[0]).toBe(' ')
    expect(glyphs[94]).toBe('~')
  })

  it('ascii-blocks appends the 18 pinned block glyphs', () => {
    const { glyphs } = resolveCharset('ascii-blocks')
    expect(glyphs).toHaveLength(113)
    expect(glyphs.slice(95).join('')).toBe('▀▄█▌▐░▒▓▖▗▘▙▚▛▜▝▞▟')
  })

  it('defaults to ascii', () => {
    expect(resolveCharset().name).toBe('ascii')
  })

  it('unknown charset names error with remediation', () => {
    expect(() => resolveCharset('nope')).toThrow(/Built-ins/)
  })

  it('custom characters normalize by code point (astral-safe)', () => {
    const { name, glyphs } = resolveCharset(undefined, ' 👍x')
    expect(name).toBe('custom')
    expect(glyphs).toEqual([' ', '👍', 'x'])
  })

  it('duplicate code points are rejected', () => {
    expect(() => resolveCharset(undefined, 'abca')).toThrow(/duplicate/i)
    expect(() => resolveCharset(undefined, ['ab', 'b'])).toThrow(/duplicate/i)
  })

  it('builtin definitions are frozen strings', () => {
    expect(BUILTIN_CHARSETS.ascii.length).toBe(95)
  })
})
