// The failure mode this guards against: a browser accepts requestDevice, accepts
// every pipeline, and then reports a validation error, so the renderer reports
// backend 'webgpu' at a healthy frame rate and paints nothing. WebGPU never
// throws for that — errors go to an error scope or to 'uncapturederror' — so it
// is invisible unless the renderer asks. `auto` has to notice and take the CPU
// matcher instead of sitting on a GPU path that produces no pixels.
import { describe, expect, it } from 'vitest'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { makeProfile, randomImage, STANDARD_SIX } from '../../core/test/synthetic.js'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator ? (await navigator.gpu.requestAdapter()) !== null : false

/**
 * Provoke a validation error from inside the renderer's own setup, the way a
 * browser with different limits would. MAP_READ may only be paired with
 * COPY_DST, so this combination is invalid everywhere and captured by whatever
 * error scope is open at the time.
 */
function injectSetupError(): () => void {
  const proto = GPUDevice.prototype
  const original = proto.createShaderModule
  let injected = false
  proto.createShaderModule = function (this: GPUDevice, descriptor: GPUShaderModuleDescriptor) {
    if (!injected) {
      injected = true
      this.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE })
    }
    return original.call(this, descriptor)
  }
  return () => void (proto.createShaderModule = original)
}

describe.skipIf(!gpuAvailable)('webgpu that accepts setup and then fails', () => {
  it("falls back to the exact CPU matcher under backend 'auto'", async () => {
    const restore = injectSetupError()
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      // No explicit backend: this is the default path the showcase uses.
      const renderer = await createAsciiRenderer({ canvas, profile: makeProfile(STANDARD_SIX), columns: 8 })
      expect(renderer.backend).toBe('cpu')

      // And it has to actually render, which is the whole point of falling back.
      // Reaching the CPU backend at all also proves setup stopped before binding
      // the canvas to a 'webgpu' context, since a bound canvas cannot yield a 2d one.
      renderer.setSource(randomImage(32, 32, 11))
      const frame = await renderer.captureFrame()
      expect(frame.columns).toBe(8)
      expect(frame.glyphIds.length).toBeGreaterThan(0)
      renderer.destroy()
    } finally {
      restore()
    }
  })

  it("still throws for an explicit backend: 'webgpu', rather than pretending", async () => {
    const restore = injectSetupError()
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      await expect(
        createAsciiRenderer({ canvas, profile: makeProfile(STANDARD_SIX), columns: 8, backend: 'webgpu' }),
      ).rejects.toThrow(/reported an error/)
    } finally {
      restore()
    }
  })
})
