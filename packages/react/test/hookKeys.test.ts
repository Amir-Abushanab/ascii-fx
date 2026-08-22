import { describe, expect, it } from 'vitest'
import { profileSourceKey, rendererOptionsKey } from '../src/hookKeys.js'

describe('React hook dependency keys', () => {
  it('distinguishes different binary profile objects with the same byte length', () => {
    const first = new Uint8Array([1, 2, 3, 4])
    const second = new Uint8Array([5, 6, 7, 8])
    expect(profileSourceKey(first)).toBe(profileSourceKey(first))
    expect(profileSourceKey(second)).not.toBe(profileSourceKey(first))
  })

  it('tracks temporal and adaptive-resolution option changes', () => {
    expect(rendererOptionsKey({ temporal: false })).not.toBe(rendererOptionsKey({ temporal: true }))
    expect(rendererOptionsKey({ matcher: 'structural' })).not.toBe(
      rendererOptionsKey({ matcher: 'chromatic' }),
    )
    expect(rendererOptionsKey({ hysteresis: 0 })).not.toBe(rendererOptionsKey({ hysteresis: 0.1 }))
    expect(rendererOptionsKey({ adaptiveResolution: false })).not.toBe(
      rendererOptionsKey({ adaptiveResolution: true }),
    )
  })
})
