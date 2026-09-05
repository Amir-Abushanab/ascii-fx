/**
 * The tilt source is three fixes on top of a raw `deviceorientation` reading — a neutral baseline,
 * a screen-orientation rotation, and a permission gate — and each one is invisible until it is
 * wrong on a real phone, in a real grip, in a real orientation. Nothing here needs a GPU or a DOM:
 * we drive a fake `window` and a fake sensor, and check the arithmetic, the gate, and the follow
 * loop that pushes the reading into a pointer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forwardTiltToPointer, TiltSource, type TiltOptions } from '@ascii-fx/gpu'

type Listener = (e: unknown) => void

interface FakeWindow {
  listeners: Map<string, Set<Listener>>
  angle: number
}

/** Install a minimal `window` carrying a DeviceOrientationEvent, and return the handle to drive it. */
function installWindow(
  options: { angle?: number; requestPermission?: () => Promise<string> } = {},
): FakeWindow {
  const listeners = new Map<string, Set<Listener>>()
  // The source only probes this for a `requestPermission` and never constructs it, so a plain bag
  // stands in for the constructor — and a FRESH one each install, so the gate can't leak across tests.
  const ctor: Record<string, unknown> = {}
  if (options.requestPermission) ctor.requestPermission = options.requestPermission
  const fake: FakeWindow = { listeners, angle: options.angle ?? 0 }
  vi.stubGlobal('window', {
    DeviceOrientationEvent: ctor,
    screen: {
      get orientation() {
        return { angle: fake.angle }
      },
    },
    addEventListener(type: string, fn: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn)
    },
  })
  return fake
}

/** Deliver one orientation reading to whatever the source attached. */
function emit(fake: FakeWindow, beta: number | null, gamma: number | null): void {
  for (const fn of fake.listeners.get('deviceorientation') ?? []) fn({ beta, gamma })
}

const attached = (fake: FakeWindow): number => fake.listeners.get('deviceorientation')?.size ?? 0

/** A controllable requestAnimationFrame, so the follow loop can be stepped a frame at a time. */
function installRaf() {
  let now = 0
  const queue = new Map<number, FrameRequestCallback>()
  let nextId = 1
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    const id = nextId++
    queue.set(id, fn)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id))
  return {
    get pending() {
      return queue.size
    },
    /** Run whatever is queued, advancing the clock 1/60s per step. */
    flush(steps = 1): void {
      for (let i = 0; i < steps; i++) {
        const due = [...queue.values()]
        queue.clear()
        now += 1000 / 60
        for (const fn of due) fn(now)
      }
    },
  }
}

/** A stand-in AsciiPointer that records what the follow loop pushed into it. */
function stubPointer() {
  const calls: Array<[number, number]> = []
  return {
    calls,
    pointer: {
      set: (x: number, y: number) => void calls.push([x, y]),
      setVelocity: () => {},
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('neutral pose', () => {
  it('centres both axes on the FIRST reading, whatever pose that is', () => {
    // The whole point: a phone held at the usual ~50° must not start pinned to a corner.
    const fake = installWindow()
    const t = new TiltSource()
    emit(fake, 50, -13)
    expect(t.x).toBeCloseTo(0.5, 6)
    expect(t.y).toBeCloseTo(0.5, 6)
    expect(t.live).toBe(true)
    expect(t.status).toBe('live')
  })

  it('recenter() re-takes the neutral pose from the next reading', () => {
    const fake = installWindow()
    const t = new TiltSource()
    emit(fake, 50, 0)
    emit(fake, 50, 25) // a full range to the right, with range defaulting to 25°
    expect(t.x).toBeCloseTo(1, 6)
    t.recenter()
    emit(fake, 50, 25) // same pose, now declared to be centre
    expect(t.x).toBeCloseTo(0.5, 6)
  })
})

describe('range mapping', () => {
  it('reads the way a ball rolls: right edge down → x toward 1, bottom edge down → y toward 1', () => {
    const fake = installWindow()
    const t = new TiltSource()
    emit(fake, 40, 0)
    emit(fake, 40, 12.5) // half of the default 25° range
    expect(t.x).toBeCloseTo(0.75, 6)
    emit(fake, 52.5, 0) // beta up 12.5° = the bottom edge dropping
    expect(t.y).toBeCloseTo(0.75, 6)
  })

  it('clamps past the range instead of running off the canvas', () => {
    const fake = installWindow()
    const t = new TiltSource()
    emit(fake, 0, 0)
    emit(fake, 0, 400)
    expect(t.x).toBe(1)
    emit(fake, 0, -400)
    expect(t.x).toBe(0)
  })

  it('honours a custom range, the invert flags, and a later setOptions', () => {
    const fake = installWindow()
    const options: TiltOptions = { range: 10, invertX: true, invertY: true }
    const t = new TiltSource(options)
    emit(fake, 0, 0)
    emit(fake, 5, 10)
    expect(t.x).toBeCloseTo(0, 6) // +full range, inverted
    expect(t.y).toBeCloseTo(0.25, 6) // +half range, inverted

    // Retuning must not cost the neutral pose (or, on iOS, the permission).
    t.setOptions({ range: 20 })
    emit(fake, 5, 10)
    expect(t.x).toBeCloseTo(0.75, 6)
  })

  it('takes the shortest way round the ±180 beta wrap', () => {
    // Without the wrap this reads as a 355° lurch and pins the pointer for a 5° movement.
    const fake = installWindow()
    const t = new TiltSource()
    emit(fake, 178, 0)
    emit(fake, -177, 0) // 5° further over the top, not 355° back
    expect(t.y).toBeCloseTo(0.6, 6)
  })
})

describe('screen orientation', () => {
  it("rotates device axes into screen axes, so x still means 'toward the right edge'", () => {
    const fake = installWindow({ angle: 90 })
    const t = new TiltSource()
    emit(fake, 0, 0)
    // Landscape: the device's beta axis is what now runs across the canvas.
    emit(fake, 25, 0)
    expect(t.x).toBeCloseTo(1, 6)
    expect(t.y).toBeCloseTo(0.5, 6)
    emit(fake, 0, 25)
    expect(t.y).toBeCloseTo(0, 6)
  })

  it('mirrors both axes upside-down (angle 180)', () => {
    const fake = installWindow({ angle: 180 })
    const t = new TiltSource()
    emit(fake, 0, 0)
    emit(fake, 12.5, 12.5)
    expect(t.x).toBeCloseTo(0.25, 6)
    expect(t.y).toBeCloseTo(0.25, 6)
  })
})

describe('readings that carry no orientation', () => {
  it('ignores null angles rather than latching them as the neutral pose', () => {
    const fake = installWindow()
    const t = new TiltSource()
    emit(fake, null, null)
    expect(t.live).toBe(false)
    expect(t.status).toBe('listening')
    expect(t.x).toBe(0.5)
    emit(fake, 30, 0)
    emit(fake, 30, 25)
    expect(t.x).toBeCloseTo(1, 6) // the real reading, not one measured from a null
  })
})

describe('the permission gate', () => {
  it('attaches immediately where no permission is required', () => {
    const fake = installWindow()
    const t = new TiltSource()
    expect(attached(fake)).toBe(1)
    expect(t.status).toBe('listening')
  })

  it('stays dormant until enable() where one is (iOS)', async () => {
    const fake = installWindow({ requestPermission: () => Promise.resolve('granted') })
    const t = new TiltSource()
    expect(attached(fake)).toBe(0)
    expect(t.status).toBe('prompt')
    await expect(t.enable()).resolves.toBe(true)
    expect(attached(fake)).toBe(1)
  })

  it('latches an explicit refusal', async () => {
    const fake = installWindow({ requestPermission: () => Promise.resolve('denied') })
    const t = new TiltSource()
    await expect(t.enable()).resolves.toBe(false)
    expect(t.status).toBe('denied')
    await expect(t.enable()).resolves.toBe(false)
    expect(attached(fake)).toBe(0)
  })

  it('keeps a THROWN request retryable — iOS throws when the call missed the gesture', async () => {
    let fail = true
    const fake = installWindow({
      requestPermission: () =>
        fail ? Promise.reject(new Error('not from a gesture')) : Promise.resolve('granted'),
    })
    const t = new TiltSource()
    await expect(t.enable()).resolves.toBe(false)
    expect(t.status).toBe('prompt') // NOT 'denied' — the next tap must still be able to ask
    fail = false
    await expect(t.enable()).resolves.toBe(true)
    expect(attached(fake)).toBe(1)
  })
})

describe('without a sensor', () => {
  it('reports unsupported and touches nothing', async () => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
    const t = new TiltSource()
    expect(TiltSource.supported()).toBe(false)
    expect(t.status).toBe('unsupported')
    await expect(t.enable()).resolves.toBe(false)
  })
})

describe('forwardTiltToPointer', () => {
  it('eases the pointer toward the pose instead of jumping to it', () => {
    const fake = installWindow()
    const raf = installRaf()
    const { calls, pointer } = stubPointer()
    const t = new TiltSource({ smoothing: 0.1 })
    const stop = forwardTiltToPointer(t, pointer)

    emit(fake, 0, 0)
    emit(fake, 0, 25) // hard right
    raf.flush(1)
    const [firstX] = calls[0]
    expect(firstX).toBeGreaterThan(0.5)
    expect(firstX).toBeLessThan(0.9) // eased, not snapped
    raf.flush(60)
    expect(calls[calls.length - 1][0]).toBeGreaterThan(0.99)
    stop()
  })

  it('parks itself once it arrives, so a phone lying still costs nothing', () => {
    const fake = installWindow()
    const raf = installRaf()
    const { pointer } = stubPointer()
    const t = new TiltSource({ smoothing: 0.1 })
    const stop = forwardTiltToPointer(t, pointer)

    emit(fake, 0, 0)
    emit(fake, 0, 25)
    raf.flush(120)
    expect(raf.pending).toBe(0) // settled: no frame queued for the next tick

    emit(fake, 0, -25) // a new pose wakes it back up
    expect(raf.pending).toBe(1)
    stop()
  })

  it('stops cleanly, leaving nothing queued', () => {
    const fake = installWindow()
    const raf = installRaf()
    const { calls, pointer } = stubPointer()
    const t = new TiltSource()
    const stop = forwardTiltToPointer(t, pointer)

    emit(fake, 0, 0)
    emit(fake, 0, 25)
    stop()
    const seen = calls.length
    raf.flush(10)
    expect(raf.pending).toBe(0)
    expect(calls.length).toBe(seen)
  })
})

describe('dispose', () => {
  it('removes the listener and returns both axes to rest', () => {
    const fake = installWindow()
    const t = new TiltSource()
    emit(fake, 0, 0)
    emit(fake, 0, 25)
    expect(t.x).toBeCloseTo(1, 6)
    t.dispose()
    expect(attached(fake)).toBe(0)
    expect(t.x).toBe(0.5)
    expect(t.live).toBe(false)
  })
})
