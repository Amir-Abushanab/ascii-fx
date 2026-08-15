import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { WebGPURenderer } from 'three/webgpu'
import type { AsciiFrame, AsciiProfile, ProfileSource } from '@ascii-fx/core'
import { loadProfile } from '@ascii-fx/core'
import type { FitMode, InteractionOptions, InteractionType, StreamMatchOptions } from '@ascii-fx/gpu'
import { AsciiGlyphs as AsciiGlyphsImpl, AsciiPass } from '@ascii-fx/three'

export interface UseAsciiEffectOptions extends StreamMatchOptions {
  profile: ProfileSource
  fit?: FitMode
  clearColor?: readonly [number, number, number, number]
  /** Interaction preset name or full options (spec §2: interaction="reveal"). */
  interaction?: InteractionType | InteractionOptions | null
}

const normalizeInteraction = (
  interaction: InteractionType | InteractionOptions | null | undefined,
): InteractionOptions | null =>
  interaction == null ? null : typeof interaction === 'string' ? { type: interaction } : interaction

/**
 * AsciiPass lifecycle inside an R3F canvas. Requires the Canvas to run a
 * THREE.WebGPURenderer (`gl` factory returning WebGPURenderer in R3F v9).
 * Takes over the render loop while mounted; pointer is wired automatically.
 */
export function useAsciiEffect(options: UseAsciiEffectOptions): AsciiPass | null {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const [pass, setPass] = useState<AsciiPass | null>(null)
  const [profile, setProfile] = useState<AsciiProfile | null>(null)
  const { profile: profileSource, interaction, fit, clearColor, ...match } = options

  useEffect(() => {
    let live = true
    loadProfile(profileSource)
      .then((p) => {
        if (live) setProfile(p)
      })
      .catch((err: unknown) => console.error('[ascii-fx] profile load failed:', err))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeof profileSource === 'string' ? profileSource : profileSource])

  useEffect(() => {
    if (!profile) return
    const renderer = gl as unknown as WebGPURenderer & { isWebGPURenderer?: boolean }
    if (!renderer.isWebGPURenderer) {
      console.error(
        '[ascii-fx] <AsciiEffect> requires a THREE.WebGPURenderer — pass `gl` accordingly to <Canvas>. ' +
          'WebGL renderers are unsupported (spec §30).',
      )
      return
    }
    let live = true
    const created = new AsciiPass({ profile, renderer, fit, clearColor })
    void created.init().then(() => {
      if (!live) {
        created.dispose()
        return
      }
      setPass(created)
    })
    return () => {
      live = false
      created.dispose()
      setPass(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, profile])

  const matchKey = JSON.stringify([match.columns, match.rows, match.color, match.alpha, match.foreground, match.background, match.flatThreshold, fit, clearColor])
  useEffect(() => {
    pass?.set({ ...match, fit, clearColor })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass, matchKey])

  const interactionKey = JSON.stringify(interaction ?? null)
  useEffect(() => {
    pass?.setInteraction(normalizeInteraction(interaction))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass, interactionKey])

  useEffect(() => {
    if (!pass) return
    const renderer = gl as unknown as WebGPURenderer
    const dpr = renderer.getPixelRatio()
    pass.setSize(Math.max(1, Math.round(size.width * dpr)), Math.max(1, Math.round(size.height * dpr)))
  }, [pass, size, gl])

  useFrame((state) => {
    if (!pass) return
    pass.pointer.set((state.pointer.x + 1) / 2, (1 - state.pointer.y) / 2)
    pass.render(state.scene, state.camera)
  }, 1)

  return pass
}

export interface AsciiEffectProps extends UseAsciiEffectOptions {}

/** Declarative AsciiPass (spec §2): `<AsciiEffect profile={p} columns={180} interaction="reveal" />` */
export function AsciiEffect(props: AsciiEffectProps): null {
  useAsciiEffect(props)
  return null
}

export interface AsciiGlyphsProps {
  profile: AsciiProfile
  columns: number
  rows: number
  cellSize?: number
  /** Matched frame to display (from captureFrame() or matchFrame()). */
  frame?: AsciiFrame | null
}

/** Instanced glyph field as an R3F element. */
export function AsciiGlyphs(props: AsciiGlyphsProps): React.JSX.Element {
  const { profile, columns, rows, cellSize, frame } = props
  const glyphs = useMemo(
    () => new AsciiGlyphsImpl({ profile, columns, rows, cellSize }),
    [profile, columns, rows, cellSize],
  )
  useEffect(() => () => glyphs.dispose(), [glyphs])
  useEffect(() => {
    if (frame) glyphs.updateFromFrame(frame)
  }, [glyphs, frame])
  return <primitive object={glyphs.mesh} />
}
