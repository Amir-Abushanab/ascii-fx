// <AsciiVideo> against a real clip, shared by the two suites: one per backend, because the
// CPU half runs anywhere and the WebGPU half only where there is an adapter. A canvas or an
// image cannot stand in for this: the component's loop runs on the video's own frame
// callbacks, and `autoPlay={false}` only means something for an element that can be played.
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { AsciiVideo } from '../src/components.js'
import { makeProfile, STANDARD_SIX } from '../../core/test/synthetic.js'
import {
  clipUrl,
  difference,
  distinctFrames,
  litFraction,
  untilStill,
} from '../../gpu/test-browser/videoScenarios.js'

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

function mount(node: React.ReactNode): HTMLElement {
  host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;width:320px'
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(node)
  return host
}

/** The canvas has taken over from the fallback <video>. */
const ready = (el: HTMLElement): boolean => el.querySelector('video')?.style.opacity === '0'

const profile = makeProfile(STANDARD_SIX)

export function asciiVideoScenarios(backend: 'cpu' | 'webgpu'): void {
  {
    it(`plays by default and the render follows it (${backend})`, async () => {
      const errors: Error[] = []
      const el = mount(
        <AsciiVideo
          src={clipUrl}
          profile={profile}
          backend={backend}
          columns={20}
          color="full"
          onError={(e) => errors.push(e)}
        />,
      )
      expect(await until(() => ready(el))).toBe(true)
      const frames = await distinctFrames(el.querySelector('canvas')!, 4000, 4)
      expect(errors).toEqual([])
      expect(frames.length).toBeGreaterThanOrEqual(4)
    })

    // The loop used to run only when `autoPlay` was on, so a video the page started itself
    // played underneath a render stuck on its first frame.
    it(`waits with autoPlay off, then follows the video you play (${backend})`, async () => {
      const video = createRef<HTMLVideoElement>()
      const errors: Error[] = []
      const el = mount(
        <AsciiVideo
          src={clipUrl}
          profile={profile}
          backend={backend}
          columns={20}
          color="full"
          autoPlay={false}
          videoRef={video}
          aria-label="Test pattern"
          onError={(e) => errors.push(e)}
        />,
      )
      expect(await until(() => ready(el))).toBe(true)
      expect(video.current).toBe(el.querySelector('video'))
      expect(video.current!.getAttribute('aria-label')).toBe('Test pattern')
      expect(video.current!.paused).toBe(true)

      // Nothing is playing, so once the first frame is up the picture does not move.
      const canvas = el.querySelector('canvas')!
      expect(await untilStill(canvas)).toBe(true)
      expect((await distinctFrames(canvas, 400)).length).toBeLessThanOrEqual(1)

      await video.current!.play()
      const playing = await distinctFrames(canvas, 4000, 4)
      expect(playing.length).toBeGreaterThanOrEqual(4)

      video.current!.pause()
      // The last frame may still be on its way through the workers; then nothing moves.
      expect(await untilStill(canvas)).toBe(true)
      expect((await distinctFrames(canvas, 400)).length).toBeLessThanOrEqual(1)
      expect(errors).toEqual([])
    })
  }

  // What is actually on screen, through the browser's own screenshot. Reading the canvas
  // back cannot answer this for WebGPU: its texture goes to the compositor at the end of
  // the frame it was drawn in, so a later read is empty whether or not anything was shown.
  it(`shows a first frame before anything plays (${backend})`, async () => {
    const el = mount(
      <AsciiVideo
        src={clipUrl}
        profile={profile}
        backend={backend}
        columns={20}
        color="full"
        autoPlay={false}
      />,
    )
    expect(await until(() => ready(el))).toBe(true)
    const canvas = el.querySelector('canvas')!
    const onScreen = async (): Promise<Uint8ClampedArray> => {
      const shot = await page.screenshot({ element: canvas, save: false })
      const image = new Image()
      image.src = `data:image/png;base64,${shot}`
      await image.decode()
      const probe = document.createElement('canvas')
      probe.width = image.naturalWidth
      probe.height = image.naturalHeight
      const ctx = probe.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      return ctx.getImageData(0, 0, probe.width, probe.height).data
    }
    let shown = await onScreen()
    for (let i = 0; i < 20 && litFraction(shown) < 0.02; i++) {
      await new Promise((r) => setTimeout(r, 100))
      shown = await onScreen()
    }
    expect(litFraction(shown)).toBeGreaterThan(0.02)
    // Nothing is playing, so it is the same picture a moment later.
    await new Promise((r) => setTimeout(r, 200))
    expect(difference(await onScreen(), shown)).toBeLessThan(0.5)
  })
}
