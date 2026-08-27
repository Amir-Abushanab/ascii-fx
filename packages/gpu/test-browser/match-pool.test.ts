// The worker matcher (spec §11 tier 2) in a real browser: the pool must start,
// and what it assembles must be the same bytes the main thread produces. A
// faster matcher that disagrees with the reference is not a fallback.
import { describe, expect, it } from 'vitest'
import { matchFrame } from '@ascii-fx/core'
import { MatchPool } from '../src/matchPool.js'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile, randomImage, randomProfile } from '../../core/test/synthetic.js'

/** Works whichever context the renderer took: 2d, or webgl2 via the compositor. */
const readPixels = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)
  return ctx.getImageData(0, 0, out.width, out.height).data
}

const settle = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

const waitFor = async (predicate: () => boolean, timeout = 10_000): Promise<void> => {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('matcher worker pool', () => {
  it('starts real workers and reports ready', async () => {
    const pool = MatchPool.create(makeProfile(STANDARD_SIX), 3)
    expect(pool).toBeDefined()
    await waitFor(() => pool!.ready)
    expect(pool!.failed).toBe(false)
    pool!.destroy()
  })

  for (const color of ['mono', 'foreground', 'full'] as const) {
    it(`assembles cells byte-identical to matchFrame (${color})`, async () => {
      const profile = randomProfile(40, 11)
      const source = randomImage(157, 91, 23, true)
      const columns = 19
      const rows = 11
      const expected = matchFrame(source, { profile, columns, rows, color, alpha: 'mask' })

      const pool = MatchPool.create(profile, 4)!
      await waitFor(() => pool.ready)
      expect(pool.submit(source, columns, rows, { color, alpha: 'mask' })).toBe(true)
      await waitFor(() => !pool.busy)

      const cells = pool.take()!
      expect(cells).toBeDefined()
      expect(cells.glyphIds).toEqual(expected.glyphIds)
      expect(cells.flags).toEqual(expected.flags)
      if (expected.foreground) expect(cells.foreground).toEqual(expected.foreground)
      if (expected.background) expect(cells.background).toEqual(expected.background)
      pool.destroy()
    })
  }

  it('refuses a second submit while a frame is in flight', async () => {
    const profile = randomProfile(24, 3)
    const source = randomImage(96, 64, 5)
    const pool = MatchPool.create(profile, 2)!
    await waitFor(() => pool.ready)
    expect(pool.submit(source, 12, 8, { color: 'mono', alpha: 'mask' })).toBe(true)
    expect(pool.submit(source, 12, 8, { color: 'mono', alpha: 'mask' })).toBe(false)
    await waitFor(() => !pool.busy)
    pool.destroy()
  })

  it('abandon() drops the in-flight frame instead of delivering it', async () => {
    const profile = randomProfile(24, 3)
    const source = randomImage(96, 64, 5)
    const pool = MatchPool.create(profile, 2)!
    await waitFor(() => pool.ready)
    pool.submit(source, 12, 8, { color: 'mono', alpha: 'mask' })
    pool.abandon()
    await new Promise((r) => setTimeout(r, 200))
    expect(pool.take()).toBeUndefined()
    expect(pool.busy).toBe(false)
    pool.destroy()
  })

  // The renderer is what actually has to agree: same source, same options,
  // workers on versus off, identical pixels on the canvas.
  it('renders the same pixels with workers on and off', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const source = randomImage(128, 72, 91)
    const draw = async (workers: number | false): Promise<Uint8ClampedArray> => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const renderer = await createAsciiRenderer({
        canvas,
        profile,
        backend: 'cpu',
        columns: 16,
        color: 'full',
        workers,
      })
      renderer.setSource(source)
      renderer.render()
      await settle()
      renderer.render()
      await settle()
      const data = readPixels(canvas)
      renderer.destroy()
      return data
    }
    expect(await draw(3)).toEqual(await draw(false))
  })
})

describe('captureFrame with a worker pool', () => {
  it('returns the current source, not the frame still in flight', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const renderer = await createAsciiRenderer({
      canvas,
      profile,
      backend: 'cpu',
      columns: 16,
      color: 'full',
      workers: 3,
    })

    const first = randomImage(128, 72, 41)
    renderer.setSource(first)
    renderer.render()
    await settle()

    // A second source with a pipelined render in flight against it.
    const second = randomImage(128, 72, 77)
    renderer.setSource(second)
    renderer.render()

    const captured = await renderer.captureFrame()
    const expected = matchFrame(second, { profile, columns: 16, color: 'full' })
    expect(captured.glyphIds).toEqual(expected.glyphIds)
    renderer.destroy()
  })
})
