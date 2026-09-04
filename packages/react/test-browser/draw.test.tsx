// The `draw` seam is the only place a pixel effect can live for <AsciiImage>: the matcher
// is exact about what it is handed, so grain, contrast curves and the rest belong upstream
// of it. What has to hold is that the callback is actually what the matcher sees (a buffer
// at the image's natural size, painted before the first match), that `animate` drives a
// throttled loop rather than the display-rate one, and that none of the three new props
// leak through the `...options` rest into the renderer.
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { AsciiImage, type AsciiDraw } from '../src/components.js'
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

/** A real, decodable source: 16×16, half black and half white, as a data URL. */
function testImage(): string {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 16, 16)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 8, 16)
  return c.toDataURL()
}

function mount(node: React.ReactElement): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(node)
  return host
}

describe('AsciiImage draw', () => {
  it('paints a still once, into a buffer the image is its natural size', async () => {
    const calls: { width: number; height: number; timeMs: number }[] = []
    const draw: AsciiDraw = (ctx, source, timeMs) => {
      calls.push({ width: source.width, height: source.height, timeMs })
      ctx.drawImage(source.image, 0, 0)
    }
    mount(
      <AsciiImage
        src={testImage()}
        alt="probe"
        profile={makeProfile(STANDARD_SIX)}
        columns={8}
        draw={draw}
      />,
    )

    expect(await until(() => calls.length > 0)).toBe(true)
    expect(calls[0]).toEqual({ width: 16, height: 16, timeMs: 0 })
    // A still is a still: no loop, so nothing repaints on its own.
    await new Promise((r) => setTimeout(r, 200))
    expect(calls.length).toBe(1)
  })

  it('drives a throttled loop under `animate`, and stops it on unmount', async () => {
    let calls = 0
    const draw: AsciiDraw = (ctx, source) => {
      calls++
      ctx.drawImage(source.image, 0, 0)
    }
    mount(
      <AsciiImage
        src={testImage()}
        alt="probe"
        profile={makeProfile(STANDARD_SIX)}
        columns={8}
        draw={draw}
        animate
        fps={30}
      />,
    )

    expect(await until(() => calls > 3)).toBe(true)
    root?.unmount()
    root = undefined
    const settled = calls
    await new Promise((r) => setTimeout(r, 200))
    // An unmounted component must not still be matching frames.
    expect(calls).toBe(settled)
  })

  it('does not leak draw, animate or fps into the renderer options', async () => {
    const seen: string[] = []
    const el = mount(
      <AsciiImage
        src={testImage()}
        alt="probe"
        profile={makeProfile(STANDARD_SIX)}
        columns={8}
        draw={(ctx, source) => ctx.drawImage(source.image, 0, 0)}
        animate
        fps={10}
        onError={(e) => seen.push(e.message)}
      />,
    )
    expect(await until(() => el.querySelector('canvas') !== null)).toBe(true)
    await new Promise((r) => setTimeout(r, 100))
    expect(seen).toEqual([])
  })
})
