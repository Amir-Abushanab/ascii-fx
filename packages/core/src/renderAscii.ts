import type { MatchOptions, RawImage } from './types.js'
import type { AsciiFrame } from './frame.js'
import { matchFrame } from './match.js'

export type AsciiSource =
  | RawImage
  | ImageData
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | HTMLVideoElement
  | VideoFrame

const isRawImage = (s: unknown): s is RawImage => {
  const r = s as RawImage
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    (r.data instanceof Uint8Array || r.data instanceof Uint8ClampedArray)
  )
}

async function normalizeSource(source: AsciiSource): Promise<RawImage> {
  if (isRawImage(source)) return source

  const hasDom = typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined'
  if (!hasDom) {
    throw new Error(
      'renderAscii received a DOM source but no DOM is available. ' +
        'In Node, pass raw RGBA pixels ({ width, height, data }) or ImageData.',
    )
  }

  if (
    typeof HTMLImageElement !== 'undefined' &&
    source instanceof HTMLImageElement &&
    !source.complete
  ) {
    await source.decode()
  }

  let width: number
  let height: number
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    width = source.naturalWidth
    height = source.naturalHeight
  } else if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    width = source.videoWidth
    height = source.videoHeight
  } else if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    width = source.displayWidth
    height = source.displayHeight
  } else {
    width = (source as HTMLCanvasElement).width
    height = (source as HTMLCanvasElement).height
  }
  if (!(width > 0) || !(height > 0)) {
    throw new Error('Source has zero dimensions; is the image/video loaded yet?')
  }

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Could not acquire a 2d context to read source pixels.')
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height)
  const img = ctx.getImageData(0, 0, width, height)
  return { width: img.width, height: img.height, data: img.data }
}

/**
 * The easiest path (spec §2): exact structural-v1 CPU matching of any source.
 * SSR-safe to import; DOM sources require a browser at call time.
 */
export async function renderAscii(source: AsciiSource, options: MatchOptions): Promise<AsciiFrame> {
  const raw = await normalizeSource(source)
  return matchFrame(raw, options)
}
