// A renderer that cannot be built is invisible by design: the <img>/<video> fallback is
// already on screen and simply stays there, which is the right thing to look at but the
// wrong thing to be silent about. `onError` is the only way an app learns the canvas
// never took over, so this pins that it actually fires — and that it is not forwarded
// into the renderer options along the way.
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_GPU_GLYPHS, type AsciiProfile } from '@ascii-fx/gpu'
import { AsciiImage } from '../src/components.js'
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
