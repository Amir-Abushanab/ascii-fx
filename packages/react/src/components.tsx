import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type {
  AlphaMode,
  AsciiFrame,
  AsciiSupport,
  ColorMode,
  ProfileSource,
  RGB,
} from '@ascii-fx/core'
import type {
  AsciiRenderer,
  BackendChoice,
  FitMode,
  InteractionOptions,
  TiltOptions,
  TiltStatus,
} from '@ascii-fx/gpu'
import { getAsciiSupport } from '@ascii-fx/gpu'
// The tilt runtime is NOT imported here: `useTiltForward` fetches '@ascii-fx/gpu/tilt' only when a
// component actually asks for tilt, so the ~1.1 KB sensor stays out of every bundle that doesn't.
import type { TiltSource } from '@ascii-fx/gpu/tilt'
import { useAscii, usePrefersReducedMotion } from './hooks.js'

export interface AsciiCommonProps {
  /** Omit for a runtime 'monospace' profile — precompiled profiles render faster and deterministically. */
  profile?: ProfileSource
  backend?: BackendChoice
  /**
   * CPU-backend matcher workers. Default: one per core less one, capped at 8;
   * `false` matches on the main thread. Set at creation, like `backend`.
   */
  workers?: number | false
  /**
   * How the CPU backend paints: 'auto' (WebGL2 where available) or 'canvas2d'.
   * Set at creation, like `backend`.
   */
  compositor?: 'auto' | 'canvas2d'
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
  /**
   * Drive the pointer from the device's orientation sensor, so the `interaction` effect above works
   * on a phone — which has no cursor to give it. `true` takes the defaults; an object tunes `range`
   * (degrees to the edges, default 25), `smoothing` (default 0.18) and `invertX` / `invertY`.
   *
   * On iOS this does nothing, on purpose. Safari gates the sensor behind a modal permission dialog
   * and nothing here opens one, so the pointer simply stays where it was and the component looks
   * exactly as it does without `tilt`. Treat tilt as an enhancement some phones don't get, the way
   * you would a hover state — a decorative effect is not worth interrupting a reader to ask for a
   * sensor. (A page where tilt IS the point can call `enableTilt()` on the handle from a tap.)
   * Elsewhere it starts as soon as the renderer exists. Suppressed, like autoplay, while
   * `respectReducedMotion` holds and the reader asked for reduced motion: a page that shifts
   * whenever the phone moves is the kind of motion that preference is about.
   */
  tilt?: boolean | TiltOptions
  temporal?: boolean
  adaptiveResolution?: boolean
  /** Pause continuous rendering while the component is outside the viewport. Default true. */
  pauseWhenOffscreen?: boolean
  /** Honor the user's reduced-motion preference for autoplay and interactions. Default true. */
  respectReducedMotion?: boolean
  /**
   * Called when the renderer cannot be created, or when a GPU device loss could not be
   * recovered from. Visually this needs no handling — the `<img>`/`<video>` fallback is
   * already on screen and stays there (spec §18) — but without this there is no way for
   * an app to log it or report it, so a silent degrade looks identical to success.
   */
  onError?: (error: Error) => void
  className?: string
  style?: CSSProperties
}

/** Imperative surface (spec §31). */
export interface AsciiHandle {
  renderer: AsciiRenderer | null
  render(): void
  capture(): Promise<AsciiFrame>
  getSupport(): Promise<AsciiSupport>
  /**
   * Explicitly ask for the orientation sensor behind the `tilt` prop. OPTIONAL, and on iOS it opens
   * a modal permission dialog — nothing calls it for you, and a decorative effect should simply go
   * without tilt there rather than interrupt the reader.
   *
   * CALL IT FROM A USER GESTURE: iOS 13+ only grants the sensor from inside a tap handler, and
   * awaiting anything before it spends the gesture. Resolves true once readings can flow — false
   * when the platform has no sensor, `tilt` is off, or the reader refused. Where no permission is
   * required tilt is already live and this resolves true.
   */
  enableTilt(): Promise<boolean>
  /** Where the tilt sensor stands. `'prompt'` means the platform has a sensor but gates it, and
   *  tilt stays inert unless the page explicitly asks — information, not an instruction to ask. */
  tiltStatus(): TiltStatus
  /** Take the next orientation reading as the neutral pose (the reader has changed grip). */
  recenterTilt(): void
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

/**
 * Hand a renderer failure to the consumer exactly once per distinct error. Kept in a ref
 * so an inline `onError={(e) => ...}` — the common way to pass it — does not re-fire the
 * effect on every render.
 */
function useErrorCallback(error: Error | null, onError?: (error: Error) => void): void {
  const ref = useRef(onError)
  // Refreshed in an effect rather than during render. Effects run in
  // declaration order, so a commit that changes both `onError` and `error`
  // still fires the new callback.
  useEffect(() => {
    ref.current = onError
  }, [onError])
  useEffect(() => {
    if (error) ref.current?.(error)
  }, [error])
}

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
  tilt: React.RefObject<TiltSource | null>,
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
      enableTilt: () => tilt.current?.enable() ?? Promise.resolve(false),
      // Before the chunk lands there is no sensor to ask, but the platform check needs no chunk.
      tiltStatus: () => tilt.current?.status ?? (sensorPresent() ? 'prompt' : 'unsupported'),
      recenterTilt: () => tilt.current?.recenter(),
    }),
    [renderer, tilt],
  )
}

/**
 * Drive the renderer's pointer from the device's orientation sensor while the `tilt` prop asks for
 * it, and hand back the live source so the imperative handle can prompt for permission and
 * recenter it.
 *
 * The source is built from `renderer` and the on/off state ALONE, never from the options object:
 * an inline `tilt={{ range: 20 }}` is a new object every commit, and rebuilding on that would drop
 * the neutral pose the reader had settled into — and, on iOS, the permission they had granted.
 * Retuning pushes the new numbers into the object both the source and the follow loop already hold.
 */
function useTiltForward(
  renderer: AsciiRenderer | null,
  tilt: boolean | TiltOptions | undefined,
  respectReducedMotion: boolean,
): React.RefObject<TiltSource | null> {
  const reducedMotion = usePrefersReducedMotion()
  const sourceRef = useRef<TiltSource | null>(null)
  const optionsRef = useRef<TiltOptions>({})
  const on = Boolean(tilt) && !(respectReducedMotion && reducedMotion)

  // Retuning is a push, never a rebuild. Runs before the effect below on mount, so a source is
  // always constructed with the options of the render that asked for it.
  useEffect(() => {
    const next = tilt === true || !tilt ? {} : tilt
    optionsRef.current = next
    sourceRef.current?.setOptions(next)
  }, [tilt])

  useEffect(() => {
    if (!renderer || !on) return
    let stop: (() => void) | undefined
    let cancelled = false
    void import('@ascii-fx/gpu/tilt')
      .then(({ TiltSource, forwardTiltToPointer }) => {
        if (cancelled) return
        const source = new TiltSource(optionsRef.current)
        sourceRef.current = source
        stop = forwardTiltToPointer(source, renderer.pointer)
      })
      .catch(() => {
        // Chunk unavailable (offline, a stale deploy): the pointer simply stays where it was.
      })
    return () => {
      cancelled = true
      stop?.()
      sourceRef.current?.dispose()
      sourceRef.current = null
    }
  }, [renderer, on])

  return sourceRef
}

/** Whether the platform has an orientation sensor at all — the one tilt question answerable without
 *  fetching the tilt chunk, and the one an app needs before deciding whether to offer tilt. */
function sensorPresent(): boolean {
  return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined'
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
      renderer.pointer.set(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      )
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [wrapperRef, renderer])
}

/**
 * Resolve document visibility, viewport intersection and the motion preference into the
 * one boolean that decides whether a loop may run, and call `onChange` whenever it moves.
 *
 * Factored out because two loops now gate on it — the playback loop below and the source
 * draw loop in `<AsciiImage>` — and they have to agree. A component that keeps re-matching
 * while scrolled out of view, or that animates under `prefers-reduced-motion`, is a bug in
 * whichever of the two grew its own copy of the predicate.
 *
 * `visible` is reported alongside because "must not run" and "is not on screen" are
 * different: a loop stopped for reduced motion still owes a static frame to a component
 * the user is looking at.
 */
function observeRunGate(
  element: HTMLElement | null,
  options: { pauseWhenOffscreen: boolean; motionAllowed: boolean },
  onChange: (shouldRun: boolean, visible: boolean) => void,
): () => void {
  const { pauseWhenOffscreen, motionAllowed } = options
  let intersecting = true

  const sync = (): void => {
    const documentVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const shouldRun = documentVisible && motionAllowed && (!pauseWhenOffscreen || intersecting)
    onChange(shouldRun, documentVisible && intersecting)
  }

  const onVisibilityChange = (): void => sync()
  document.addEventListener('visibilitychange', onVisibilityChange)

  let observer: IntersectionObserver | undefined
  if (pauseWhenOffscreen && element && typeof IntersectionObserver !== 'undefined') {
    const rect = element.getBoundingClientRect()
    intersecting =
      rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth
    observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? true
      sync()
    })
    observer.observe(element)
  }

  sync()
  return () => {
    observer?.disconnect()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Keep expensive render/media loops aligned with actual component visibility. */
function useContinuousPlayback(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  renderer: AsciiRenderer | null,
  enabled: boolean,
  pauseWhenOffscreen: boolean,
  respectReducedMotion: boolean,
  mediaRef?: React.RefObject<HTMLVideoElement | null>,
): boolean {
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (!renderer || !enabled) {
      renderer?.stop()
      return
    }
    // Captured here, not read in the cleanup: by teardown React may already have
    // detached the ref, and pausing whichever element this effect actually drove is
    // the point.
    const mediaElement = mediaRef?.current
    let running = false

    const stopGate = observeRunGate(
      wrapperRef.current,
      { pauseWhenOffscreen, motionAllowed: !respectReducedMotion || !reducedMotion },
      (shouldRun, visible) => {
        const media = mediaRef?.current
        if (shouldRun) {
          if (!running) renderer.start()
          if (media?.paused) void media.play().catch(() => {})
        } else {
          renderer.stop()
          media?.pause()
          // Reduced motion still gets a useful static frame when visible.
          if (!running && visible) renderer.render()
        }
        running = shouldRun
      },
    )

    return () => {
      stopGate()
      renderer.stop()
      mediaElement?.pause()
    }
  }, [
    wrapperRef,
    renderer,
    enabled,
    pauseWhenOffscreen,
    respectReducedMotion,
    reducedMotion,
    mediaRef,
  ])

  return reducedMotion
}

/**
 * Paint the source yourself, instead of the image going to the matcher untouched.
 *
 * The matcher is exact about what it is given and deliberately owns nothing upstream of
 * that, so every pixel effect — a contrast curve, a grain pass, a channel shift — belongs
 * here rather than in a renderer option. `<AsciiImage>` had no seam for it at all: the
 * `<img>` went straight to `setSource`, and wanting one changed pixel meant dropping to
 * `<AsciiCanvas>` and hand-rolling the load, the buffer and the loop.
 *
 * `ctx` is a 2D context over a buffer the image's own natural size, so `fit`, `columns`
 * and the rest behave exactly as they do without a `draw`. Nothing is drawn into it for
 * you — paint the image first if you want it, which is what makes `draw` able to replace
 * the picture rather than only decorate it. The buffer is not cleared between frames
 * either, so a `draw` that means to start clean must say so.
 *
 * One rule decides whether an effect survives the grid: a cell samples `width / columns`
 * source pixels across and fits a single colour to the whole block, so a feature finer
 * than that arrives as its share of the average instead of as itself. Grain at 1px on a
 * 2000px-wide image at 120 columns is invisible; the same grain in ~16px blocks is not.
 *
 * `timeMs` is the frame time from `requestAnimationFrame`, or 0 for the first paint.
 */
export type AsciiDraw = (
  ctx: CanvasRenderingContext2D,
  source: { image: HTMLImageElement; width: number; height: number },
  timeMs: number,
) => void

export interface AsciiImageProps extends AsciiCommonProps {
  src: string
  /** Required; use alt="" for decorative images (spec §32). */
  alt: string
  crossOrigin?: 'anonymous' | 'use-credentials'
  /**
   * Paint the source instead of handing the `<img>` to the matcher as-is.
   *
   * Read fresh on every paint, so an animating image always calls the latest one. A
   * still repaints when this changes identity — cheap for the stable function this
   * expects, one extra match per parent render for an inline arrow, so wrap it in
   * `useCallback` if the parent renders often.
   */
  draw?: AsciiDraw
  /**
   * Re-run `draw` on a loop. Default false: a still stays a still, matched once, which
   * is the whole reason an image costs nothing per frame.
   *
   * The loop is this component's own, throttled to `fps` — not `renderer.start()`, which
   * runs at display rate. It stops off-screen, on a hidden tab, and under
   * `prefers-reduced-motion`, leaving the last painted frame up.
   */
  animate?: boolean
  /**
   * Ceiling for `animate`, in frames per second. Default 12.
   *
   * Deliberately not the display rate. Each frame is a full re-match, and glyph churn
   * above roughly 15fps stops reading as movement in the picture and starts reading as
   * noise in the text — so the default is both the cheaper and the better-looking one.
   */
  fps?: number
}

export const AsciiImage = forwardRef<AsciiHandle, AsciiImageProps>(function AsciiImage(props, ref) {
  const {
    src,
    alt,
    crossOrigin,
    draw,
    animate = false,
    fps = 12,
    className,
    style,
    profile,
    backend,
    interaction,
    pauseWhenOffscreen = true,
    respectReducedMotion = true,
    tilt,
    onError,
    ...options
  } = props
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [ready, setReady] = useState(false)
  const { renderer, canvasKey, error } = useAscii(canvasRef, {
    profile,
    backend,
    interaction,
    respectReducedMotion,
    ...options,
  })

  const reducedMotion = usePrefersReducedMotion()
  // Read at paint time rather than depended on: an inline `draw={(ctx) => …}` changes
  // identity every commit, and re-running the effect on that would rebuild the buffer and
  // re-`setSource` for a function that does the same thing.
  const drawRef = useRef(draw)
  const repaintRef = useRef<(() => void) | null>(null)
  const drawSynced = useRef(false)
  useEffect(() => {
    drawRef.current = draw
    // The attach below paints once with the current `draw`, so the first run of this
    // effect has nothing to do; after that, a still has to be told the pixels changed.
    // An animating one picks it up on its next frame by itself.
    if (drawSynced.current && draw && !animate) repaintRef.current?.()
    drawSynced.current = true
  }, [draw, animate])

  const drawn = Boolean(draw)
  useEffect(() => {
    const img = imgRef.current
    if (!renderer || !img) return
    let live = true
    let raf = 0
    let lastPaint = Number.NEGATIVE_INFINITY
    let stopGate: (() => void) | undefined

    const attach = (): void => {
      if (!live || img.naturalWidth === 0) return
      const buffer = drawn ? document.createElement('canvas') : undefined
      if (buffer) {
        buffer.width = img.naturalWidth
        buffer.height = img.naturalHeight
      }
      const ctx = buffer?.getContext('2d') ?? null
      if (!buffer || !ctx) {
        // No `draw`, or a context this browser would not give us: the plain path, where
        // the <img> is the source and one match is the entire cost.
        renderer.setSource(img)
        renderer.render()
        setReady(true)
        return
      }
      const meta = { image: img, width: buffer.width, height: buffer.height }
      const paint = (timeMs: number): void => {
        drawRef.current?.(ctx, meta, timeMs)
        renderer.render()
      }
      renderer.setSource(buffer)
      // Once, unconditionally — before any gate. Reduced motion and an off-screen mount
      // both still owe the reader the picture; what they withhold is the movement.
      paint(0)
      repaintRef.current = () => paint(performance.now())
      setReady(true)

      if (!animate) return
      const interval = 1000 / Math.max(1, fps)
      const step = (timeMs: number): void => {
        raf = requestAnimationFrame(step)
        if (timeMs - lastPaint < interval) return
        lastPaint = timeMs
        paint(timeMs)
      }
      stopGate = observeRunGate(
        wrapperRef.current,
        { pauseWhenOffscreen, motionAllowed: !respectReducedMotion || !reducedMotion },
        (shouldRun) => {
          if (shouldRun && !raf) raf = requestAnimationFrame(step)
          else if (!shouldRun && raf) {
            cancelAnimationFrame(raf)
            raf = 0
          }
        },
      )
    }

    if (img.complete) attach()
    img.addEventListener('load', attach)
    return () => {
      live = false
      img.removeEventListener('load', attach)
      if (raf) cancelAnimationFrame(raf)
      stopGate?.()
      repaintRef.current = null
      setReady(false)
    }
    // `src` is not read above, but it is a real dependency: swapping it has to
    // run this cleanup so readiness resets and the new source re-attaches.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [renderer, src, drawn, animate, fps, pauseWhenOffscreen, respectReducedMotion, reducedMotion])

  useErrorCallback(error, onError)
  useCanvasAutosize(canvasRef, renderer)
  usePointerForward(wrapperRef, renderer)
  useHandle(ref, renderer, useTiltForward(renderer, tilt, respectReducedMotion))

  return (
    <div ref={wrapperRef} className={className} style={wrapperStyle(style)}>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        crossOrigin={crossOrigin}
        style={fallbackStyle(ready)}
      />
      {/* keyed: a canvas is locked to its first context type, so both a backend switch and an
          unrecoverable GPU device loss need a fresh element rather than a new renderer */}
      <canvas key={canvasKey} ref={canvasRef} aria-hidden style={canvasStyle} />
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
    pauseWhenOffscreen = true,
    respectReducedMotion = true,
    tilt,
    onError,
    ...options
  } = props
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const { renderer, canvasKey, error } = useAscii(canvasRef, {
    profile,
    backend,
    interaction,
    respectReducedMotion,
    ...options,
  })

  useEffect(() => {
    const video = videoRef.current
    if (!renderer || !video) return
    let live = true
    const attach = (): void => {
      if (!live || video.videoWidth === 0) return
      renderer.setSource(video)
      renderer.render()
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
    // `src` is not read above, but it is a real dependency: swapping it has to
    // run this cleanup so readiness resets and the new source re-attaches.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [renderer, src])

  const reducedMotion = useContinuousPlayback(
    wrapperRef,
    renderer,
    ready && autoPlay,
    pauseWhenOffscreen,
    respectReducedMotion,
    videoRef,
  )

  useErrorCallback(error, onError)
  useCanvasAutosize(canvasRef, renderer)
  usePointerForward(wrapperRef, renderer)
  useHandle(ref, renderer, useTiltForward(renderer, tilt, respectReducedMotion))

  return (
    <div ref={wrapperRef} className={className} style={wrapperStyle(style)}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted={muted}
        loop={loop}
        autoPlay={autoPlay && (!respectReducedMotion || !reducedMotion)}
        playsInline={playsInline}
        style={fallbackStyle(ready)}
      />
      <canvas key={canvasKey} ref={canvasRef} aria-hidden style={canvasStyle} />
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

export const AsciiCanvas = forwardRef<AsciiHandle, AsciiCanvasProps>(
  function AsciiCanvas(props, ref) {
    const {
      source,
      renderMode = 'continuous',
      children,
      className,
      style,
      profile,
      backend,
      interaction,
      pauseWhenOffscreen = true,
      respectReducedMotion = true,
      tilt,
      onError,
      ...options
    } = props
    const wrapperRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const { renderer, canvasKey, error } = useAscii(canvasRef, {
      profile,
      backend,
      interaction,
      respectReducedMotion,
      ...options,
    })

    useEffect(() => {
      if (!renderer || !source) return
      renderer.setSource(source)
      renderer.render()
      return () => renderer.stop()
    }, [renderer, source])

    useContinuousPlayback(
      wrapperRef,
      renderer,
      Boolean(source) && renderMode === 'continuous',
      pauseWhenOffscreen,
      respectReducedMotion,
    )

    useErrorCallback(error, onError)
    useCanvasAutosize(canvasRef, renderer)
    usePointerForward(wrapperRef, renderer)
    useHandle(ref, renderer, useTiltForward(renderer, tilt, respectReducedMotion))

    return (
      <div ref={wrapperRef} className={className} style={wrapperStyle(style)}>
        {children}
        <canvas key={canvasKey} ref={canvasRef} aria-hidden style={canvasStyle} />
      </div>
    )
  },
)
