import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { AlphaMode, AsciiFrame, AsciiSupport, ColorMode, ProfileSource, RGB } from '@ascii-fx/core'
import type { AsciiRenderer, BackendChoice, FitMode, InteractionOptions } from '@ascii-fx/gpu'
import { getAsciiSupport } from '@ascii-fx/gpu'
import { useAscii } from './hooks.js'

export interface AsciiCommonProps {
  /** Omit for a runtime 'monospace' profile — precompiled profiles render faster and deterministically. */
  profile?: ProfileSource
  backend?: BackendChoice
  columns?: number
  rows?: number
  color?: ColorMode
  alpha?: AlphaMode
  foreground?: RGB
  background?: RGB
  flatThreshold?: number
  fit?: FitMode
  clearColor?: readonly [number, number, number, number]
  interaction?: InteractionOptions | null
  className?: string
  style?: CSSProperties
}

/** Imperative surface (spec §31). */
export interface AsciiHandle {
  renderer: AsciiRenderer | null
  render(): void
  capture(): Promise<AsciiFrame>
  getSupport(): Promise<AsciiSupport>
}

const wrapperStyle = (style?: CSSProperties): CSSProperties => ({
  position: 'relative',
  display: 'block',
  overflow: 'hidden',
  ...style,
})

const canvasStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
}

const fallbackStyle = (ready: boolean): CSSProperties => ({
  display: 'block',
  width: '100%',
  height: 'auto',
  // opacity keeps the element in the accessibility tree (§32) and the layout
  // stable (§18) while the canvas takes over visually.
  opacity: ready ? 0 : 1,
})

function useCanvasAutosize(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  renderer: AsciiRenderer | null,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !renderer || typeof ResizeObserver === 'undefined') return
    const sync = (): void => {
      const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        renderer.resize(w, h)
        renderer.render()
      }
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [canvasRef, renderer])
}

function useHandle(
  ref: React.ForwardedRef<AsciiHandle>,
  renderer: AsciiRenderer | null,
): void {
  useImperativeHandle(
    ref,
    () => ({
      renderer,
      render: () => renderer?.render(),
      capture: () => {
        if (!renderer) return Promise.reject(new Error('Renderer not ready yet.'))
        return renderer.captureFrame()
      },
      getSupport: () => getAsciiSupport(),
    }),
    [renderer],
  )
}

function usePointerForward(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  renderer: AsciiRenderer | null,
): void {
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || !renderer) return
    const onMove = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      renderer.pointer.set((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [wrapperRef, renderer])
}

export interface AsciiImageProps extends AsciiCommonProps {
  src: string
  /** Required; use alt="" for decorative images (spec §32). */
  alt: string
  crossOrigin?: 'anonymous' | 'use-credentials'
}

export const AsciiImage = forwardRef<AsciiHandle, AsciiImageProps>(function AsciiImage(props, ref) {
  const { src, alt, crossOrigin, className, style, profile, backend, interaction, ...options } = props
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [ready, setReady] = useState(false)
  const { renderer } = useAscii(canvasRef, { profile, backend, interaction, ...options })

  useEffect(() => {
    const img = imgRef.current
    if (!renderer || !img) return
    let live = true
    const attach = (): void => {
      if (!live || img.naturalWidth === 0) return
      renderer.setSource(img)
      renderer.render()
      setReady(true)
    }
    if (img.complete) attach()
    img.addEventListener('load', attach)
    return () => {
      live = false
      img.removeEventListener('load', attach)
      setReady(false)
    }
  }, [renderer, src])

  useCanvasAutosize(canvasRef, renderer)
  usePointerForward(wrapperRef, renderer)
  useHandle(ref, renderer)

  return (
    <div ref={wrapperRef} className={className} style={wrapperStyle(style)}>
      <img ref={imgRef} src={src} alt={alt} crossOrigin={crossOrigin} style={fallbackStyle(ready)} />
      {/* keyed by backend: a canvas is locked to its first context type, so a backend switch needs a fresh element */}
      <canvas key={backend ?? "auto"} ref={canvasRef} aria-hidden style={canvasStyle} />
    </div>
  )
})

export interface AsciiVideoProps extends AsciiCommonProps {
  src: string
  poster?: string
  muted?: boolean
  loop?: boolean
  autoPlay?: boolean
  playsInline?: boolean
}

export const AsciiVideo = forwardRef<AsciiHandle, AsciiVideoProps>(function AsciiVideo(props, ref) {
  const {
    src,
    poster,
    muted = true,
    loop = true,
    autoPlay = true,
    playsInline = true,
    className,
    style,
    profile,
    backend,
    interaction,
    ...options
  } = props
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const { renderer } = useAscii(canvasRef, { profile, backend, interaction, ...options })

  useEffect(() => {
    const video = videoRef.current
    if (!renderer || !video) return
    let live = true
    const attach = (): void => {
      if (!live || video.videoWidth === 0) return
      renderer.setSource(video)
      renderer.render()
      renderer.start()
      setReady(true)
    }
    if (video.readyState >= 2) attach()
    video.addEventListener('loadeddata', attach)
    return () => {
      live = false
      video.removeEventListener('loadeddata', attach)
      renderer.stop()
      setReady(false)
    }
  }, [renderer, src])

  useCanvasAutosize(canvasRef, renderer)
  usePointerForward(wrapperRef, renderer)
  useHandle(ref, renderer)

  return (
    <div ref={wrapperRef} className={className} style={wrapperStyle(style)}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted={muted}
        loop={loop}
        autoPlay={autoPlay}
        playsInline={playsInline}
        style={fallbackStyle(ready)}
      />
      <canvas key={backend ?? "auto"} ref={canvasRef} aria-hidden style={canvasStyle} />
    </div>
  )
})

export interface AsciiCanvasProps extends AsciiCommonProps {
  /** The canvas you draw into; ASCII renders from it. */
  source?: HTMLCanvasElement | OffscreenCanvas | null
  /** 'continuous' re-matches every animation frame (§45). Default 'continuous'. */
  renderMode?: 'manual' | 'continuous'
  children?: ReactNode
}

export const AsciiCanvas = forwardRef<AsciiHandle, AsciiCanvasProps>(function AsciiCanvas(props, ref) {
  const { source, renderMode = 'continuous', children, className, style, profile, backend, interaction, ...options } =
    props
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { renderer } = useAscii(canvasRef, { profile, backend, interaction, ...options })

  useEffect(() => {
    if (!renderer || !source) return
    renderer.setSource(source)
    if (renderMode === 'continuous') renderer.start()
    else renderer.render()
    return () => renderer.stop()
  }, [renderer, source, renderMode])

  useCanvasAutosize(canvasRef, renderer)
  usePointerForward(wrapperRef, renderer)
  useHandle(ref, renderer)

  return (
    <div ref={wrapperRef} className={className} style={wrapperStyle(style)}>
      {children}
      <canvas key={backend ?? "auto"} ref={canvasRef} aria-hidden style={canvasStyle} />
    </div>
  )
})
