import { describe, expect, it } from 'vitest'
import { bytesToHex, fdiv, hexToBytes, idiv, nextPow2, popcount32, rdiv } from '@ascii-fx/core'

describe('integer ops (ALGORITHM.md §0)', () => {
  it('idiv truncates toward −∞ for non-negative operands', () => {
    expect(idiv(7, 2)).toBe(3)
    expect(idiv(8, 2)).toBe(4)
    expect(idiv(0, 5)).toBe(0)
  })

  it('fdiv floors toward −∞', () => {
    expect(fdiv(-7, 2)).toBe(-4)
    expect(fdiv(7, -2)).toBe(-4)
    expect(fdiv(-7, -2)).toBe(3)
  })

  it('rdiv rounds half up (toward +∞)', () => {
    expect(rdiv(3, 2)).toBe(2)
    expect(rdiv(5, 2)).toBe(3)
    expect(rdiv(4, 2)).toBe(2)
    expect(rdiv(-3, 2)).toBe(-1)
    expect(rdiv(-1, 2)).toBe(0)
    expect(rdiv(-5, 2)).toBe(-2)
    expect(rdiv(0, 7)).toBe(0)
  })

  it('popcount32 over edge patterns', () => {
    expect(popcount32(0)).toBe(0)
    expect(popcount32(0xffffffff)).toBe(32)
    expect(popcount32(0x80000001)).toBe(2)
    expect(popcount32(0x55555555)).toBe(16)
  })

  it('nextPow2', () => {
    expect(nextPow2(1)).toBe(1)
    expect(nextPow2(2)).toBe(2)
    expect(nextPow2(3)).toBe(4)
    expect(nextPow2(38)).toBe(64)
    expect(nextPow2(64)).toBe(64)
  })

  it('hex roundtrip', () => {
    const bytes = new Uint8Array([0, 1, 0xab, 0xff])
    expect(bytesToHex(bytes)).toBe('0001abff')
    expect(hexToBytes('0001abff')).toEqual(bytes)
  })
})
