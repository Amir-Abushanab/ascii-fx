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

/** Run one band job on the pool and wait for its result. */
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

  // jitter-v1 hashes a cell's frame row, so a band has to be told where it starts or the
  // assembled frame stops matching a whole-frame one (ALGORITHM.md §20).
  it('assembles jittered cells byte-identical to matchFrame', async () => {
    const profile = randomProfile(40, 11)
    const source = randomImage(157, 91, 23, true)
    const options = { color: 'full', alpha: 'mask', jitter: 120, jitterSeed: 7 } as const
    const expected = matchFrame(source, { profile, columns: 19, rows: 11, ...options })
    const plain = matchFrame(source, { profile, columns: 19, rows: 11, ...options, jitter: 0 })
    expect(expected.glyphIds).not.toEqual(plain.glyphIds)

    const pool = MatchPool.create(profile, 4)!
    await waitFor(() => pool.ready)
    const cells = await cellsOf(pool, source, 19, 11, options)
    expect(cells.glyphIds).toEqual(expected.glyphIds)
    expect(cells.foreground).toEqual(expected.foreground)
    expect(cells.background).toEqual(expected.background)
    pool.destroy()
  })

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

/** A live source: a canvas whose pixels are `image`'s. Opaque images only, so it round-trips. */
const paint = (
  image: ReturnType<typeof randomImage>,
  onto?: HTMLCanvasElement,
): HTMLCanvasElement => {
  const canvas = onto ?? document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  return canvas
}

const sameBytes = (a: Uint8ClampedArray, b: Uint8ClampedArray): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/** How many animation frames anything on the page asks for over `ms`. */
const countFrameRequests = async (ms: number): Promise<number> => {
  const original = window.requestAnimationFrame
  let count = 0
  window.requestAnimationFrame = (cb) => {
    count++
    return original.call(window, cb)
  }
  try {
    await new Promise((r) => setTimeout(r, ms))
  } finally {
    window.requestAnimationFrame = original
  }
  return count
}

describe('renderer on a worker pool', () => {
  const profile = makeProfile(STANDARD_SIX)
  const make = async (workers: number | false, columns = 16) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const renderer = await createAsciiRenderer({
      canvas,
      profile,
      backend: 'cpu',
      columns,
      color: 'full',
      workers,
    })
    return { canvas, renderer }
  }

  // A still has no next frame to hide a frame of latency behind. Pipelining one presented
  // the old cells, left the new ones in the pool for good, and re-presented at 60 Hz
  // waiting for a render that never came.
  it('a still shows new options on the render that follows them, and then goes quiet', async () => {
    const source = randomImage(128, 72, 91)
    const reference = await make(false, 8)
    reference.renderer.setSource(source)
    reference.renderer.render()

    const { canvas, renderer } = await make(3, 16)
    renderer.setSource(source)
    renderer.render()
    const before = readPixels(canvas)
    await new Promise((r) => setTimeout(r, 500)) // ample time for a pool to come up
    renderer.setOptions({ columns: 8 })
    renderer.render()
    const after = readPixels(canvas)

    expect(sameBytes(after, before)).toBe(false)
    expect(sameBytes(after, readPixels(reference.canvas))).toBe(true)
    // Static sources are matched inline (types.ts `workers`), so no pool was ever spawned.
    expect(renderer.pipeline.matcher).toBe('main-thread')
    expect(await countFrameRequests(300)).toBe(0)
    renderer.destroy()
    reference.renderer.destroy()
  })

  it('a live source rendered by hand gets its frame without another render()', async () => {
    const live = paint(randomImage(128, 72, 41))
    const { canvas, renderer } = await make(3)
    renderer.setSource(live)
    renderer.render()
    await waitFor(() => renderer.pipeline.matcher === 'workers')
    await settle()
    await settle()

    // New content, one render: it goes to the pool, and the old frame is presented.
    paint(randomImage(128, 72, 77), live)
    renderer.render()

    const reference = await make(false)
    reference.renderer.setSource(live)
    reference.renderer.render()
    const expected = readPixels(reference.canvas)
    await waitFor(() => sameBytes(readPixels(canvas), expected))
    // Adopted and presented once; a hand-rendered source must not become a loop.
    await settle()
    expect(await countFrameRequests(300)).toBe(0)
    renderer.destroy()
    reference.renderer.destroy()
  })

  it('honours jitter on the main thread, and refuses it for chromatic', async () => {
    const random = randomProfile(40, 11)
    const source = randomImage(128, 72, 5)
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile: random,
      backend: 'cpu',
      workers: false,
      columns: 16,
      color: 'full',
      jitter: 120,
      jitterSeed: 3,
    })
    renderer.setSource(source)
    const options = { columns: 16, color: 'full', jitter: 120, jitterSeed: 3 } as const
    const expected = matchFrame(source, { profile: random, ...options })
    expect((await renderer.captureFrame()).glyphIds).toEqual(expected.glyphIds)
    expect(expected.glyphIds).not.toEqual(
      matchFrame(source, { profile: random, ...options, jitter: 0 }).glyphIds,
    )
    expect(() => renderer.setOptions({ matcher: 'chromatic' })).toThrow(/jitter/)
    expect(() => renderer.setOptions({ jitter: 256 })).toThrow(/0\.\.255/)
    renderer.destroy()
  })
})

describe('renderer housekeeping on the CPU backend', () => {
  const profile = makeProfile(STANDARD_SIX)

  it('repaints a still after setOptions without being asked', async () => {
    const source = randomImage(128, 72, 91)
    const build = async (columns: number) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const renderer = await createAsciiRenderer({
        canvas,
        profile,
        backend: 'cpu',
        columns,
        color: 'full',
        workers: false,
      })
      renderer.setSource(source)
      renderer.render()
      return { canvas, renderer }
    }
    const reference = await build(8)
    const subject = await build(16)
    subject.renderer.setOptions({ columns: 8 })
    await settle()
    expect(sameBytes(readPixels(subject.canvas), readPixels(reference.canvas))).toBe(true)
    subject.renderer.destroy()
    reference.renderer.destroy()
  })

  it('forwards an interaction passed through setOptions', async () => {
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile,
      backend: 'cpu',
      workers: false,
    })
    renderer.setOptions({ interaction: { type: 'reveal' } })
    expect((renderer as unknown as { interaction: unknown }).interaction).toEqual({
      type: 'reveal',
    })
    // Refused the way setInteraction refuses it, rather than swallowed.
    expect(() => renderer.setOptions({ interaction: { type: 'wave', source: 'motion' } })).toThrow(
      /single origin/,
    )
    renderer.destroy()
  })

  // A source that cannot be read for a moment throws from render(). From the loop that used
  // to end the loop for good, while leaving it marked as running.
  it('keeps its loop through a frame that could not be rendered', async () => {
    const live = paint(randomImage(128, 72, 41))
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const renderer = await createAsciiRenderer({
      canvas,
      profile,
      backend: 'cpu',
      columns: 16,
      color: 'full',
      workers: false,
    })
    renderer.setSource(live)
    renderer.start()
    await settle()
    const first = readPixels(canvas)

    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    try {
      live.width = 0 // unreadable: every tick throws
      await settle()
      await settle()
    } finally {
      console.error = original
    }
    // Said once, not once a frame.
    expect(logged).toHaveLength(1)

    paint(randomImage(128, 72, 77), live)
    await settle()
    await settle()
    expect(sameBytes(readPixels(canvas), first)).toBe(false)
    renderer.destroy()
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

    // A live source, since only those are pipelined: a still is matched inline and never
    // has a frame in flight.
    const live = paint(randomImage(128, 72, 41))
    renderer.setSource(live)
    renderer.render()
    await waitFor(() => renderer.pipeline.matcher === 'workers')

    // New content with a pipelined render in flight against it.
    const second = randomImage(128, 72, 77)
    paint(second, live)
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
