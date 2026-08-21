import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (): void => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
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
      setError(new Error(`GPU device lost and could not be restored: ${info.message || info.reason}`))
      return
    }
    setLostGeneration((g) => g + 1)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!profile || !canvas) return
    let live = true
    let created: AsciiRenderer | undefined
    createAsciiRenderer({ canvas, profile, backend, onDeviceLost: handleDeviceLost, ...runtimeRef.current })
      .then((r) => {
        if (!live) {
          r.destroy()
          return
        }
        created = r
        setRenderer(r)
        setError(null)
      })
      .catch((err: unknown) => {
        console.error('[ascii-fx] renderer init failed:', err)
        if (live) setError(err instanceof Error ? err : new Error(String(err)))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, runtimeKey])

  const interactionKey = JSON.stringify(interaction ?? null)
  useEffect(() => {
    renderer?.setInteraction(respectReducedMotion && reducedMotion ? null : (interaction ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, interactionKey, reducedMotion, respectReducedMotion])

  return { renderer, profile, error, canvasKey: `${backend ?? 'auto'}:${lostGeneration}` }
}
