// A real <video> in front of the renderer. Shared by the two video suites, one per backend,
// because the CPU half runs anywhere and the WebGPU half only where there is an adapter.
//
// What a still or a canvas source cannot exercise: start() on a video runs on
// requestVideoFrameCallback, which fires only when the video presents a frame. So the
// renderer has two jobs a plain animation loop never has — keep up while frames arrive, and
// keep repainting (a hover effect, a resize) when they stop.
import { afterEach, expect, it } from 'vitest'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import type { AsciiRenderer } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile } from '../../core/test/synthetic.js'
import clipUrl from '../../../fixtures/video/testsrc.webm?url'

export { clipUrl }

export const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

/**
 * The canvas as it stands right now. Call it in the frame the renderer drew in: a WebGPU
 * canvas hands its texture to the compositor at the end of the frame and reads back empty
 * afterwards, which is also what makes "nothing repainted" visible as a blank read.
 */
export function snapshot(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const probe = document.createElement('canvas')
  probe.width = canvas.width
  probe.height = canvas.height
  const ctx = probe.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(canvas, 0, 0)
  return ctx.getImageData(0, 0, probe.width, probe.height).data
}

/** Fraction of pixels with something drawn in them. */
export function litFraction(data: Uint8ClampedArray): number {
  let lit = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] > 48) lit++
  }
  return lit / (data.length / 4)
}

/** Mean absolute difference per channel, 0..255. */
export function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return 255
  let sum = 0
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  }
  return sum / ((a.length / 4) * 3)
}

/**
 * Watch the canvas for `ms`, a frame at a time, and return the distinct pictures it showed.
 * Blank reads are frames the renderer did not draw in, and are skipped.
 */
export async function distinctFrames(
  canvas: HTMLCanvasElement,
  ms: number,
  enough = Number.POSITIVE_INFINITY,
): Promise<Uint8ClampedArray[]> {
  const seen: Uint8ClampedArray[] = []
  const deadline = performance.now() + ms
  while (performance.now() < deadline && seen.length < enough) {
    await nextFrame()
    const shot = snapshot(canvas)
    if (litFraction(shot) < 0.02) continue
    if (seen.every((s) => difference(s, shot) > 0.5)) seen.push(shot)
  }
  return seen
}

/**
 * Wait for the canvas to stop changing. A paused video's last frame can still be on its way:
 * the CPU backend matches on workers and presents a frame behind, so the final picture lands
 * a moment after `pause()` — how long a moment depends on the machine, and a fixed delay that
 * is plenty on a laptop is not on a two-core CI runner. A render that never stops fails this.
 */
export async function untilStill(canvas: HTMLCanvasElement, ms = 8000): Promise<boolean> {
  const deadline = performance.now() + ms
  while (performance.now() < deadline) {
    if ((await distinctFrames(canvas, 300)).length <= 1) return true
  }
  return false
}

export async function loadClip(): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.loop = true
  video.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:96px'
  document.body.append(video)
  const loaded = new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error('the fixture clip did not load')), {
      once: true,
    })
  })
  video.src = clipUrl
  await loaded
  return video
}

const once = (target: EventTarget, type: string): Promise<void> =>
  new Promise((resolve) => target.addEventListener(type, () => resolve(), { once: true }))

/** Play long enough to be well into the clip, then pause and let the last frame land. */
async function playThenPause(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
  await video.play()
  await new Promise((r) => setTimeout(r, 400))
  video.pause()
  expect(await untilStill(canvas), 'the render settles once the video is paused').toBe(true)
}

export function videoScenarios(backend: 'cpu' | 'webgpu'): void {
  let cleanup: Array<() => void> = []
  afterEach(() => {
    for (const fn of cleanup) fn()
    cleanup = []
  })

  const setup = async (): Promise<{
    video: HTMLVideoElement
    canvas: HTMLCanvasElement
    renderer: AsciiRenderer
  }> => {
    const video = await loadClip()
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 192
    document.body.append(canvas)
    const renderer = await createAsciiRenderer({
      canvas,
      profile: makeProfile(STANDARD_SIX),
      backend,
      columns: 20,
      color: 'full',
    })
    cleanup.push(() => {
      renderer.destroy()
      video.pause()
      video.remove()
      canvas.remove()
    })
    renderer.setSource(video)
    renderer.render()
    renderer.start()
    return { video, canvas, renderer }
  }

  it('follows a playing video frame by frame', async () => {
    const { video, canvas } = await setup()
    await video.play()
    // Thirty frames a second; a renderer that re-read the video only once, or never, shows
    // one picture or none. The window is generous because a CI runner decodes slowly, and
    // it closes as soon as enough distinct pictures have been seen.
    const frames = await distinctFrames(canvas, 4000, 4)
    expect(frames.length).toBeGreaterThanOrEqual(4)
  })

  it('holds still on a paused video', async () => {
    const { video, canvas, renderer } = await setup()
    await playThenPause(video, canvas)
    renderer.resize(canvas.width, canvas.height) // asks for one repaint
    await nextFrame()
    const held = snapshot(canvas)
    expect(litFraction(held)).toBeGreaterThan(0.02)
    await new Promise((r) => setTimeout(r, 300))
    renderer.resize(canvas.width, canvas.height)
    await nextFrame()
    expect(difference(snapshot(canvas), held)).toBeLessThan(0.5)
  })

  // The loop is "running", but nothing is calling it: a paused video presents no frames.
  // Pointer moves and resizes used to stand down for the running loop anyway.
  it('keeps answering the pointer while the video is paused', async () => {
    const { video, canvas, renderer } = await setup()
    await playThenPause(video, canvas)

    renderer.setInteraction({ type: 'reveal', radius: 0.3, feather: 0.05 })
    renderer.pointer.set(0.2, 0.5)
    await nextFrame()
    const left = snapshot(canvas)
    expect(litFraction(left), 'repainted for the pointer').toBeGreaterThan(0.02)

    renderer.pointer.set(0.8, 0.5)
    await nextFrame()
    const right = snapshot(canvas)
    expect(litFraction(right), 'repainted for the second move').toBeGreaterThan(0.02)
    // The revealed disc of source moved from one side to the other.
    expect(difference(left, right)).toBeGreaterThan(1)
  })

  it('repaints after a resize while the video is paused', async () => {
    const { video, canvas, renderer } = await setup()
    await playThenPause(video, canvas)
    renderer.resize(400, 240)
    await nextFrame()
    const shot = snapshot(canvas)
    expect([canvas.width, canvas.height]).toEqual([400, 240])
    expect(litFraction(shot)).toBeGreaterThan(0.02)
  })

  it('shows the frame a paused video is seeked to', async () => {
    const { video, canvas, renderer } = await setup()
    await playThenPause(video, canvas)
    renderer.resize(canvas.width, canvas.height)
    await nextFrame()
    const before = snapshot(canvas)

    const target = video.currentTime > 1 ? 0.2 : 1.6
    const seeked = once(video, 'seeked')
    video.currentTime = target
    await seeked
    // The seek presents one new frame. Its callback takes a few frames to arrive, and on the
    // CPU backend the match a few more, so ask until the picture has changed.
    let after = before
    const deadline = performance.now() + 6000
    while (difference(before, after) <= 1 && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
      renderer.resize(canvas.width, canvas.height)
      await nextFrame()
      const shot = snapshot(canvas)
      if (litFraction(shot) > 0.02) after = shot
    }
    expect(difference(before, after)).toBeGreaterThan(1)
  })

  it('picks the video back up after a pause', async () => {
    const { video, canvas } = await setup()
    await playThenPause(video, canvas)
    await video.play()
    const frames = await distinctFrames(canvas, 4000, 3)
    expect(frames.length).toBeGreaterThanOrEqual(3)
  })
}
