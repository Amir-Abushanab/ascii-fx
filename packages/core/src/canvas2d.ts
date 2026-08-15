import type { AsciiFrame } from './frame.js'
import type { CompositeOptions } from './composite.js'
import { compositeFrame } from './composite.js'

/**
 * Draw a frame into a 2D canvas at native atlas cell size. Browser-only at
 * call time (uses ImageData); safe to import during SSR.
 */
export function renderFrameToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  frame: AsciiFrame,
  options?: CompositeOptions,
): void {
  const img = compositeFrame(frame, options)
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Could not acquire a 2d context from the canvas.')
  const data = (
    img.data instanceof Uint8ClampedArray
      ? img.data
      : new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length)
  ) as Uint8ClampedArray<ArrayBuffer>
  ctx.putImageData(new ImageData(data, img.width, img.height), 0, 0)
}

export { compositeFrame }
export type { CompositeOptions }
