// A renderer that cannot be built is invisible by design: the <img>/<video> fallback is
// already on screen and simply stays there, which is the right thing to look at but the
// wrong thing to be silent about. `onError` is the only way an app learns the canvas
// never took over, so this pins that it actually fires — and that it is not forwarded
// into the renderer options along the way.
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_GPU_GLYPHS, type AsciiProfile } from '@ascii-fx/gpu'
import { AsciiCanvas, AsciiImage } from '../src/components.js'
import { makeProfile, STANDARD_SIX } from '../../core/test/synthetic.js'

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

/**
 * A profile the WebGPU backend must refuse: the matcher's glyph budget is a hard
 * `MAX_GPU_GLYPHS` and the check reads `glyphCount` before it ever touches an adapter,
 * so this fails the same way on a machine with a GPU and on a headless runner without.
 */
function oversizedProfile(): AsciiProfile {
  const p = makeProfile(STANDARD_SIX)
  return { ...p, glyphCount: MAX_GPU_GLYPHS + 1 }
}

describe('AsciiImage onError', () => {
  it('reports a renderer that could not be built, and keeps the fallback visible', async () => {
    const errors: Error[] = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(
      <AsciiImage
        src="/nonexistent.png"
        alt="probe"
        profile={oversizedProfile()}
        backend="webgpu"
        columns={8}
        onError={(e) => errors.push(e)}
      />,
    )

    expect(await until(() => errors.length > 0)).toBe(true)
    expect(errors[0]).toBeInstanceOf(Error)
    // The accessible fallback must still be the thing on screen.
    const img = host.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.style.opacity).toBe('1')
  })

  it('does not leak onError into the renderer options', async () => {
    // `onError` is a component prop, not a renderer option. If it slipped through the
    // `...options` rest it would be handed to setOptions on every render, where an
    // unknown key is at best ignored and at worst throws.
    const seen: string[] = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(
      <AsciiImage
        src="/nonexistent.png"
        alt="probe"
        profile={makeProfile(STANDARD_SIX)}
        columns={8}
        onError={(e) => seen.push(e.message)}
      />,
    )
    expect(await until(() => host!.querySelector('canvas') !== null)).toBe(true)
    // A valid profile on the default backend must build — the CPU fallback needs no GPU —
    // so any error here means an unknown key reached the renderer.
    expect(seen).toEqual([])
  })
})

// The renderer reads its source's pixels when it renders, and that is where an unreadable
// source — cross-origin without CORS, or simply empty — makes itself known: a throw, from
// inside an effect. Uncaught, it takes the component tree with it.
describe('a source that cannot be rendered', () => {
  it('is reported through onError and leaves the tree mounted', async () => {
    const errors: Error[] = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    // A canvas with no pixels: setSource takes it, and the first render refuses it.
    const empty = document.createElement('canvas')
    empty.width = 0
    empty.height = 0
    root.render(
      <AsciiCanvas
        source={empty}
        profile={makeProfile(STANDARD_SIX)}
        backend="cpu"
        columns={8}
        onError={(e) => errors.push(e)}
      >
        <p>fallback</p>
      </AsciiCanvas>,
    )

    expect(await until(() => errors.length > 0)).toBe(true)
    expect(errors[0].message).toMatch(/zero dimensions/)
    // Give a render loop that should not have started the chance to throw.
    await new Promise((r) => setTimeout(r, 200))
    expect(errors).toHaveLength(1)
    expect(host.querySelector('p')?.textContent).toBe('fallback')
    expect(host.querySelector('canvas')).not.toBeNull()
  })

  it('reports an option the renderer refuses instead of throwing from the effect', async () => {
    const errors: Error[] = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const props = {
      src: '/nonexistent.png',
      alt: 'probe',
      profile: makeProfile(STANDARD_SIX),
      backend: 'cpu' as const,
      columns: 8,
      onError: (e: Error) => errors.push(e),
    }
    root.render(<AsciiImage {...props} />)
    expect(await until(() => host!.querySelector('canvas') !== null)).toBe(true)
    await new Promise((r) => setTimeout(r, 200))
    expect(errors).toEqual([])

    root.render(<AsciiImage {...props} jitter={999} />)
    expect(await until(() => errors.length > 0)).toBe(true)
    expect(errors[0].message).toMatch(/jitter/)
    expect(host.querySelector('img')).not.toBeNull()
  })

  it('reports a profile that could not be loaded', async () => {
    const errors: Error[] = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(
      <AsciiImage
        src="/nonexistent.png"
        alt="probe"
        profile={new Uint8Array([1, 2, 3, 4])}
        onError={(e) => errors.push(e)}
      />,
    )
    expect(await until(() => errors.length > 0)).toBe(true)
    expect(errors[0].message).toMatch(/profile/i)
    expect(host.querySelector('img')?.style.opacity).toBe('1')
  })
})

describe('accessible names', () => {
  it('names an AsciiCanvas as an image when given a label', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const source = document.createElement('canvas')
    source.width = 32
    source.height = 16
    root.render(
      <AsciiCanvas
        source={source}
        profile={makeProfile(STANDARD_SIX)}
        backend="cpu"
        columns={8}
        renderMode="manual"
        aria-label="A spinning torus"
      />,
    )
    expect(await until(() => host!.querySelector('canvas') !== null)).toBe(true)
    const wrapper = host.firstElementChild!
    expect(wrapper.getAttribute('role')).toBe('img')
    expect(wrapper.getAttribute('aria-label')).toBe('A spinning torus')
    // The label must not have gone to the renderer as an option.
    expect(host.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
  })
})
