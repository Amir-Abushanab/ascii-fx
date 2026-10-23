import { describe, expect, it } from 'vitest'
import { glyphOffset, joiningSide, kashidaText } from '@ascii-fx/core'

const TATWEEL = 'ـ'
const ZWJ = '‍'

describe('joining (ALGORITHM.md §13)', () => {
  it('reads a presentation form off its code point', () => {
    expect(joiningSide('ﺏ')).toBeNull() // beh isolated
    expect(joiningSide('ﺐ')).toBe('right') // final
    expect(joiningSide('ﺑ')).toBe('left') // initial
    expect(joiningSide('ﺒ')).toBe('both') // medial
    expect(joiningSide('ﻻ')).toBeNull() // lam-alef isolated
  })

  it('reads a right-to-left glyph string off its joiners', () => {
    expect(joiningSide(`${ZWJ}ب`)).toBe('right')
    expect(joiningSide(`ب${ZWJ}`)).toBe('left')
    expect(joiningSide(`${ZWJ}ب${ZWJ}`)).toBe('both')
    expect(joiningSide('ب')).toBeNull()
    expect(joiningSide(TATWEEL)).toBe('both')
  })

  it('never joins a left-to-right glyph, joiner or not', () => {
    expect(joiningSide('A')).toBeNull()
    expect(joiningSide(`${ZWJ}क`)).toBeNull()
  })

  it('puts kashida on the joining side, before the letter for a join on the right', () => {
    expect(kashidaText('ﺐ', 2)).toBe(`${TATWEEL}${TATWEEL}ﺐ`)
    expect(kashidaText('ﺑ', 2)).toBe(`ﺑ${TATWEEL}${TATWEEL}`)
    expect(kashidaText('ﺒ', 1)).toBe(`${TATWEEL}ﺒ${TATWEEL}`)
    expect(kashidaText('ﺏ', 3)).toBe('ﺏ')
    expect(kashidaText('A', 3)).toBe('A')
  })

  it('places a glyph so its join reaches the cell edge', () => {
    // 10 wide in a 20 cell; with kashida the drawn run is 40.
    expect(glyphOffset('A', 10, 20)).toBe(5)
    expect(glyphOffset('ﺑ', 10, 20)).toBe(10) // initial, flush right
    expect(glyphOffset('ﺑ', 10, 20, 40)).toBe(-20) // its kashida runs off the left
    expect(glyphOffset('ﺐ', 10, 20)).toBe(10) // final without kashida: flush right
    expect(glyphOffset('ﺐ', 10, 20, 40)).toBe(0) // with: letter left, kashida off the right
    expect(glyphOffset('ﺒ', 10, 20, 40)).toBe(-10) // medial: letter centred
  })

  it('leaves a glyph that fills its cell at 0 whatever it is', () => {
    for (const g of ['A', 'ﺐ', 'ﺑ', 'ﺒ']) expect(glyphOffset(g, 20, 20)).toBe(0)
  })
})
