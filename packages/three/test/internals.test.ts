// The accessors in internals.ts read properties three does not document, so what they say
// when one is missing, and what the package says about a three it was never built for, is
// the whole of the support story a user gets. Neither needs a GPU to check.
import { REVISION } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCanvasContext, getDevice, getGpuTexture, isInitialized } from '../src/internals.js'

const fake = (shape: object): WebGPURenderer => shape as unknown as WebGPURenderer

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('three version warning', () => {
  it('says nothing for a three inside the peer range, however new', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { warnIfTooOld } = await import('../src/internals.js')
    expect(warnIfTooOld()).toBe(false) // the three this repo is developed on
    expect(warnIfTooOld('170')).toBe(false) // the floor itself
    expect(warnIfTooOld('999')).toBe(false) // newer than anything tested: no nagging
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once for a three below the peer range, naming it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { warnIfTooOld } = await import('../src/internals.js')
    expect(warnIfTooOld('169')).toBe(true)
    expect(warnIfTooOld('169')).toBe(false)
    expect(warnIfTooOld('150')).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(
      /three r169 is older than @ascii-fx\/three supports \(r170/,
    )
  })
})

describe('renderer internals', () => {
  it('names the running three and the tested ones when an internal is missing', () => {
    const tested = new RegExp(`this is three r${REVISION}; tested on r170, r174, r178 and r187`)
    expect(() => getCanvasContext(fake({ backend: {} }))).toThrow(tested)
    expect(() => getGpuTexture(fake({ backend: { get: () => undefined } }), {} as never)).toThrow(
      tested,
    )
  })

  it('asks for an initialized renderer rather than blaming the version', () => {
    expect(() => getDevice(fake({}))).toThrow(/await renderer\.init\(\)/)
  })

  it('reads initialization from the getter or from the private flag older three has', () => {
    expect(isInitialized(fake({ initialized: true }))).toBe(true)
    expect(isInitialized(fake({ _initialized: true }))).toBe(true)
    expect(isInitialized(fake({ _initialized: false }))).toBe(false)
    expect(isInitialized(fake({}))).toBe(false)
  })
})
