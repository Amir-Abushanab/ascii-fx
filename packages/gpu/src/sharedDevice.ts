import type { AsciiProfile } from '@ascii-fx/core'
import { AsciiEngine, type AsciiStream } from './engine.js'

/**
 * One GPUDevice for every renderer on the page, and one engine per profile on it.
 *
 * Each renderer used to ask for a device of its own and build an engine of its own. For one
 * canvas that is the same thing; for a page of them — a gallery of `<AsciiImage>` — it was a
 * device per image, each compiling the same four compute pipelines and uploading the same glyph
 * atlas. Browsers budget devices, and a page can be refused its next one.
 *
 * A renderer holds a *lease*: the shared device, the engine for its profile, and a stream of
 * its own, which is where everything per-canvas lives. The device goes when the last lease
 * does. When the device is lost, every lease on it is dead at once; whichever renderer
 * recovers first opens the next device and the rest join it.
 */
export interface GpuLease {
  device: GPUDevice
  engine: AsciiEngine
  stream: AsciiStream
  /** Hand back the engine and device. The stream is the renderer's to destroy. */
  release(): void
}

interface EngineEntry {
  engine: AsciiEngine
  refs: number
}

interface Shared {
  device: GPUDevice
  engines: Map<string, EngineEntry>
  /** Leases held, plus setups in flight. */
  refs: number
  lost?: GPUDeviceLostInfo
  /** Setups run one at a time: error scopes are a stack on the device, not per caller. */
  queue: Promise<unknown>
}

let current: Shared | undefined
let opening: Promise<Shared> | undefined

/**
 * What decides an engine: the glyph data it uploads. The fingerprint names the font and the
 * charset, but not everything a profile can carry (a chromatic atlas, a hand-built profile in
 * a test), so the key also hashes the structural data itself. That is two words per glyph.
 */
function engineKey(profile: AsciiProfile): string {
  const { masksLo, masksHi, coverage } = profile.structural
  let h = 0x811c9dc5
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193) >>> 0
  }
  for (let g = 0; g < profile.glyphCount; g++) {
    mix(masksLo[g])
    mix(masksHi[g])
    mix(coverage[g])
  }
  const { atlas } = profile
  return [
    profile.fingerprint,
    profile.glyphCount,
    `${atlas.width}x${atlas.height}`,
    `${atlas.pitchWidth}x${atlas.pitchHeight}`,
    atlas.rgba?.length ?? 0,
    profile.chromatic?.samples.length ?? 0,
    h.toString(16),
  ].join('|')
}

async function open(): Promise<Shared> {
  if (current && !current.lost) return current
  if (opening) return opening
  opening = (async () => {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('WebGPU is present but no adapter is available on this device.')
    const device = await adapter.requestDevice()
    const shared: Shared = { device, engines: new Map(), refs: 0, queue: Promise.resolve() }
    void device.lost.then((info) => {
      shared.lost = info
      // The next lease opens a fresh device rather than joining this one.
      if (current === shared) current = undefined
    })
    current = shared
    return shared
  })()
  try {
    return await opening
  } finally {
    opening = undefined
  }
}

function drop(shared: Shared): void {
  if (--shared.refs > 0) return
  for (const entry of shared.engines.values()) entry.engine.destroy()
  shared.engines.clear()
  if (current === shared) current = undefined
  shared.device.destroy()
}

async function setup(
  shared: Shared,
  profile: AsciiProfile,
  format: GPUTextureFormat,
): Promise<GpuLease> {
  const { device } = shared
  const key = engineKey(profile)
  // WebGPU reports most failures through error scopes, not exceptions. createBuffer,
  // createTexture and createBindGroup all validate silently, so a browser whose limits or
  // WGSL support differ from the one this was developed on can accept every setup call and
  // then render nothing — indistinguishable from a working renderer unless we ask. Asking is
  // what makes 'auto' able to fall back instead of sitting on a GPU path that paints nothing.
  device.pushErrorScope('validation')
  device.pushErrorScope('internal')
  let entry = shared.engines.get(key)
  const built = !entry
  let stream: AsciiStream | undefined
  let thrown: unknown
  let ok = false
  try {
    if (!entry) entry = { engine: await AsciiEngine.create(device, profile), refs: 0 }
    stream = await entry.engine.createStream(format)
    ok = true
  } catch (err) {
    thrown = err
  }
  // Always popped, or the next setup on this device would read this one's scopes.
  const internal = await device.popErrorScope().catch(() => null)
  const validation = await device.popErrorScope().catch(() => null)
  const failure = internal ?? validation
  if (!ok || failure || !entry || !stream) {
    stream?.destroy()
    // An engine built by this attempt is not cached and goes with it; a cached one stays.
    if (built) entry?.engine.destroy()
    if (!ok) throw thrown
    throw new Error(
      `WebGPU accepted the renderer setup and then reported an error, so it would render nothing: ${failure?.message ?? 'unknown error'}`,
    )
  }
  // A device can be handed out already lost (stale adapter) or die during setup. Every call
  // above then no-ops and BOTH error scopes resolve null, so without this check a dead
  // renderer passes setup, binds the canvas, and forecloses the CPU fallback. One macrotask
  // lets the lost promise's reaction run if it has already resolved.
  await new Promise((r) => setTimeout(r, 0))
  if (shared.lost) {
    stream.destroy()
    if (built) entry.engine.destroy()
    throw new Error(`WebGPU device was lost during renderer setup (${shared.lost.reason}).`)
  }

  const held = entry
  if (built) shared.engines.set(key, held)
  held.refs++
  let released = false
  return {
    device,
    engine: held.engine,
    stream,
    release: () => {
      if (released) return
      released = true
      if (--held.refs === 0) {
        held.engine.destroy()
        if (shared.engines.get(key) === held) shared.engines.delete(key)
      }
      drop(shared)
    },
  }
}

/** Lease the shared device, the engine for `profile`, and a new stream on it. */
export async function leaseGpu(profile: AsciiProfile, format: GPUTextureFormat): Promise<GpuLease> {
  const shared = await open()
  // Held from here, so another lease's release cannot destroy the device under this setup.
  shared.refs++
  const run = (): Promise<GpuLease> => setup(shared, profile, format)
  const attempt = shared.queue.then(run, run)
  shared.queue = attempt.catch(() => {})
  try {
    return await attempt
  } catch (err) {
    drop(shared)
    throw err
  }
}
