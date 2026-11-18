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
  return useAsciiProfileState(source).profile
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

/**
 * `useAsciiProfile` with the failure alongside. A profile that never arrives leaves the
 * renderer unbuilt for good, which looks exactly like one that is still loading unless
 * something says otherwise — so `useAscii` reports this through its `error`.
 */
function useAsciiProfileState(source?: ProfileSource | null): {
  profile: AsciiProfile | null
  error: Error | null
} {
  const [state, setState] = useState<{ profile: AsciiProfile | null; error: Error | null }>({
    profile: null,
    error: null,
  })
  const key = useMemo(() => profileSourceKey(source), [source])
  useEffect(() => {
    let live = true
    // Inside a promise chain, not called here: both can throw before they return one —
    // `loadProfile` decodes bytes it was handed synchronously — and a throw from an effect
    // body unmounts the tree instead of reaching the catch below.
    const pending = Promise.resolve().then(() =>
      source == null ? createAsciiProfile() : loadProfile(source),
    )
    pending
      .then((p) => {
        if (live) setState({ profile: p, error: null })
      })
      .catch((err: unknown) => {
        console.error('[ascii-fx] profile load failed:', err)
        if (live) setState({ profile: null, error: asError(err) })
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
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
  /**
   * CPU-backend matcher workers. Default: one per core less one, capped at 8.
   * `false` matches on the main thread. Construction-time like `backend`, so
   * changing it rebuilds the renderer.
   */
  workers?: number | false
  /**
   * How the CPU backend paints. Default 'auto': a WebGL2 fullscreen composite
   * where WebGL2 exists, Canvas2D otherwise. Construction-time like `backend`.
   */
  compositor?: 'auto' | 'canvas2d'
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
   * to be thrown away and remade: on a `backend` or `compositor` switch, after a GPU
   * device loss the renderer could not recover from, and when a rebuild lands on a
   * different context type than the element already has (a profile swap that takes
   * 'auto' from WebGPU to the CPU matcher, say). All of them need a *new element* — a
   * canvas is bound to its first context type for good, so a canvas that ran WebGPU
   * can never fall back to the CPU matcher.
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
  const { profile, error: profileError } = useAsciiProfileState(options.profile)
  const [renderer, setRenderer] = useState<AsciiRenderer | null>(null)
  const [error, setError] = useState<Error | null>(null)
  /** A `setOptions`/`setInteraction` the renderer refused. Cleared by the next one it takes. */
  const [optionError, setOptionError] = useState<Error | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const {
    profile: _p,
    backend,
    workers,
    compositor,
    interaction,
    respectReducedMotion = true,
    ...runtime
  } = options
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

  // A rebuild reuses the canvas element, and an element keeps the context type its first
  // renderer gave it. Most rebuilds ask for the same type again. One that does not — 'auto'
  // moving from WebGPU to the CPU matcher because the new profile is past the GPU's limits
  // — fails on an element that a fresh mount would have had no trouble with. So a failure
  // on an element that has already hosted a renderer is retried once on a new one before it
  // counts; a failure on a fresh element is real, which is also what ends the retrying.
  const hosted = useRef(new WeakSet<HTMLCanvasElement>())
  const [contextGeneration, setContextGeneration] = useState(0)

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
          workers,
          compositor,
          onDeviceLost: handleDeviceLost,
          ...runtimeRef.current,
        })
        if (!live) {
          r.destroy()
          return
        }
        created = r
        hosted.current.add(canvas)
        setRenderer(r)
        setError(null)
      } catch (err) {
        if (!live) return
        if (hosted.current.has(canvas)) {
          setContextGeneration((g) => g + 1)
          return
        }
        console.error('[ascii-fx] renderer init failed:', err)
        setError(asError(err))
      }
    })
    return () => {
      live = false
      created?.destroy()
      setRenderer(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, backend, workers, compositor, canvasRef, lostGeneration, contextGeneration])

  // Both pushes below can be refused — a chromatic matcher on a profile with no chromatic
  // data, jitter out of range, a motion-driven effect that has no single origin. Thrown from
  // an effect that would take the whole tree down; the renderer keeps its last good options,
  // so this reports it and carries on.
  const runtimeKey = rendererOptionsKey(runtime)
  useEffect(() => {
    if (!renderer) return
    try {
      renderer.setOptions(runtimeRef.current)
      // setOptions marks the frame stale and leaves the repaint to whatever is rendering.
      // A still has nothing rendering, so it is painted here; not before it has a source.
      if (renderer.grid()) renderer.render()
      setOptionError(null)
    } catch (err) {
      console.error('[ascii-fx] options rejected:', err)
      setOptionError(asError(err))
    }
    // `runtimeKey` is the trigger, not a value the body reads: it is what turns a new
    // options object into one push when the options actually differ.
  }, [renderer, runtimeKey])

  const interactionKey = JSON.stringify(interaction ?? null)
  useEffect(() => {
    if (!renderer) return
    try {
      renderer.setInteraction(respectReducedMotion && reducedMotion ? null : (interaction ?? null))
    } catch (err) {
      console.error('[ascii-fx] interaction rejected:', err)
      setOptionError(asError(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, interactionKey, reducedMotion, respectReducedMotion])

  return {
    renderer,
    profile,
    error: error ?? profileError ?? optionError,
    canvasKey: `${backend ?? 'auto'}:${compositor ?? 'auto'}:${lostGeneration}:${contextGeneration}`,
  }
}
