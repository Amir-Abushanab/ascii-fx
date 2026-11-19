// The WebGPU backend against a real <video>. See videoScenarios.ts.
import { describe, expect, it } from 'vitest'
import { videoScenarios } from './videoScenarios.js'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

describe.runIf(gpuAvailable)('a real video on the WebGPU backend', () => {
  videoScenarios('webgpu')
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('video suite skipped — no adapter in this browser', () => {
    expect(gpuAvailable).toBe(false)
  })
})
