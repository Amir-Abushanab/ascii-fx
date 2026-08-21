// `backend: 'auto'` picks a backend once, when the renderer is constructed. That
// leaves a gap the option's name does not suggest: if WebGPU is there at mount
// and the device dies later, nothing re-runs the choice, and the component sits
// on a dead renderer. The hook closes it by remounting the canvas — a fresh
// element is required, since one that has held a 'webgpu' context can never be
// given a 2d one — which lets 'auto' run again against current conditions.
import { useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { AsciiProfile, AsciiRenderer } from '@ascii-fx/gpu'
import { useAscii } from '../src/hooks.js'
import { G_FULL, G_SPACE, G_TOP, makeProfile, STANDARD_SIX } from '../../core/test/synthetic.js'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator ? (await navigator.gpu.requestAdapter()) !== null : false

let root: Root | undefined
let host: HTMLElement | undefined

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = undefined
  host = undefined
})

async function until(predicate: () => boolean, ms = 6000): Promise<boolean> {
  const deadline = performance.now() + ms
  while (!predicate() && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 16))
  }
  return predicate()
}

describe.skipIf(!gpuAvailable)('useAscii device loss', () => {
  it('remounts the canvas so auto can fall back to CPU when the GPU is gone', async () => {
    const seen: { renderer: AsciiRenderer | null } = { renderer: null }

    function Probe({ profile }: { profile: AsciiProfile }): React.ReactElement {
      const ref = useRef<HTMLCanvasElement>(null)
      const { renderer, canvasKey } = useAscii(ref, { profile, columns: 8 })
      seen.renderer = renderer
      return <canvas key={canvasKey} ref={ref} data-role="out" />
    }

    // Capture devices, and let us cut off the supply of new ones so the
    // renderer's own rebuild fails and the React path has to take over.
    const adapterProto = GPUAdapter.prototype as unknown as { requestDevice: GPUAdapter['requestDevice'] }
    const originalRequestDevice = adapterProto.requestDevice
    const originalRequestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu)
    let gpuIsGone = false
    const devices: GPUDevice[] = []
    adapterProto.requestDevice = async function (this: GPUAdapter, ...args) {
      const device = await originalRequestDevice.apply(this, args)
      devices.push(device)
      return device
    }
    navigator.gpu.requestAdapter = async (...args) => (gpuIsGone ? null : originalRequestAdapter(...args))

    try {
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      root.render(<Probe profile={makeProfile(STANDARD_SIX)} />)

      expect(await until(() => seen.renderer?.backend === 'webgpu'), 'should start on WebGPU').toBe(true)
      const first = host.querySelector('canvas')
      expect(devices).toHaveLength(1)

      gpuIsGone = true
      devices[0].destroy()

      expect(await until(() => seen.renderer?.backend === 'cpu'), 'should end up on the CPU matcher').toBe(true)
      // A new element, not the old one reconfigured: that is the whole point.
      expect(host.querySelector('canvas')).not.toBe(first)
    } finally {
      adapterProto.requestDevice = originalRequestDevice
      navigator.gpu.requestAdapter = originalRequestAdapter
    }
  })
})

describe.skipIf(!gpuAvailable)('useAscii overlapping inits', () => {
  // Two inits overlapping on the same canvas element are poison: each create
  // configures the shared GPUCanvasContext in its constructor, so if the
  // superseded init resolves LAST, its destroy() unconfigures the context out
  // from under the survivor — a dead canvas until reload. StrictMode's dev
  // double-invoke hits this on every mount; a rapid profile swap is the
  // production version and what this test stages (StrictMode is a no-op in
  // the production React build these tests run under). Delaying only the
  // first requestDevice forces the losing resolution order deterministically.
  it('the surviving renderer keeps a configured context when the superseded init resolves last', async () => {
    const adapterProto = GPUAdapter.prototype as unknown as { requestDevice: GPUAdapter['requestDevice'] }
    const original = adapterProto.requestDevice
    let call = 0
    let firstDevice: GPUDevice | undefined
    adapterProto.requestDevice = async function (this: GPUAdapter, ...args) {
      const n = ++call
      const device = await original.apply(this, args)
      if (n === 1) {
        firstDevice = device
        await new Promise((r) => setTimeout(r, 250))
      }
      return device
    }
    const seen: { renderer: AsciiRenderer | null } = { renderer: null }
    function Probe({ profile }: { profile: AsciiProfile }): React.ReactElement {
      const ref = useRef<HTMLCanvasElement>(null)
      const { renderer, canvasKey } = useAscii(ref, { profile, columns: 8, backend: 'webgpu' })
      seen.renderer = renderer
      return <canvas key={canvasKey} ref={ref} width={64} height={64} />
    }
    try {
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      root.render(<Probe profile={makeProfile(STANDARD_SIX)} />)
      expect(await until(() => call >= 1), 'first init should start').toBe(true)
      // Same component position, same canvas element, genuinely different
      // profile (useAsciiProfile keys by fingerprint, so an equal rebuild
      // would not re-run the effect): init #2 starts while #1 is in flight.
      root.render(<Probe profile={makeProfile([G_SPACE, G_FULL, G_TOP])} />)
      expect(await until(() => seen.renderer !== null && call >= 2), 'swapped init should complete').toBe(true)
      // The superseded renderer's destroy is the moment it used to unconfigure
      // the survivor's context; its device's `lost` resolves right then.
      await Promise.race([firstDevice!.lost, new Promise((r) => setTimeout(r, 4000))])
      await new Promise((r) => setTimeout(r, 50))

      // The direct invariant: the survivor's context must still be configured.
      // getCurrentTexture throws InvalidStateError on an unconfigured context,
      // which is exactly the dead-canvas state the unserialized hook produced.
      const white = { width: 16, height: 8, data: new Uint8Array(16 * 8 * 4).fill(255) }
      seen.renderer!.setSource(white)
      expect(() => seen.renderer!.render(), 'survivor must render without throwing').not.toThrow()
      const contextAlive = (): boolean => {
        try {
          ;(seen.renderer as unknown as { context: GPUCanvasContext }).context.getCurrentTexture()
          return true
        } catch {
          return false
        }
      }
      expect(contextAlive(), 'survivor must still own a configured context').toBe(true)
    } finally {
      adapterProto.requestDevice = original
    }
  })
})
