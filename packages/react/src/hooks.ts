import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AsciiProfile, AsciiSupport, ProfileSource } from '@ascii-fx/core'
import { createAsciiProfile, loadProfile } from '@ascii-fx/core'
import type {
  AsciiRenderer,
  AsciiRendererRuntimeOptions,
  BackendChoice,
  InteractionOptions,
} from '@ascii-fx/gpu'
import { createAsciiRenderer, getAsciiSupport } from '@ascii-fx/gpu'
import { profileSourceKey, rendererOptionsKey } from './hookKeys.js'

/** Capability probe as a hook (spec §50). null until resolved. */
export function useAsciiSupport(): AsciiSupport | null {
  const [support, setSupport] = useState<AsciiSupport | null>(null)
  useEffect(() => {
    let live = true
    void getAsciiSupport().then((s) => {
      if (live) setSupport(s)
    })
    return () => {
      live = false
    }
  }, [])
  return support
}

/**
 * Resolve a ProfileSource (object, bytes, URL, or virtual-module ref). With no
 * source, a runtime 'monospace' profile is generated (spec §14: zero-config
 * must remain good) — precompiled profiles stay the recommended path.
 */
export function useAsciiProfile(source?: ProfileSource | null): AsciiProfile | null {
  const [profile, setProfile] = useState<AsciiProfile | null>(null)
  const key = useMemo(() => profileSourceKey(source), [source])
  useEffect(() => {
    let live = true
    const pending = source == null ? createAsciiProfile() : loadProfile(source)
    pending
      .then((p) => {
        if (live) setProfile(p)
      })
      .catch((err: unknown) => {
        console.error('[ascii-fx] profile load failed:', err)
        if (live) setProfile(null)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return profile
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof matchMedia === 'undefined') return () => {}
  const mq = matchMedia(REDUCED_MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/**
 * The OS reduced-motion preference, read as an external store rather than
 * state-plus-effect: the first client render already sees the real value instead of
 * flashing `false` and re-rendering, and the server snapshot is explicitly `false`
 * so hydration matches (spec §18).
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof matchMedia !== 'undefined' && matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  )
}

export interface UseAsciiOptions extends AsciiRendererRuntimeOptions {
  /** Omit for a runtime 'monospace' profile (spec §14). */
  profile?: ProfileSource
  backend?: BackendChoice
  interaction?: InteractionOptions | null
  /** Default true: disable motion interactions when the OS requests reduced motion. */
  respectReducedMotion?: boolean
}

export interface UseAsciiResult {
  renderer: AsciiRenderer | null
  profile: AsciiProfile | null
  error: Error | null
  /**
   * Put this on your `<canvas key={canvasKey}>`. It changes when the canvas has
   * to be thrown away and remade: on a backend switch, and after a GPU device
   * loss the renderer could not recover from. Both need a *new element* — a
   * canvas is bound to its first context type for good, so a canvas that ran
   * WebGPU can never fall back to the CPU matcher.
   */
  canvasKey: string
}

/** Remounts after this many unrecovered device losses are treated as a dead GPU. */
const MAX_DEVICE_LOSS_REMOUNTS = 3

/**
 * Renderer lifecycle on a canvas ref (spec §31): created once per
 * (profile, backend); ordinary prop changes map to setOptions; interaction
 * and pointer never recreate anything. Honors prefers-reduced-motion by
 * disabling interactions while keeping the static ASCII (§32).
 */
export function useAscii(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: UseAsciiOptions,
): UseAsciiResult {
  const profile = useAsciiProfile(options.profile)
  const [renderer, setRenderer] = useState<AsciiRenderer | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const { profile: _p, backend, interaction, respectReducedMotion = true, ...runtime } = options
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime

  // The renderer rebuilds on a fresh device by itself; this is the case where it
  // could not. Recovering from that means starting over on a new canvas element,
  // which is the one thing the renderer cannot do for itself — so bump a
  // generation, let React remount the canvas, and build again. 'auto' then picks
  // the backend against current conditions and lands on CPU if the GPU is gone.
  const [lostGeneration, setLostGeneration] = useState(0)
  const remounts = useRef(0)
  const handleDeviceLost = useCallback((info: GPUDeviceLostInfo) => {
    remounts.current += 1
    if (remounts.current > MAX_DEVICE_LOSS_REMOUNTS) {
      setError(
        new Error(`GPU device lost and could not be restored: ${info.message || info.reason}`),
      )
      return
    }
    setLostGeneration((g) => g + 1)
  }, [])

  // Overlapping inits on one canvas are poison: each create configures the
  // shared GPUCanvasContext in its constructor, and destroying a superseded
  // renderer unconfigures it — out from under the survivor, whose next
  // getCurrentTexture then throws with nothing ever reconfiguring. StrictMode
  // guarantees the overlap on every dev mount; the chain serializes inits so a
  // superseded one is fully created and destroyed (or skipped — its `live`
  // flag is usually already false by the time its turn comes) before the next
  // touches the context.
  const initChain = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const canvas = canvasRef.current
    if (!profile || !canvas) return
    let live = true
    let created: AsciiRenderer | undefined
    initChain.current = initChain.current.then(async () => {
      if (!live) return
      try {
        const r = await createAsciiRenderer({
          canvas,
          profile,
          backend,
          onDeviceLost: handleDeviceLost,
          ...runtimeRef.current,
        })
        if (!live) {
          r.destroy()
          return
        }
        created = r
        setRenderer(r)
        setError(null)
      } catch (err) {
        console.error('[ascii-fx] renderer init failed:', err)
        if (live) setError(err instanceof Error ? err : new Error(String(err)))
      }
    })
    return () => {
      live = false
      created?.destroy()
      setRenderer(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, backend, canvasRef, lostGeneration])

  const runtimeKey = rendererOptionsKey(runtime)
  useEffect(() => {
    renderer?.setOptions(runtimeRef.current)
    // `runtimeKey` is the trigger, not a value the body reads: it is what turns a new
    // options object into one push when the options actually differ.
  }, [renderer, runtimeKey])

  const interactionKey = JSON.stringify(interaction ?? null)
  useEffect(() => {
    renderer?.setInteraction(respectReducedMotion && reducedMotion ? null : (interaction ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, interactionKey, reducedMotion, respectReducedMotion])

  return { renderer, profile, error, canvasKey: `${backend ?? 'auto'}:${lostGeneration}` }
}
