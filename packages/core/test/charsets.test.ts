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

  it('blocks is space plus the Block Elements block in code-point order', () => {
    const { glyphs } = resolveCharset('blocks')
    expect(glyphs).toHaveLength(33)
    expect(glyphs[0]).toBe(' ')
    expect(glyphs[1].codePointAt(0)).toBe(0x2580)
    expect(glyphs[32].codePointAt(0)).toBe(0x259f)
  })

  it('braille is all 256 patterns, the empty one first and no space', () => {
    const { glyphs } = resolveCharset('braille')
    expect(glyphs).toHaveLength(256)
    expect(glyphs[0]).toBe('\u2800')
    expect(glyphs[255]).toBe('\u28ff')
    expect(glyphs).not.toContain(' ')
  })

  it('arabic is space plus the 40 isolated presentation forms', () => {
    const { glyphs } = resolveCharset('arabic')
    expect(glyphs).toHaveLength(41)
    expect(glyphs[0]).toBe(' ')
    expect(glyphs[1].codePointAt(0)).toBe(0xfe80)
    expect(glyphs[40].codePointAt(0)).toBe(0xfefb)
    // No final, initial or medial form: each isolated form opens its letter's group.
    expect(glyphs).not.toContain('\ufe90') // beh final
  })

  it('arabic-joined adds every positional form and tatweel', () => {
    const { glyphs } = resolveCharset('arabic-joined')
    expect(glyphs).toHaveLength(1 + 1 + 125)
    expect(glyphs.slice(0, 2)).toEqual([' ', '\u0640'])
    expect(glyphs).toContain('\ufe92') // beh medial
    for (const g of resolveCharset('arabic').glyphs) expect(glyphs).toContain(g)
  })

  it('defaults to ascii', () => {
    expect(resolveCharset().name).toBe('ascii')
  })

  it('unknown charset names error with remediation', () => {
    expect(() => resolveCharset('nope')).toThrow(/Built-ins/)
  })

  it('custom characters split by grapheme cluster (astral-safe)', () => {
    const { name, glyphs } = resolveCharset(undefined, ' 👍x')
    expect(name).toBe('custom')
    expect(glyphs).toEqual([' ', '👍', 'x'])
  })

  it('keeps a multi-code-point grapheme as one glyph', () => {
    // A Devanagari conjunct, a decomposed é, and a thumbs-up with its skin tone.
    expect(resolveCharset(undefined, 'क्षe\u0301👍🏽').glyphs).toEqual(['क्ष', 'e\u0301', '👍🏽'])
  })

  it('takes array elements whole, for glyphs a segmenter would split differently', () => {
    const medialBeh = '\u200dب\u200d'
    expect(resolveCharset(undefined, [' ', medialBeh]).glyphs).toEqual([' ', medialBeh])
    expect(() => resolveCharset(undefined, ['a', ''])).toThrow(/empty/)
  })

  it('duplicate glyphs are rejected', () => {
    expect(() => resolveCharset(undefined, 'abca')).toThrow(/duplicate/i)
    expect(() => resolveCharset(undefined, ['ab', 'ab'])).toThrow(/duplicate/i)
  })

  it('builtin definitions are frozen strings', () => {
    expect(BUILTIN_CHARSETS.ascii.length).toBe(95)
  })
})
