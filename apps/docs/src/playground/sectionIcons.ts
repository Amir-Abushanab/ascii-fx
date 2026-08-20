// Section headings get an ASCII icon — a real lucide pictogram rasterised and
// then run through the actual matcher on an 8×4 grid, so what you see is a
// genuine icon drawn by the pipeline this page documents. Change the font or
// narrow the charset up top and the icons are re-matched from the new profile.
import type { AsciiProfile, RawImage } from '@ascii-fx/core'
import { matchFrame } from '@ascii-fx/core'
import {
  Activity,
  Brush,
  Code,
  Gauge,
  Grid3x3,
  Layers,
  Palette,
  Scale,
  Search,
  Shrink,
  Sparkles,
  SquareDashed,
  TrendingDown,
  Type,
  Workflow,
  type IconNode,
} from 'lucide'

const COLS = 8
const ROWS = 4
/** Matcher samples per cell axis (ALGORITHM.md §5). */
const SAMPLES = 8
const W = COLS * SAMPLES
const H = ROWS * SAMPLES

// Matched against the heading text rather than its position, so reordering a
// section cannot silently shuffle the icons.
const ICONS: [RegExp, IconNode][] = [
  [/what is this/i, Sparkles],
  [/pipeline/i, Workflow],
  [/compile the font/i, Type],
  [/the grid/i, Grid3x3],
  [/shrink/i, Shrink],
  [/classify/i, Layers],
  [/source mask/i, SquareDashed],
  [/shortlist/i, Search],
  [/fit colors|winner/i, Palette],
  [/draw it/i, Brush],
  [/bit for bit/i, Scale],
  [/going faster/i, Gauge],
  [/cheaper matchers/i, TrendingDown],
  [/performance/i, Activity],
  [/using it/i, Code],
]

/** Lucide ships icons as node trees; turn one into a standalone SVG document. */
function toSvg(node: IconNode): string {
  const body = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v)}"`)
        .join(' ')
      return `<${tag} ${a}/>`
    })
    .join('')
  // preserveAspectRatio="none" stretches the square viewBox across the whole
  // sample buffer, which is wider than it is tall. The cell grid stretches it
  // back — cells are about twice as tall as they are wide — so the pictogram
  // comes out square on screen and fills the icon rather than sitting boxed
  // inside it. Strokes are heavier than lucide's default because a hairline
  // vanishes into the sampler before the matcher ever sees it.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${W}" height="${H}" ` +
    `preserveAspectRatio="none" fill="none" stroke="#fff" stroke-width="1.6" ` +
    `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  )
}

/** Rasterise once per icon; the result is reused across profile changes. */
async function rasterise(node: IconNode): Promise<RawImage> {
  const img = new Image(W, H)
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg(node))}`
  await img.decode()
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(img, 0, 0, W, H)
  return { width: W, height: H, data: ctx.getImageData(0, 0, W, H).data }
}

const rasters = new Map<IconNode, RawImage>()

/**
 * Put an icon on every section heading. Safe to call again when the profile
 * changes: rasters are cached, so only the (cheap) matching re-runs.
 */
export async function mountSectionIcons(profile: AsciiProfile): Promise<void> {
  for (const heading of document.querySelectorAll<HTMLElement>('#explainer h2')) {
    const existing = heading.querySelector<HTMLElement>('.hicon')
    // Read the heading without its own icon, or the glyphs would match the regex.
    const label = existing ? (heading.lastChild?.textContent ?? '') : (heading.textContent ?? '')
    const node = ICONS.find(([pattern]) => pattern.test(label))?.[1]
    if (!node) continue

    if (!rasters.has(node)) rasters.set(node, await rasterise(node))

    const el = existing ?? document.createElement('span')
    if (!existing) {
      el.className = 'hicon'
      // Decorative: the heading text already names the section.
      el.setAttribute('aria-hidden', 'true')
      heading.prepend(el)
    }
    el.textContent = matchFrame(rasters.get(node)!, {
      profile,
      columns: COLS,
      rows: ROWS,
      color: 'mono',
    }).toText()
  }
}
