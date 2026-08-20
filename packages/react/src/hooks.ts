import { useEffect, useMemo, useRef, useState } from 'react'
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
}

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!profile || !canvas) return
    let live = true
    let created: AsciiRenderer | undefined
    createAsciiRenderer({ canvas, profile, backend, ...runtimeRef.current })
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
  }, [profile, backend, canvasRef])

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

  return { renderer, profile, error }
}
