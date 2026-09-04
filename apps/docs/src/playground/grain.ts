// ASCII grain — a source-side effect, deliberately.
//
// The matcher is exact about the pixels it is handed and owns nothing upstream of that, so
// "make it noisy" is not a renderer option: it is a pass over the source, in the same
// category as the contrast curve you would put in front of a soft photograph. The whole
// point of running it here is that the playground's own source pipeline is where it goes,
// and the exported snippets say so too.
//
// One value per ASCII cell, and that is the interesting part. A cell samples
// `width / columns` source pixels across and fits ONE colour to the block, so a feature
// finer than a cell arrives as its share of the average rather than as itself: per-pixel
// grain on a 960-wide source at 120 columns is a very expensive way to shift the mean by
// nothing. Painting the noise at exactly cell granularity is what makes it read as glyph
// churn instead of as a faint haze.
//
// `exportSnippets.ts` emits a compact copy of this for the "export component" dialog —
// change the look here and change it there.

export interface GrainOptions {
  /** 0 = off. Scales the spread of the per-cell luma jitter. */
  amount: number
  /** Repaints per second. Glyph churn above ~15 stops reading as movement. */
  rate: number
}

export interface GrainSourceInfo {
  /** The picture the grain goes over. Anything drawImage accepts. */
  base: CanvasImageSource
  width: number
  height: number
  /** The ASCII grid, when the renderer has one — grain is painted one block per cell. */
  grid: { columns: number; rows: number } | null
}

/**
 * Multiply-and-screen the source against per-cell noise centred on mid-grey: above it
 * lightens, below it darkens, so the picture survives and its luma jitters. That jitter is
 * what moves a cell across a glyph boundary, which is the effect — not the haze.
 */
function paintGrain(
  ctx: CanvasRenderingContext2D,
  noise: HTMLCanvasElement,
  info: GrainSourceInfo,
  amount: number,
): void {
  const columns = info.grid?.columns ?? 120
  const rows = info.grid?.rows ?? Math.max(1, Math.round((columns * info.height) / info.width))
  if (noise.width !== columns || noise.height !== rows) {
    noise.width = columns
    noise.height = rows
  }
  const nctx = noise.getContext('2d')
  if (!nctx) return
  const image = nctx.createImageData(columns, rows)
  const spread = 255 * amount
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * spread
    image.data[i] = v
    image.data[i + 1] = v
    image.data[i + 2] = v
    image.data[i + 3] = 255
  }
  nctx.putImageData(image, 0, 0)

  ctx.save()
  // Nearest-neighbour on purpose: a smoothed block bleeds across the cell boundary it was
  // sized to sit inside, which is the one thing that would undo the point of the sizing.
  ctx.imageSmoothingEnabled = false
  ctx.globalCompositeOperation = 'overlay'
  ctx.drawImage(noise, 0, 0, info.width, info.height)
  ctx.restore()
}

export interface GrainStage {
  /** Feed this to the renderer instead of the bare source. */
  canvas: HTMLCanvasElement
  /** Draw base + grain, rate-limited. `force` ignores the rate (a still, a dial move). */
  paint(timeMs: number, force?: boolean): void
}

/**
 * A canvas that holds "the source, with grain on it".
 *
 * Everything is read through callbacks rather than captured, so changing the source, the
 * amount or the grid never means rebuilding the stage — the playground swaps sources under
 * it constantly.
 */
export function createGrainStage(read: {
  source: () => GrainSourceInfo | null
  options: () => GrainOptions
}): GrainStage {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const noise = document.createElement('canvas')
  let last = Number.NEGATIVE_INFINITY

  const paint = (timeMs: number, force = false): void => {
    const info = read.source()
    const { amount, rate } = read.options()
    if (!ctx || !info) return
    if (!force && timeMs - last < 1000 / Math.max(1, rate)) return
    last = timeMs
    if (canvas.width !== info.width || canvas.height !== info.height) {
      canvas.width = info.width
      canvas.height = info.height
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(info.base, 0, 0, canvas.width, canvas.height)
    if (amount > 0) paintGrain(ctx, noise, info, amount)
  }

  return { canvas, paint }
}
