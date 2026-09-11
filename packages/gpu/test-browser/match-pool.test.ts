// The worker matcher (spec §11 tier 2) in a real browser: the pool must start,
// and what it assembles must be the same bytes the main thread produces. A
// faster matcher that disagrees with the reference is not a fallback.
import { describe, expect, it } from 'vitest'
import { createMotionState, matchFrame, motionField, reduceSource } from '@ascii-fx/core'
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

/** Overwrite the left half of `base` with `patch`, leaving the rest byte-identical. */
const patchHalf = (
  base: ReturnType<typeof randomImage>,
  patch: ReturnType<typeof randomImage>,
): ReturnType<typeof randomImage> => {
  const data = new Uint8Array(base.data)
  for (let y = 0; y < base.height; y++) {
    const row = y * base.width * 4
    data.set(patch.data.slice(row, row + (base.width >> 1) * 4), row)
  }
  return { width: base.width, height: base.height, data }
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

      const cells = pool.take()!.cells
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

  // Exact temporal reuse (spec §21) skips cells whose samples have not moved. A
  // skip that changed a single byte would be a silent wrong picture, so every
  // frame of a sequence is held against a full match of that same frame.
  describe('temporal reuse', () => {
    const columns = 19
    const rows = 11

    const submitAndTake = async (
      pool: MatchPool,
      source: ReturnType<typeof randomImage>,
      cols: number,
      rws: number,
      options: Parameters<MatchPool['submit']>[3],
    ) => {
      expect(pool.submit(source, cols, rws, options)).toBe(true)
      await waitFor(() => !pool.busy)
      return pool.take()!
    }

    const cellsOf = async (...args: Parameters<typeof submitAndTake>) =>
      (await submitAndTake(...args)).cells

    it('matches a changed frame exactly after reusing an unchanged one', async () => {
      const profile = randomProfile(40, 11)
      const a = randomImage(157, 91, 23, true)
      const options = { color: 'full', alpha: 'mask', temporal: true } as const

      const pool = MatchPool.create(profile, 4)!
      await waitFor(() => pool.ready)
      // a → a (every cell reused) → half of a replaced → an unrelated frame.
      for (const source of [
        a,
        a,
        patchHalf(a, randomImage(157, 91, 24, true)),
        randomImage(157, 91, 25, true),
      ]) {
        const cells = await cellsOf(pool, source, columns, rows, options)
        const expected = matchFrame(source, { profile, columns, rows, ...options })
        expect(cells.glyphIds).toEqual(expected.glyphIds)
        expect(cells.flags).toEqual(expected.flags)
        expect(cells.foreground).toEqual(expected.foreground)
        expect(cells.background).toEqual(expected.background)
      }
      pool.destroy()
    })

    it('does not serve cells across a grid change', async () => {
      const profile = randomProfile(40, 11)
      const source = randomImage(157, 91, 31, true)
      const options = { color: 'mono', alpha: 'mask', temporal: true } as const

      const pool = MatchPool.create(profile, 4)!
      await waitFor(() => pool.ready)
      await cellsOf(pool, source, columns, rows, options)
      // Same source, different grid: the bands are cut elsewhere, so every
      // worker's retained band describes a region that no longer exists.
      const cells = await cellsOf(pool, source, 23, 13, options)
      const expected = matchFrame(source, { profile, columns: 23, rows: 13, ...options })
      expect(cells.glyphIds).toEqual(expected.glyphIds)
      pool.destroy()
    })

    it('does not serve cells across an option change', async () => {
      const profile = randomProfile(40, 11)
      const source = randomImage(157, 91, 37, true)

      const pool = MatchPool.create(profile, 4)!
      await waitFor(() => pool.ready)
      await cellsOf(pool, source, columns, rows, {
        color: 'mono',
        alpha: 'mask',
        temporal: true,
      })
      // Identical samples, different colour mode — the cells are not the ones
      // this frame wants, however unchanged the source is.
      const cells = await cellsOf(pool, source, columns, rows, {
        color: 'full',
        alpha: 'mask',
        temporal: true,
      })
      const expected = matchFrame(source, { profile, columns, rows, color: 'full', alpha: 'mask' })
      expect(cells.glyphIds).toEqual(expected.glyphIds)
      expect(cells.foreground).toEqual(expected.foreground)
      pool.destroy()
    })
  })

  // The motion field (§21) is assembled from per-band pieces the same way cells
  // are, so it carries the same obligation: a band-split field has to be the one
  // a whole-frame computation would produce. The trail makes that a claim about
  // a *sequence*, not a frame, so these run several.
  describe('motion field', () => {
    const columns = 19
    const rows = 11
    const opts = { color: 'mono', alpha: 'mask', motion: {} } as const

    /** What a single whole-frame motionField produces for the same sequence. */
    const reference = (sources: Array<ReturnType<typeof randomImage>>): Uint8Array[] => {
      const state = createMotionState(columns, rows)
      return sources.map(
        (src) =>
          motionField(reduceSource(src, columns, rows, false), columns, rows, state, {}).magnitude,
      )
    }

    it('assembles bands into the field a whole-frame pass would produce', async () => {
      const profile = randomProfile(40, 11)
      const a = randomImage(157, 91, 61)
      const sequence = [a, a, patchHalf(a, randomImage(157, 91, 62)), randomImage(157, 91, 63)]
      const expected = reference(sequence)

      const pool = MatchPool.create(profile, 4)!
      await waitFor(() => pool.ready)
      for (const [i, source] of sequence.entries()) {
        expect(pool.submit(source, columns, rows, opts)).toBe(true)
        await waitFor(() => !pool.busy)
        expect(pool.take()!.motion, `frame ${i}`).toEqual(expected[i])
      }
      pool.destroy()
    })

    it('reads still on the first frame and on an unchanged one', async () => {
      const profile = randomProfile(40, 11)
      const a = randomImage(157, 91, 64)
      const pool = MatchPool.create(profile, 4)!
      await waitFor(() => pool.ready)
      for (let i = 0; i < 2; i++) {
        expect(pool.submit(a, columns, rows, opts)).toBe(true)
        await waitFor(() => !pool.busy)
        const motion = pool.take()!.motion!
        expect(
          Array.from(motion).every((v) => v === 0),
          `frame ${i}`,
        ).toBe(true)
      }
      pool.destroy()
    })

    it('lights up when the source moves', async () => {
      const profile = randomProfile(40, 11)
      const a = randomImage(157, 91, 65)
      const pool = MatchPool.create(profile, 4)!
      await waitFor(() => pool.ready)
      expect(pool.submit(a, columns, rows, opts)).toBe(true)
      await waitFor(() => !pool.busy)
      pool.take()
      expect(pool.submit(randomImage(157, 91, 66), columns, rows, opts)).toBe(true)
      await waitFor(() => !pool.busy)
      const motion = pool.take()!.motion!
      expect(Array.from(motion).some((v) => v > 0)).toBe(true)
      pool.destroy()
    })

    it('is absent unless asked for, and works with temporal off or on', async () => {
      const profile = randomProfile(40, 11)
      const source = randomImage(157, 91, 67)
      const pool = MatchPool.create(profile, 4)!
      await waitFor(() => pool.ready)

      expect(pool.submit(source, columns, rows, { color: 'mono', alpha: 'mask' })).toBe(true)
      await waitFor(() => !pool.busy)
      expect(pool.take()!.motion).toBeUndefined()

      // The field carries its own previous-luma state, so it does not depend on
      // the samples `temporal` retains and must behave the same either way.
      for (const temporal of [false, true]) {
        expect(pool.submit(source, columns, rows, { ...opts, temporal })).toBe(true)
        await waitFor(() => !pool.busy)
        expect(pool.take()!.motion, `temporal ${temporal}`).toBeDefined()
      }
      pool.destroy()
    })
  })
})
