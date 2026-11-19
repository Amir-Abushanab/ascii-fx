// Every WebGPU renderer on a page leases one shared GPUDevice, and one engine per profile on
// it (sharedDevice.ts). A device and an engine each used to be a gallery of images' worth of
// identical pipelines and atlases; browsers budget devices, and can refuse the next one.
//
// What has to hold: sharing changes nothing a renderer produces, one renderer going away
// leaves the others whole, the device goes with the last of them, and a lost device is
// replaced once for everybody rather than once each.
import { describe, expect, it } from 'vitest'
import { matchFrame } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import type { AsciiRenderer } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile, randomImage, randomProfile } from '../../core/test/synthetic.js'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

/** Devices are created inside the pool, so they are counted on the way out. */
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

async function until(predicate: () => boolean, ms = 4000): Promise<boolean> {
  const deadline = performance.now() + ms
  while (!predicate() && performance.now() < deadline) {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  }
  return predicate()
}

type Internals = { device: GPUDevice; engine: object }
const inside = (renderer: AsciiRenderer): Internals => renderer as unknown as Internals

const make = (profile = makeProfile(STANDARD_SIX)): Promise<AsciiRenderer> =>
  createAsciiRenderer({
    canvas: new OffscreenCanvas(64, 64),
    profile,
    backend: 'webgpu',
    columns: 12,
    color: 'full',
  })

const withHandler = (onError: (error: GPUError) => void): Promise<AsciiRenderer> =>
  createAsciiRenderer({
    canvas: new OffscreenCanvas(64, 64),
    profile: makeProfile(STANDARD_SIX),
    backend: 'webgpu',
    onError,
  })

async function expectExact(
  renderer: AsciiRenderer,
  seed: number,
  profile = makeProfile(STANDARD_SIX),
): Promise<void> {
  const image = randomImage(96, 56, seed)
  renderer.setSource(image)
  const gpu = await renderer.captureFrame()
  const cpu = matchFrame(image, { profile, columns: 12, color: 'full' })
  expect(gpu.glyphIds).toEqual(cpu.glyphIds)
  expect(gpu.foreground).toEqual(cpu.foreground)
  expect(gpu.background).toEqual(cpu.background)
}

describe.skipIf(!gpuAvailable)('shared GPU device', () => {
  it('gives every renderer of one profile the same device and engine', async () => {
    const { devices, restore } = captureDevices()
    try {
      // Created together, as a page of components mounting at once does. Separate profile
      // objects with the same content, which is what each component loads for itself.
      const renderers = await Promise.all([make(), make(), make()])
      expect(devices).toHaveLength(1)
      expect(inside(renderers[1]).device).toBe(inside(renderers[0]).device)
      expect(inside(renderers[2]).engine).toBe(inside(renderers[0]).engine)
      // Each still matches its own source, exactly.
      await Promise.all(renderers.map((r, i) => expectExact(r, 20 + i)))
      for (const r of renderers) r.destroy()
    } finally {
      restore()
    }
  })

  it('keeps profiles apart: one device, an engine each', async () => {
    const { devices, restore } = captureDevices()
    try {
      const other = randomProfile(40, 9)
      const a = await make()
      const b = await make(other)
      expect(devices).toHaveLength(1)
      expect(inside(b).device).toBe(inside(a).device)
      expect(inside(b).engine).not.toBe(inside(a).engine)
      await expectExact(a, 31)
      await expectExact(b, 32, other)
      a.destroy()
      b.destroy()
    } finally {
      restore()
    }
  })

  it('outlives the renderers that leave, and goes with the last one', async () => {
    const { devices, restore } = captureDevices()
    try {
      const a = await make()
      const b = await make()
      const device = devices[0]
      let lost: GPUDeviceLostInfo | undefined
      void device.lost.then((info) => {
        lost = info
      })

      a.destroy()
      await new Promise((r) => setTimeout(r, 50))
      expect(lost, 'still in use by the other renderer').toBeUndefined()
      await expectExact(b, 41)

      b.destroy()
      expect(await until(() => lost !== undefined)).toBe(true)
      expect(lost!.reason).toBe('destroyed')

      // And the next renderer starts a new one rather than finding the dead one.
      const c = await make()
      expect(devices).toHaveLength(2)
      await expectExact(c, 42)
      c.destroy()
    } finally {
      restore()
    }
  })

  it('replaces a lost device once, for every renderer on it', async () => {
    const { devices, restore } = captureDevices()
    try {
      const a = await make()
      const b = await make()
      await expectExact(a, 51)
      await expectExact(b, 52)

      devices[0].destroy() // what memory pressure looks like from in here

      expect(await until(() => devices.length > 1)).toBe(true)
      // captureFrame waits out each renderer's rebuild.
      await expectExact(a, 53)
      await expectExact(b, 54)
      expect(devices, 'one replacement, shared, not one each').toHaveLength(2)
      expect(inside(b).device).toBe(inside(a).device)
      expect(inside(a).device).toBe(devices[1])
      a.destroy()
      b.destroy()
    } finally {
      restore()
    }
  })

  // An uncaught GPU error is raised on the device, with nothing to say whose work it was.
  // With every renderer listening on the one device, a single fault would otherwise be
  // reported once per canvas on the page.
  it('reports an uncaught GPU error once, not once per renderer', async () => {
    const shared: string[] = []
    const report = (error: GPUError): void => void shared.push(error.message)
    const own: string[] = []
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    const renderers: AsciiRenderer[] = []
    try {
      // Three that report to the same place, one with a handler of its own, two with none.
      renderers.push(
        await withHandler(report),
        await withHandler(report),
        await withHandler(report),
      )
      renderers.push(await withHandler((error) => void own.push(error.message)))
      renderers.push(await make(), await make())

      // Invalid everywhere, and outside any error scope: MAP_READ only pairs with COPY_DST.
      // The error comes back from the GPU process with the next round trip, which a render
      // loop makes every frame and this test has to ask for.
      const provoke = async (): Promise<void> => {
        const { device } = inside(renderers[0])
        device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE })
        await device.queue.onSubmittedWorkDone()
      }
      await provoke()
      expect(await until(() => shared.length > 0 && own.length > 0 && logged.length > 0)).toBe(true)
      await new Promise((r) => setTimeout(r, 100))
      expect(shared, 'the handler three renderers share').toHaveLength(1)
      expect(own, 'a handler of its own').toHaveLength(1)
      expect(logged, 'the two renderers with no handler').toHaveLength(1)

      // A renderer that has gone no longer hears anything.
      renderers.pop()!.destroy()
      renderers.pop()!.destroy()
      await provoke()
      expect(await until(() => shared.length > 1)).toBe(true)
      await new Promise((r) => setTimeout(r, 100))
      expect(logged, 'nobody left without a handler').toHaveLength(1)
    } finally {
      console.error = original
      for (const r of renderers) r.destroy()
    }
  })

  it('does not let a failed setup poison the next one', async () => {
    const { devices, restore } = captureDevices()
    try {
      const good = await make()
      // A profile the engine refuses: its atlas claims to be larger than any texture.
      const base = makeProfile(STANDARD_SIX)
      const huge = { ...base, atlas: { ...base.atlas, width: 1 << 20 } }
      await expect(make(huge)).rejects.toThrow(/texture limit/)
      // The device is still good, for the renderer already on it and for a new one.
      await expectExact(good, 61)
      const next = await make()
      expect(devices).toHaveLength(1)
      await expectExact(next, 62)
      good.destroy()
      next.destroy()
    } finally {
      restore()
    }
  })
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('shared-device suite skipped — no adapter in this browser', () => {
    expect(gpuAvailable).toBe(false)
  })
})
