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
  Package,
  Palette,
  Scale,
  Scissors,
  Search,
  Shrink,
  Sparkles,
  SquareDashed,
  TrendingDown,
  Type,
  Workflow,
  type IconNode,
} from 'lucide'

// Brand marks for the usage sections. lucide has no logos, so these are hand
// authored in the same [tag, attrs] shape its icons use, which means they go
// through the identical rasterise-then-match path — a React logo drawn by the
// matcher this page documents, not an <img>.
const ReactMark: IconNode = [
  ['circle', { cx: 12, cy: 12, r: 2.2, fill: '#fff', stroke: 'none' }],
  ['ellipse', { cx: 12, cy: 12, rx: 10.6, ry: 4.1 }],
  ['ellipse', { cx: 12, cy: 12, rx: 10.6, ry: 4.1, transform: 'rotate(60 12 12)' }],
  ['ellipse', { cx: 12, cy: 12, rx: 10.6, ry: 4.1, transform: 'rotate(120 12 12)' }],
]

// Knocked out of a filled tile rather than stroked on an empty one: an outline
// with hairline letters reduces to a faint box at 8x4, where a solid field with
// dark letters keeps a difference the matcher can actually see.
const TypeScriptMark: IconNode = [
  ['rect', { x: 1.5, y: 1.5, width: 21, height: 21, rx: 3, fill: '#fff', stroke: 'none' }],
  ['rect', { x: 3.6, y: 9.4, width: 9.2, height: 3.4, fill: '#000', stroke: 'none' }],
  ['rect', { x: 6.5, y: 9.4, width: 3.4, height: 10.8, fill: '#000', stroke: 'none' }],
  ['path', {
    d: 'M20.4 11.2c-1.6-1.2-4.6-.9-4.6 1s4.6 1.3 4.6 3.7-3 2.3-4.7 1.1',
    stroke: '#000',
    'stroke-width': 2.8,
    fill: 'none',
  }],
]

const ThreeMark: IconNode = [
  ['path', { d: 'M12 2.6 21.6 21.2 2.4 21.2Z' }],
  ['path', { d: 'M12 2.6 15.4 21.2' }],
]

const COLS = 8
const ROWS = 4
/** Matcher samples per cell axis (ALGORITHM.md §5). */
const SAMPLES = 8
const W = COLS * SAMPLES
const H = ROWS * SAMPLES

// Matched against the heading text rather than its position, so reordering a
// section cannot silently shuffle the icons. The third column is what the
// heading wears in Emoji mode: a whole emoji says the same thing in one cell
// that the 8x4 ASCII block says in thirty-two, and re-matching a pictogram into
// emoji would just produce a coloured smudge at this size.
const ICONS: [RegExp, IconNode, string][] = [
  [/what is this/i, Sparkles, '✨'],
  [/pipeline/i, Workflow, '🔧'],
  [/compile the font/i, Type, '🔤'],
  [/the grid/i, Grid3x3, '🔳'],
  [/shrink/i, Shrink, '🗜️'],
  [/classify/i, Layers, '🗂️'],
  [/source mask/i, SquareDashed, '🎭'],
  [/shortlist/i, Search, '🔍'],
  [/fit colors|winner/i, Palette, '🎨'],
  [/draw it/i, Brush, '🖌️'],
  [/bit for bit/i, Scale, '⚖️'],
  [/going faster/i, Gauge, '🚀'],
  [/cheaper matchers/i, TrendingDown, '📉'],
  [/performance/i, Activity, '📈'],
  [/using it/i, Code, '💻'],
]

// Sub-sections, matched the same way. The third column is the Emoji-mode face.
const SUB_ICONS: [RegExp, IconNode, string][] = [
  [/^react$/i, ReactMark, '⚛️'],
  [/three\.?js/i, ThreeMark, '🔺'],
  // The framework-agnostic entry point, so the language mark rather than a logo.
  [/anything else/i, TypeScriptMark, '📘'],
  // A profile is compiled up front and shipped as a small binary.
  [/ahead-of-time/i, Package, '📦'],
  // Subsetting cuts glyphs out of a profile that already exists.
  [/narrowing/i, Scissors, '✂️'],
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
export async function mountSectionIcons(profile: AsciiProfile, emojiMode = false): Promise<void> {
  for (const heading of document.querySelectorAll<HTMLElement>('#explainer h2, #explainer h3')) {
    const existing = heading.querySelector<HTMLElement>('.hicon')
    // Read the heading without its own icon, or the glyphs would match the regex.
    const label = (existing ? (heading.lastChild?.textContent ?? '') : (heading.textContent ?? '')).trim()
    const table = heading.tagName === 'H3' ? SUB_ICONS : ICONS
    const entry = table.find(([pattern]) => pattern.test(label))
    if (!entry) continue
    const [, node, emoji] = entry

    if (!emojiMode && !rasters.has(node)) rasters.set(node, await rasterise(node))

    const el = existing ?? document.createElement('span')
    if (!existing) {
      el.className = 'hicon'
      // Decorative: the heading text already names the section.
      el.setAttribute('aria-hidden', 'true')
      heading.prepend(el)
    }
    el.classList.toggle('hicon-emoji', emojiMode)
    el.textContent = emojiMode
      ? emoji
      : matchFrame(rasters.get(node)!, { profile, columns: COLS, rows: ROWS, color: 'mono' }).toText()
  }
}
