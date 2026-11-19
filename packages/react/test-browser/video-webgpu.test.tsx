// <AsciiVideo> on the WebGPU backend with a real clip. See videoScenarios.tsx.
import { describe, expect, it } from 'vitest'
import { asciiVideoScenarios } from './videoScenarios.js'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

describe.runIf(gpuAvailable)('<AsciiVideo> with a real clip, WebGPU backend', () => {
  asciiVideoScenarios('webgpu')
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('video suite skipped — no adapter in this browser', () => {
    expect(gpuAvailable).toBe(false)
  })
})
