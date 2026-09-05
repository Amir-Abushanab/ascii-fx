/**
 * Device tilt as a pointer source: the phone's own orientation, normalized into the same 0..1
 * canvas coordinates `AsciiPointer.set` already takes, so every pointer interaction (`glyph-swell`,
 * `original-mix`, `resolution`, …) works on a phone, which has no cursor to give it.
 *
 * Raw `deviceorientation` is unusable for this for three reasons, and {@link TiltSource} is those
 * three fixes:
 *
 * 1. NOBODY HOLDS A PHONE FLAT. `beta` rests around 40-60° in a normal grip, not 0, so the raw
 *    angle would park the pointer in a corner before the reader moved at all. The first accepted
 *    reading becomes the neutral pose and every later one is a delta from it ("however you were
 *    already holding it is the middle of the canvas"); recenter() re-arms that on a change of grip.
 * 2. THE AXES TURN WITH THE SCREEN. `beta` / `gamma` are DEVICE axes, so in landscape they have
 *    swapped roles relative to what the reader sees. Each reading is rotated by the screen angle,
 *    which is what keeps x meaning "toward the right edge of the canvas" in every orientation.
 * 3. iOS ASKS FIRST. Safari 13+ gates the sensor behind DeviceOrientationEvent.requestPermission()
 *    called from inside a user gesture, so tilt cannot be a silent default there: the source stays
 *    dormant at its rest value until enable() runs from a tap. Everywhere else it just attaches.
 *
 * Smoothing is deliberately NOT here — the sensor reports a pose, and {@link forwardTiltToPointer}
 * is what eases the pointer toward it on a frame loop and pushes it into the renderer.
 */
import type { AsciiPointer } from './types.js'

const DEFAULT_RANGE = 25 // degrees away from neutral that reach the 0 / 1 ends
const DEFAULT_SMOOTHING = 0.18 // seconds; sensor data is noisy and a still hand jitters
const DEG2RAD = Math.PI / 180
/** Below this much movement (in normalized units) per frame the follow loop has arrived. */
const SETTLED = 0.0005

/** iOS 13+ adds a static `requestPermission` to the constructor; the DOM lib doesn't type it. */
interface PermissionGatedEvent {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
}

export interface TiltOptions {
  /** Degrees away from the neutral pose that reach the 0 / 1 ends. Default 25 — about the range of
   *  a wrist, not of a whole arm. Smaller = a twitchier effect that reacts to a nudge. */
  range?: number
  /** Follow smoothing, seconds. Default 0.18. Only {@link forwardTiltToPointer} reads this. */
  smoothing?: number
  /** Flip the horizontal / vertical direction. */
  invertX?: boolean
  invertY?: boolean
}

/**
 * Where the sensor stands, so an app can decide what to show:
 * - `unsupported` — no DeviceOrientationEvent at all (desktop browsers): don't offer tilt.
 * - `prompt` — gated behind a gesture (iOS): show a "tilt to explore" affordance whose tap calls
 *   {@link TiltSource.enable}.
 * - `denied` — the reader refused; asking again in the same page load does nothing.
 * - `listening` — attached, still waiting for the first reading.
 * - `live` — readings are arriving and the pointer is moving.
 */
export type TiltStatus = 'unsupported' | 'prompt' | 'denied' | 'listening' | 'live'

/** Shortest-way-round delta for an angle that wraps at ±180 (`beta`), so passing the wrap point
 *  reads as a small move instead of a 360° lurch. `gamma` spans only ±90 and mirrors past vertical,
 *  which the range clamp already absorbs — it is deliberately left alone. */
function wrap180(deg: number): number {
  return deg - 360 * Math.round(deg / 360)
}

/** How far the page is rotated from the device's natural orientation, in degrees. */
function screenAngle(): number {
  const angle = window.screen?.orientation?.angle
  return typeof angle === 'number' ? angle : 0
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The device-orientation reading, normalized 0..1 with 0.5 at the neutral pose. */
export class TiltSource {
  /** Normalized canvas coordinates (0..1, top-left origin), 0.5 = the neutral pose. */
  x = 0.5
  y = 0.5

  private options: TiltOptions
  private baseBeta: number | null = null
  private baseGamma: number | null = null
  private attached = false
  private denied = false
  private reading = false
  private onReading: (() => void) | null = null

  constructor(options: TiltOptions = {}) {
    this.options = options
    // Where no gesture is required (Android/Chrome) tilt behaves like any other input and is simply
    // live; only the gated platforms wait for enable().
    if (TiltSource.supported() && !TiltSource.needsPermission()) this.attach()
  }

  static supported(): boolean {
    return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined'
  }

  /** True where the sensor needs {@link enable} called from a user gesture (iOS 13+). */
  static needsPermission(): boolean {
    if (!TiltSource.supported()) return false
    const ctor = window.DeviceOrientationEvent as unknown as PermissionGatedEvent
    return typeof ctor.requestPermission === 'function'
  }

  get status(): TiltStatus {
    if (!TiltSource.supported()) return 'unsupported'
    if (this.denied) return 'denied'
    if (!this.attached) return 'prompt'
    return this.reading ? 'live' : 'listening'
  }

  /** True once a real reading has landed — the point from which x/y mean anything. */
  get live(): boolean {
    return this.reading
  }

  /** Retune without rebuilding: the neutral pose and the permission both survive. */
  setOptions(options: TiltOptions): void {
    this.options = options
  }

  /** Follow time constant in seconds, resolved. Read by {@link forwardTiltToPointer} each frame,
   *  so retuning through {@link setOptions} reaches a loop that is already running. */
  get smoothing(): number {
    return Math.max(this.options.smoothing ?? DEFAULT_SMOOTHING, 0)
  }

  /** Called after every accepted reading, so a follow loop can wake instead of polling. */
  onChange(fn: (() => void) | null): void {
    this.onReading = fn
  }

  /**
   * Start listening, asking the platform's permission first where that is required. MUST be called
   * from inside a user gesture on iOS. Resolves true when the sensor is (or already was) attached.
   *
   * A rejected request is NOT treated as a refusal: iOS throws when the call didn't come from a
   * gesture, and latching that as `denied` would kill a button that is merely wired up wrong. Only
   * an explicit non-'granted' answer sticks.
   */
  async enable(): Promise<boolean> {
    if (!TiltSource.supported() || this.denied) return false
    if (this.attached) return true
    const ctor = window.DeviceOrientationEvent as unknown as PermissionGatedEvent
    if (typeof ctor.requestPermission === 'function') {
      try {
        if ((await ctor.requestPermission()) !== 'granted') {
          this.denied = true
          return false
        }
      } catch {
        return false // not from a gesture (or no sensor) — retryable, so the status stays 'prompt'
      }
    }
    this.attach()
    return true
  }

  /** Take the next reading as the new neutral pose, for when the reader has visibly changed grip. */
  recenter(): void {
    this.baseBeta = null
    this.baseGamma = null
  }

  private attach(): void {
    if (this.attached) return
    this.attached = true
    window.addEventListener('deviceorientation', this.onOrientation, { passive: true })
  }

  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    const { beta, gamma } = e
    // Some browsers fire the event with null angles before the sensor has a fix (and headless
    // environments fire nulls forever): those carry no orientation, so they are not a reading.
    if (beta === null || gamma === null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return
    if (this.baseBeta === null || this.baseGamma === null) {
      this.baseBeta = beta
      this.baseGamma = gamma
    }
    const dGamma = gamma - this.baseGamma
    const dBeta = wrap180(beta - this.baseBeta)

    // Device axes → screen axes. The page is rotated `screenAngle()` from the device, so rotating
    // the tilt vector by MINUS that angle lands it in what the reader is actually looking at.
    const a = -screenAngle() * DEG2RAD
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const sx = dGamma * cos - dBeta * sin
    const sy = dGamma * sin + dBeta * cos

    const range = Math.max(this.options.range ?? DEFAULT_RANGE, 1)
    const nx = clamp01(0.5 + sx / (2 * range))
    const ny = clamp01(0.5 + sy / (2 * range))
    this.x = this.options.invertX ? 1 - nx : nx
    this.y = this.options.invertY ? 1 - ny : ny
    this.reading = true
    this.onReading?.()
  }

  dispose(): void {
    if (this.attached) window.removeEventListener('deviceorientation', this.onOrientation)
    this.attached = false
    this.reading = false
    this.onReading = null
    this.x = 0.5
    this.y = 0.5
  }
}

/**
 * Ease a renderer's pointer toward the tilt reading and push it in, on a frame loop that runs only
 * while the two disagree. A sensor event is a pose, not a gesture: writing it straight to
 * `pointer.set` would hand the compositor 60 jittery jumps a second and repaint on every one. This
 * smooths at the source's `smoothing` and parks itself the moment the pointer has arrived, so a
 * phone lying still on a desk costs nothing.
 *
 * Returns the stop function; it does NOT dispose the source (the caller owns that).
 */
export function forwardTiltToPointer(source: TiltSource, pointer: AsciiPointer): () => void {
  if (typeof requestAnimationFrame === 'undefined') return () => {}
  let x = 0.5
  let y = 0.5
  let frame = 0
  let last = 0
  let stopped = false

  const step = (now: number): void => {
    frame = 0
    if (stopped) return
    const dt = last === 0 ? 1 / 60 : Math.min((now - last) / 1000, 0.1)
    last = now
    const tau = source.smoothing
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1
    const dx = (source.x - x) * k
    const dy = (source.y - y) * k
    x += dx
    y += dy
    pointer.set(x, y)
    pointer.setVelocity(dx / dt, dy / dt)
    // Keep going only while there is still ground to cover; a new reading wakes us again.
    if (Math.abs(source.x - x) > SETTLED || Math.abs(source.y - y) > SETTLED) wake()
  }

  const wake = (): void => {
    if (frame || stopped) return
    frame = requestAnimationFrame(step)
  }

  source.onChange(wake)
  if (source.live) wake()
  return () => {
    stopped = true
    source.onChange(null)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }
}
