// A GPUDevice can be taken away at any moment: the browser reclaims it under
// memory pressure (WebKit does this readily), the GPU process crashes, a driver
// resets. Nothing throws when that happens — submits against a lost device are
// validly dropped — so a renderer that does not watch for it keeps its loop
// running, keeps reporting a grid, and leaves a stale frame on screen. These
// tests hold the renderer to noticing and rebuilding on a fresh device.
import { describe, expect, it } from 'vitest'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { makeProfile, randomImage, STANDARD_SIX } from '../../core/test/synthetic.js'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

/**
 * Devices are created inside the renderer, so we intercept them on the way out
 * rather than reaching into private state. Returns a live list plus a restore.
 */
function captureDevices(): { devices: GPUDevice[]; restore: () => void } {
  const proto = GPUAdapter.prototype as unknown as { requestDevice: GPUAdapter['requestDevice'] }
  const original = proto.requestDevice
  const devices: GPUDevice[] = []
  proto.requestDevice = async function (this: GPUAdapter, ...args) {
    const device = await original.apply(this, args)
    devices.push(device)
    return device
  }
  return { devices, restore: () => void (proto.requestDevice = original) }
}

/** Wait for `predicate`, polling frames, so recovery gets real time to happen. */
async function until(predicate: () => boolean, ms = 4000): Promise<boolean> {
  const deadline = performance.now() + ms
  while (!predicate() && performance.now() < deadline) {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  }
  return predicate()
}

describe.skipIf(!gpuAvailable)('webgpu device loss', () => {
  it('rebuilds on a new device and keeps producing exact frames', async () => {
    const { devices, restore } = captureDevices()
    try {
      const profile = makeProfile(STANDARD_SIX)
      const source = randomImage(64, 64, 7)
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const renderer = await createAsciiRenderer({ canvas, profile, columns: 8, backend: 'webgpu' })
      renderer.setSource(source)
      const before = await renderer.captureFrame()
      expect(devices).toHaveLength(1)

      devices[0].destroy() // what memory pressure looks like from in here

      const recovered = await until(() => devices.length > 1)
      expect(recovered, 'renderer should have requested a replacement device').toBe(true)

      // The real test: the frame is still correct, not just non-empty. A
      // half-rebuilt engine would match against an empty atlas and agree with
      // nothing.
      const after = await renderer.captureFrame()
      expect(after.columns).toBe(before.columns)
      expect(after.rows).toBe(before.rows)
      expect(after.glyphIds).toEqual(before.glyphIds)
      renderer.destroy()
    } finally {
      restore()
    }
  })

  it('does not treat its own destroy() as a loss to recover from', async () => {
    const { devices, restore } = captureDevices()
    try {
      const profile = makeProfile(STANDARD_SIX)
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const renderer = await createAsciiRenderer({ canvas, profile, columns: 8, backend: 'webgpu' })
      renderer.setSource(randomImage(32, 32, 3))
      await renderer.captureFrame()
      expect(devices).toHaveLength(1)

      renderer.destroy()
      // Give a recovery attempt every chance to fire before ruling it out.
      await until(() => devices.length > 1, 1200)
      expect(devices, 'destroy() must not resurrect the renderer').toHaveLength(1)
    } finally {
      restore()
    }
  })

  // Per spec a stale adapter RESOLVES requestDevice with an already-lost
  // device (every op on it no-ops), so a naive recover() "succeeds", watches
  // the dead device, sees it lost, and recovers again — an unbounded, silent
  // loop that re-runs full engine setup per cycle and never fires
  // onDeviceLost. The cascade must be bounded and must signal.
  it('bounds recovery and signals when replacement devices arrive already lost', async () => {
    const proto = GPUAdapter.prototype as unknown as { requestDevice: GPUAdapter['requestDevice'] }
    const original = proto.requestDevice
    const profile = makeProfile(STANDARD_SIX)
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    let lostInfo: GPUDeviceLostInfo | undefined
    const renderer = await createAsciiRenderer({
      canvas,
      profile,
      columns: 8,
      backend: 'webgpu',
      onDeviceLost: (info) => {
        lostInfo = info
      },
    })
    let handedOut = 0
    try {
      renderer.setSource(randomImage(64, 64, 9))
      await renderer.captureFrame()
      // From here, every replacement device is dead on arrival.
      proto.requestDevice = async function (this: GPUAdapter, ...args) {
        const device = await original.apply(this, args)
        handedOut++
        device.destroy()
        return device
      }
      ;(renderer as unknown as { device: GPUDevice }).device.destroy()

      const signalled = await until(() => lostInfo !== undefined, 8000)
      expect(signalled, 'onDeviceLost must fire instead of looping forever').toBe(true)
      expect(handedOut, 'recovery attempts must be bounded').toBeLessThanOrEqual(3)
    } finally {
      proto.requestDevice = original
      renderer.destroy()
    }
  })
})
