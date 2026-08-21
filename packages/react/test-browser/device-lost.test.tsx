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
import { makeProfile, STANDARD_SIX } from '../../core/test/synthetic.js'

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
