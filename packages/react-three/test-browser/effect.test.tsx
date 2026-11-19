// <AsciiEffect> in a real React Three Fiber root, on a real WebGPURenderer. The pass
// underneath is conformance-tested in packages/three; what only this can show is the
// wiring: that the hook builds a pass on R3F's renderer, takes over the frame, and pushes
// a changed option through to it.
import { createRoot, extend } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { afterEach, describe, expect, it } from 'vitest'
import type { AsciiPass } from '@ascii-fx/three'
import { useAsciiEffect, type UseAsciiEffectOptions } from '../src/index.js'
import { STANDARD_SIX, makeProfile } from '../../core/test/synthetic.js'

// <Canvas> registers three's classes as JSX elements; a root made by hand has to be told.
extend(THREE as never)

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

async function until(predicate: () => boolean, ms = 8000): Promise<boolean> {
  const deadline = performance.now() + ms
  while (!predicate() && performance.now() < deadline) {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  }
  return predicate()
}

type Root = ReturnType<typeof createRoot<HTMLCanvasElement>>
let root: Root | undefined
let canvas: HTMLCanvasElement | undefined

afterEach(() => {
  root?.unmount()
  canvas?.remove()
  root = undefined
  canvas = undefined
})

describe.runIf(gpuAvailable)('<AsciiEffect> in a React Three Fiber root', () => {
  it('renders the scene through a pass, and pushes changed options to it', async () => {
    canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 96
    document.body.append(canvas)
    root = createRoot(canvas)
    await root.configure({
      // The factory the README shows: R3F hands over its renderer props and waits.
      gl: async (props) => {
        const renderer = new THREE.WebGPURenderer(props as never)
        await renderer.init()
        return renderer
      },
      size: { width: 128, height: 96, top: 0, left: 0 },
      dpr: 1,
    })

    let pass: AsciiPass | null = null
    function Probe(props: UseAsciiEffectOptions): null {
      pass = useAsciiEffect(props)
      return null
    }
    const profile = makeProfile(STANDARD_SIX)
    const scene = (options: Partial<UseAsciiEffectOptions>): React.ReactNode => (
      <>
        <mesh>
          <planeGeometry args={[4, 4]} />
          <meshBasicMaterial color="white" />
        </mesh>
        <Probe
          profile={profile}
          columns={12}
          color="full"
          interaction={{ type: 'reveal', source: 'motion' }}
          {...options}
        />
      </>
    )
    const options = (): { motion?: { threshold?: number }; jitter?: number } =>
      (pass as unknown as { matchOpts: { motion?: { threshold?: number }; jitter?: number } })
        .matchOpts

    root.render(scene({ motion: { threshold: 0.1 } }))
    // A grid means the pass has matched a frame: R3F's loop is running through it.
    expect(await until(() => pass !== null && pass.grid() !== null)).toBe(true)
    expect(pass!.grid()!.columns).toBe(12)
    expect(options().motion).toEqual({ threshold: 0.1 })

    // `motion` was left out of the key that decides when to push options, so a change to
    // it alone never reached the pass.
    root.render(scene({ motion: { threshold: 0.4 } }))
    expect(await until(() => options().motion?.threshold === 0.4)).toBe(true)

    // And an option that was already in the key still gets there.
    root.render(scene({ motion: { threshold: 0.4 }, jitter: 60 }))
    expect(await until(() => options().jitter === 60)).toBe(true)

    const frame = await pass!.captureFrame()
    expect(frame.columns).toBe(12)
    expect(frame.colorMode).toBe('full')
  })
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('R3F suite skipped — no adapter in this browser', () => {
    expect(gpuAvailable).toBe(false)
  })
})
