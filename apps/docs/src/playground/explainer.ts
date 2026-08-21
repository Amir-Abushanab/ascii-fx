// Interactive explainer widgets. Each one runs the real algorithm from
// ALGORITHM.md against the currently loaded profile, so playing with them is
// playing with the actual matcher: paint a cell and watch the mask, the
// Hamming shortlist, and the exact rerank respond live. The pipeline and
// temporal widgets call the real core functions (deriveGrid, reduceSource,
// matchFrame, compositeFrame), not reimplementations.
import type { AsciiProfile, RawImage } from '@ascii-fx/core'
import {
  FLAG_FLAT,
  FLAG_TRANSPARENT,
  compositeFrame,
  deriveGrid,
  luma8,
  matchFrame,
  reduceSource,
} from '@ascii-fx/core'
import { Pause, Play, createElement, type IconNode } from 'lucide'
import { pointerUV } from './pointer'

/** createElement() does not add the .lucide class createIcons() would. */
const icon = (node: IconNode): SVGElement => {
  const svg = createElement(node)
  svg.classList.add('lucide')
  return svg
}

const FLAT_THRESHOLD = 15
const K = 8

// Painted tones (grayscale, value = luma): background, soft edge, ink.
// Light-on-dark, same as the mono white-on-black rendering above, so painting
// a stroke means painting the ink the matcher will try to reproduce. The soft
// tone (104) sits nearer the dark endpoint (26) than the bright one (234), so
// soft fringes classify as background: anti-aliasing does not fatten strokes.
const TONES = [26, 104, 234]
const TONE_CSS = ['#14141d', '#63636e', '#eaeaf2']

// Paint state survives font switches. Preloaded with a soft-edged steep
// diagonal in the x-height band, the stroke a monospace '/' actually draws.
const cell = new Uint8Array(64)
;[
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 1, 2, 1, 0],
  [0, 0, 0, 1, 2, 1, 0, 0],
  [0, 0, 1, 2, 1, 0, 0, 0],
  [0, 1, 2, 1, 0, 0, 0, 0],
  [0, 1, 2, 1, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0, 0],
].forEach((row, y) => row.forEach((v, x) => (cell[y * 8 + x] = v)))

const popcount = (v: number): number => {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function glyphImageData(p: AsciiProfile, id: number): ImageData {
  const a = p.atlas
  const sx = (id % a.columns) * a.pitchWidth + a.padding
  const sy = Math.floor(id / a.columns) * a.pitchHeight + a.padding
  const img = new ImageData(a.cellWidth, a.cellHeight)
  for (let y = 0; y < a.cellHeight; y++) {
    for (let x = 0; x < a.cellWidth; x++) {
      const o = (y * a.cellWidth + x) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255
      img.data[o + 3] = a.data[(sy + y) * a.width + sx + x]
    }
  }
  return img
}

function glyphCanvas(p: AsciiProfile, id: number, cssHeight: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = p.atlas.cellWidth
  cv.height = p.atlas.cellHeight
  cv.getContext('2d')!.putImageData(glyphImageData(p, id), 0, 0)
  cv.style.height = `${cssHeight}px`
  cv.style.width = `${Math.round((cssHeight * p.atlas.cellWidth) / p.atlas.cellHeight)}px`
  cv.className = 'wglyph'
  return cv
}

/**
 * An 8×8 sample grid. `aspect` is width/height of the thing the grid covers:
 * cells are not square (a 30×64 glyph cell is roughly 0.47), so a mask drawn
 * square would not line up with the glyph beside it. Pass 1 for grids that are
 * abstract rather than a picture of a real cell.
 */
function grid8Canvas(colorAt: (k: number) => string, cssHeight: number, aspect = 1): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = 8
  cv.height = 8
  const ctx = cv.getContext('2d')!
  for (let k = 0; k < 64; k++) {
    ctx.fillStyle = colorAt(k)
    ctx.fillRect(k % 8, Math.floor(k / 8), 1, 1)
  }
  cv.style.height = `${cssHeight}px`
  cv.style.width = `${Math.round(cssHeight * aspect)}px`
  cv.className = 'px'
  return cv
}

/** Width/height of one glyph cell — what every mask and sample grid covers. */
const cellAspect = (p: AsciiProfile): number => p.atlas.cellWidth / p.atlas.cellHeight

const label = (text: string): HTMLDivElement => {
  const d = document.createElement('div')
  d.className = 'wtitle'
  d.textContent = text
  return d
}

const col = (...children: (HTMLElement | string)[]): HTMLDivElement => {
  const d = document.createElement('div')
  d.className = 'wcol'
  d.append(...children)
  return d
}

// ————— widget 1: paint a cell, watch the matcher —————

interface MatchTrace {
  flat: boolean
  meanLuma: number
  maskBits?: Uint8Array
  candidates: { id: number; d: number; err: number }[]
  winner: number
}

/** The structural-v1 pipeline on the painted cell (mono, white on black). */
function runMatcher(p: AsciiProfile): MatchTrace {
  const lumas = Array.from(cell, (t) => TONES[t])
  let min = 256
  let max = -1
  let sum = 0
  for (const l of lumas) {
    if (l < min) min = l
    if (l > max) max = l
    sum += l
  }
  const meanLuma = Math.floor((2 * sum + 64) / 128) // rdiv(sum, 64)
  const { coverage, masksLo, masksHi } = p.structural

  if (max - min < FLAT_THRESHOLD) {
    // Flat: nearest coverage to meanLuma·257 (white ink ⇒ inkLight).
    const target = meanLuma * 257
    let winner = 0
    let bestDiff = Infinity
    for (let g = 0; g < p.glyphCount; g++) {
      const diff = Math.abs(coverage[g] - target)
      if (diff < bestDiff) {
        bestDiff = diff
        winner = g
      }
    }
    return { flat: true, meanLuma, candidates: [], winner }
  }

  // Mask: nearer endpoint by squared distance, tie ⇒ dark side (§7). Then
  // polarity (§8): white ink on black ⇒ bright side is ink ⇒ invert. The
  // widget stores and shows the post-polarity match mask (1 = ink), which is
  // what glyph masks are compared against.
  let srcLo = 0
  let srcHi = 0
  for (let k = 0; k < 64; k++) {
    const dd = (lumas[k] - min) ** 2
    const dl = (lumas[k] - max) ** 2
    if (dd <= dl) {
      if (k < 32) srcLo |= 1 << k
      else srcHi |= 1 << (k - 32)
    }
  }
  const mLo = ~srcLo >>> 0
  const mHi = ~srcHi >>> 0
  const maskBits = new Uint8Array(64)
  for (let k = 0; k < 64; k++) {
    maskBits[k] = k < 32 ? (mLo >>> k) & 1 : (mHi >>> (k - 32)) & 1
  }

  // Hamming shortlist, (score asc, id asc), insert after equal scores.
  const cands: { id: number; d: number; err: number }[] = []
  for (let g = 0; g < p.glyphCount; g++) {
    const d = popcount((mLo ^ masksLo[g]) >>> 0) + popcount((mHi ^ masksHi[g]) >>> 0)
    if (cands.length === K && d >= cands[K - 1].d) continue
    let at = cands.length
    while (at > 0 && cands[at - 1].d > d) at--
    cands.splice(at, 0, { id: g, d, err: 0 })
    if (cands.length > K) cands.pop()
  }

  // Exact rerank, mono: fg white, bg black. Grayscale ⇒ 3·(v−c)² per sample.
  let winner = cands[0].id
  let best = Infinity
  for (const c of cands) {
    const lo = masksLo[c.id]
    const hi = masksHi[c.id]
    let err = 0
    for (let k = 0; k < 64; k++) {
      const ink = k < 32 ? (lo >>> k) & 1 : (hi >>> (k - 32)) & 1
      const v = lumas[k]
      err += 3 * (ink ? (255 - v) ** 2 : v ** 2)
    }
    c.err = err
    if (err < best) {
      best = err
      winner = c.id
    }
  }
  return { flat: false, meanLuma, maskBits, candidates: cands, winner }
}

let paintValue = 2

function buildCellWidget(host: HTMLElement, p: AsciiProfile): void {
  host.replaceChildren()
  const out = document.createElement('div')
  out.className = 'wrow'

  // Paint grid.
  const grid = document.createElement('div')
  grid.className = 'pxgrid'
  const cells: HTMLDivElement[] = []
  const paint = (k: number, v: number): void => {
    cell[k] = v
    cells[k].style.background = TONE_CSS[v]
    update()
  }
  for (let k = 0; k < 64; k++) {
    const d = document.createElement('div')
    d.style.background = TONE_CSS[cell[k]]
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      paintValue = (cell[k] + 1) % 3
      paint(k, paintValue)
    })
    d.addEventListener('pointerenter', (e) => {
      if (e.buttons) paint(k, paintValue)
    })
    cells.push(d)
    grid.appendChild(d)
  }
  const tools = document.createElement('div')
  tools.className = 'wtools'
  const btn = (text: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.addEventListener('click', fn)
    return b
  }
  tools.append(
    btn('clear', () => {
      cell.fill(0)
      cells.forEach((c) => (c.style.background = TONE_CSS[0]))
      update()
    }),
    btn('invert', () => {
      for (let k = 0; k < 64; k++) {
        cell[k] = 2 - cell[k]
        cells[k].style.background = TONE_CSS[cell[k]]
      }
      update()
    }),
  )
  const gridCol = col(label('your cell · tap cycles, drag paints'), grid, tools)

  const maskCol = col(label('match mask · 1 = ink, from palette'))
  const listCol = col(label('shortlist · Hamming d, then exact err'))
  const winCol = col(label('winner'))
  out.append(gridCol, maskCol, listCol, winCol)
  host.appendChild(out)

  function update(): void {
    const t = runMatcher(p)

    maskCol.replaceChildren(label('match mask · 1 = ink, from palette'))
    if (t.flat) {
      const note = document.createElement('div')
      note.className = 'wnote'
      note.textContent = `contrast < ${FLAT_THRESHOLD}: flat cell. No mask, no shortlist. The glyph with coverage nearest mean luma ${t.meanLuma} wins directly.`
      maskCol.append(note)
    } else {
      maskCol.append(grid8Canvas((k) => (t.maskBits![k] ? '#45e845' : '#14141d'), 112))
    }

    listCol.replaceChildren(label('shortlist · Hamming d, then exact err'))
    if (!t.flat) {
      for (const c of t.candidates) {
        const row = document.createElement('div')
        row.className = 'cand' + (c.id === t.winner ? ' win' : '')
        const g = glyphCanvas(p, c.id, 22)
        const txt = document.createElement('span')
        txt.textContent = `d = ${String(c.d).padStart(2)}   err = ${c.err.toLocaleString('en-US')}`
        row.append(g, txt)
        listCol.append(row)
      }
    }

    winCol.replaceChildren(label('winner'))
    winCol.append(glyphCanvas(p, t.winner, 88))
    const ch = document.createElement('div')
    ch.className = 'wnote'
    ch.textContent = `'${p.glyphs[t.winner]}' · glyph ${t.winner}${t.flat ? ' · flat path' : ''}`
    winCol.append(ch)
    if (!t.flat) {
      const lo = p.structural.masksLo[t.winner]
      const hi = p.structural.masksHi[t.winner]
      const compare = document.createElement('div')
      compare.className = 'wpair'
      compare.append(
        col(label('cell'), grid8Canvas((k) => TONE_CSS[cell[k]], 56)),
        col(
          label('recon'),
          grid8Canvas((k) => {
            const ink = k < 32 ? (lo >>> k) & 1 : (hi >>> (k - 32)) & 1
            return ink ? '#eaeaf2' : '#0a0a10'
          }, 56),
        ),
      )
      winCol.append(compare)
    }
  }
  update()
}

// ————— widget 2: the flat ramp, live —————

function buildFlatWidget(host: HTMLElement, p: AsciiProfile): void {
  host.replaceChildren()
  const { coverage } = p.structural
  const nearest = (luma: number): number => {
    const target = luma * 257
    let win = 0
    let best = Infinity
    for (let g = 0; g < p.glyphCount; g++) {
      const diff = Math.abs(coverage[g] - target)
      if (diff < best) {
        best = diff
        win = g
      }
    }
    return win
  }

  const row = document.createElement('div')
  row.className = 'wrow'
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '0'
  slider.max = '255'
  slider.value = '96'
  slider.style.width = '180px'
  const readout = document.createElement('div')
  readout.className = 'wnote'
  const preview = col(label('glyph'))
  const ramp = document.createElement('div')
  ramp.className = 'wramp'
  const marks = Array.from({ length: 32 }, (_, i) => nearest(Math.round((i * 255) / 31)))
  ramp.textContent = marks.map((g) => p.glyphs[g]).join('')

  const update = (): void => {
    const luma = Number(slider.value)
    const g = nearest(luma)
    preview.replaceChildren(label('glyph'), glyphCanvas(p, g, 72))
    readout.textContent = `mean luma ${luma} → target ${luma * 257} → '${p.glyphs[g]}' (coverage ${((coverage[g] / 65535) * 100).toFixed(1)}%)`
  }
  slider.addEventListener('input', update)
  row.append(col(label('mean luma of a flat cell'), slider, readout, ramp), preview)
  host.appendChild(row)
  update()
}

// ————— widget 3: the compiled glyph set —————

const ATLAS_MAX = 128

function buildAtlasWidget(host: HTMLElement, p: AsciiProfile): void {
  host.replaceChildren()
  const shown = Math.min(p.glyphCount, ATLAS_MAX)
  const perRow = 16
  const rows = Math.ceil(shown / perRow)
  const cw = p.atlas.cellWidth
  const ch = p.atlas.cellHeight
  const cv = document.createElement('canvas')
  cv.width = perRow * cw
  cv.height = rows * ch
  const ctx = cv.getContext('2d')!
  // Compose the whole sheet as one ImageData, then upload it once.
  //
  // Writing a single tile canvas and drawImage-ing it once per glyph relies on
  // every draw snapshotting the source immediately. Engines that defer canvas
  // work — a GPU-backed webview, for instance — can sample that tile after
  // later writes, so runs of cells receive whichever glyph it happened to hold
  // at flush time, and everything after the final write shows the last glyph.
  const sheet = ctx.createImageData(cv.width, cv.height)
  const src = p.atlas
  for (let g = 0; g < shown; g++) {
    const dx = (g % perRow) * cw
    const dy = Math.floor(g / perRow) * ch
    const sx = (g % src.columns) * src.pitchWidth + src.padding
    const sy = Math.floor(g / src.columns) * src.pitchHeight + src.padding
    for (let y = 0; y < ch; y++) {
      let o = ((dy + y) * cv.width + dx) * 4
      let i = (sy + y) * src.width + sx
      for (let x = 0; x < cw; x++, o += 4, i++) {
        sheet.data[o] = 255
        sheet.data[o + 1] = 255
        sheet.data[o + 2] = 255
        sheet.data[o + 3] = src.data[i]
      }
    }
  }
  ctx.putImageData(sheet, 0, 0)
  const scale = Math.min(0.55, 480 / cv.width)
  cv.style.width = `${Math.round(cv.width * scale)}px`
  cv.className = 'watlas'

  const inspector = col(label('hover / tap a glyph'))
  const inspect = (g: number): void => {
    const lo = p.structural.masksLo[g]
    const hi = p.structural.masksHi[g]
    const info = document.createElement('div')
    info.className = 'wnote'
    info.textContent = `'${p.glyphs[g]}' · glyph ${g} · coverage ${((p.structural.coverage[g] / 65535) * 100).toFixed(1)}%`
    inspector.replaceChildren(
      label('glyph · its 8×8 mask'),
      (() => {
        const pair = document.createElement('div')
        pair.className = 'wpair'
        pair.append(
          glyphCanvas(p, g, 72),
          grid8Canvas(
            (k) => {
              const ink = k < 32 ? (lo >>> k) & 1 : (hi >>> (k - 32)) & 1
              return ink ? '#eaeaf2' : '#14141d'
            },
            72,
            cellAspect(p),
          ),
        )
        return pair
      })(),
      info,
    )
  }
  const pick = (e: PointerEvent): void => {
    const [u, v] = pointerUV(e, cv)
    const gx = Math.floor(u * perRow)
    const gy = Math.floor(v * rows)
    if (gx < 0 || gx >= perRow || gy < 0 || gy >= rows) return
    const g = gy * perRow + gx
    if (g >= 0 && g < shown) inspect(g)
  }
  cv.addEventListener('pointermove', pick)
  cv.addEventListener('pointerdown', pick)

  const row = document.createElement('div')
  row.className = 'wrow'
  row.append(col(label(`every glyph the matcher knows${p.glyphCount > shown ? ` (first ${shown} of ${p.glyphCount})` : ''}`), cv), inspector)
  host.appendChild(row)
  inspect(Math.max(0, p.glyphs.indexOf('@')))
}

// ————— widget 4: the pipeline, end to end —————

/** Mini sunset scene exercising all three cell classes: a fully transparent
 * band on the left, a smooth gradient sky (flat cells), and a sun, mountains,
 * and reflection (structure). */
function drawPipelineScene(): RawImage {
  const W = 240
  const H = 120
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const c = cv.getContext('2d')!
  const L = 44 // everything left of this stays transparent
  const sky = c.createLinearGradient(0, 0, 0, 92)
  sky.addColorStop(0, '#1c2a6b')
  sky.addColorStop(0.55, '#8f3a7a')
  sky.addColorStop(1, '#e2903a')
  c.fillStyle = sky
  c.fillRect(L, 0, W - L, 92)
  // Sun with a hard rim, half-set behind the water line.
  c.fillStyle = '#ffd98a'
  c.beginPath()
  c.arc(150, 66, 24, 0, Math.PI * 2)
  c.fill()
  // Water with a shimmering reflection column.
  c.fillStyle = '#141a3a'
  c.fillRect(L, 92, W - L, H - 92)
  c.fillStyle = '#f0b45e'
  for (let y = 94; y < H; y += 6) c.fillRect(150 - (y - 88) / 2, y, y - 88, 2.5)
  // Mountain silhouettes: long diagonals for the structural matcher.
  c.fillStyle = '#10131f'
  c.beginPath()
  c.moveTo(L, 92)
  c.lineTo(96, 30)
  c.lineTo(148, 92)
  c.closePath()
  c.fill()
  c.beginPath()
  c.moveTo(176, 92)
  c.lineTo(216, 46)
  c.lineTo(W, 92)
  c.lineTo(W, 92)
  c.closePath()
  c.fill()
  // A bird ✓-stroke in the sky.
  c.strokeStyle = '#10131f'
  c.lineWidth = 3
  c.beginPath()
  c.moveTo(112, 22)
  c.lineTo(122, 30)
  c.lineTo(132, 22)
  c.stroke()
  const img = c.getImageData(0, 0, W, H)
  return { width: W, height: H, data: img.data }
}

const checker = (ctx: CanvasRenderingContext2D, w: number, h: number, s: number): void => {
  ctx.fillStyle = '#101018'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#191925'
  for (let y = 0; y < Math.ceil(h / s); y++) {
    for (let x = 0; x < Math.ceil(w / s); x++) {
      if ((x + y) % 2) ctx.fillRect(x * s, y * s, s, s)
    }
  }
}

interface CellDetail {
  cls: 'transparent' | 'flat' | 'structured'
  meanAlpha: number
  meanLuma: number
  deltaLuma: number
  mask?: Uint8Array
}

/** §5–§8 per-cell facts, recomputed from the real reduced buffer. */
function cellDetail(reduced: Uint8Array, columns: number, cx: number, cy: number): CellDetail {
  const SW = columns * 8
  let minL = 256
  let maxL = -1
  let minIdx = 0
  let maxIdx = 0
  let sumL = 0
  let sumA = 0
  const rgb = new Uint8Array(64 * 3)
  const lum = new Uint8Array(64)
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const k = j * 8 + i
      const o = ((cy * 8 + j) * SW + cx * 8 + i) * 4
      const r = reduced[o]
      const g = reduced[o + 1]
      const b = reduced[o + 2]
      rgb[k * 3] = r
      rgb[k * 3 + 1] = g
      rgb[k * 3 + 2] = b
      const l = luma8(r, g, b)
      lum[k] = l
      sumL += l
      sumA += reduced[o + 3]
      if (l < minL) {
        minL = l
        minIdx = k
      }
      if (l > maxL) {
        maxL = l
        maxIdx = k
      }
    }
  }
  const meanAlpha = Math.floor((2 * sumA + 64) / 128)
  const meanLuma = Math.floor((2 * sumL + 64) / 128)
  if (meanAlpha < 128) return { cls: 'transparent', meanAlpha, meanLuma, deltaLuma: maxL - minL }
  if (maxL - minL < FLAT_THRESHOLD) return { cls: 'flat', meanAlpha, meanLuma, deltaLuma: maxL - minL }
  // §7 endpoint classification + §8 polarity (foreground mode, black backdrop
  // ⇒ inkLight ⇒ invert): mask shows 1 = ink.
  const mask = new Uint8Array(64)
  for (let k = 0; k < 64; k++) {
    const dd =
      (rgb[k * 3] - rgb[minIdx * 3]) ** 2 + (rgb[k * 3 + 1] - rgb[minIdx * 3 + 1]) ** 2 + (rgb[k * 3 + 2] - rgb[minIdx * 3 + 2]) ** 2
    const dl =
      (rgb[k * 3] - rgb[maxIdx * 3]) ** 2 + (rgb[k * 3 + 1] - rgb[maxIdx * 3 + 1]) ** 2 + (rgb[k * 3 + 2] - rgb[maxIdx * 3 + 2]) ** 2
    mask[k] = dd <= dl ? 0 : 1
  }
  return { cls: 'structured', meanAlpha, meanLuma, deltaLuma: maxL - minL, mask }
}

const CLASS_CSS: Record<CellDetail['cls'], string> = {
  transparent: '#3a3a4a',
  flat: '#3d5bb5',
  structured: '#d98a3d',
}

function buildPipelineWidget(host: HTMLElement, p: AsciiProfile): void {
  host.replaceChildren()
  const scene = drawPipelineScene()

  const stagesRow = document.createElement('div')
  stagesRow.className = 'wrow wstages'
  const detail = document.createElement('div')
  detail.className = 'wdetail'
  const readout = document.createElement('div')
  readout.className = 'wnote'
  readout.style.maxWidth = 'none'

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '8'
  slider.max = '64'
  slider.step = '1'
  slider.value = '28'
  slider.style.width = '160px'
  const sliderRow = document.createElement('div')
  sliderRow.className = 'wtools'
  const sliderLabel = document.createElement('span')
  sliderLabel.className = 'wnote'
  sliderLabel.textContent = 'columns'
  sliderRow.append(sliderLabel, slider, readout)

  host.append(sliderRow, stagesRow, detail)

  interface Stage {
    name: string
    wrap: HTMLDivElement
    canvas: HTMLCanvasElement
    outline: HTMLDivElement
  }
  const mkStage = (name: string): Stage => {
    const wrap = document.createElement('div')
    wrap.className = 'wstage'
    const canvas = document.createElement('canvas')
    const outline = document.createElement('div')
    outline.className = 'wcellmark'
    const inner = document.createElement('div')
    inner.className = 'wstagebox'
    inner.append(canvas, outline)
    wrap.append(label(name), inner)
    return { name, wrap, canvas, outline }
  }
  const stages = [mkStage('1 · source'), mkStage('2 · reduce'), mkStage('3 · classify'), mkStage('4 · match + draw')]
  for (const s of stages) stagesRow.append(s.wrap)

  let columns = 16
  let rows = 8
  let reduced: Uint8Array

  const render = (): void => {
    columns = Number(slider.value)
    const grid = deriveGrid(scene.width, scene.height, p, columns)
    rows = grid.rows
    reduced = reduceSource(scene, columns, rows, false)
    const frame = matchFrame(scene, { profile: p, columns, rows, color: 'foreground', alpha: 'mask' })
    const SW = columns * 8
    const SH = rows * 8

    // 1 · source over a checkerboard (so transparency is visible).
    {
      const cv = stages[0].canvas
      cv.width = scene.width
      cv.height = scene.height
      const c = cv.getContext('2d')!
      checker(c, cv.width, cv.height, 8)
      const tmp = document.createElement('canvas')
      tmp.width = scene.width
      tmp.height = scene.height
      tmp
        .getContext('2d')!
        .putImageData(new ImageData(scene.data as Uint8ClampedArray<ArrayBuffer>, scene.width, scene.height), 0, 0)
      c.drawImage(tmp, 0, 0)
    }
    // 2 · the reduced 8C×8R samples, nearest-neighbor.
    {
      const cv = stages[1].canvas
      cv.width = SW
      cv.height = SH
      const c = cv.getContext('2d')!
      checker(c, SW, SH, 4)
      const tmp = document.createElement('canvas')
      tmp.width = SW
      tmp.height = SH
      const img = new ImageData(SW, SH)
      img.data.set(reduced)
      tmp.getContext('2d')!.putImageData(img, 0, 0)
      c.drawImage(tmp, 0, 0)
    }
    // 3 · per-cell class.
    {
      const cv = stages[2].canvas
      cv.width = columns * 4
      cv.height = rows * 4
      const c = cv.getContext('2d')!
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < columns; cx++) {
          const f = frame.flags[cy * columns + cx]
          const cls = f & FLAG_TRANSPARENT ? 'transparent' : f & FLAG_FLAT ? 'flat' : 'structured'
          c.fillStyle = CLASS_CSS[cls]
          c.fillRect(cx * 4, cy * 4, 4, 4)
        }
      }
    }
    // 4 · the real composite.
    {
      const img = compositeFrame(frame)
      const cv = stages[3].canvas
      cv.width = img.width
      cv.height = img.height
      const c = cv.getContext('2d')!
      checker(c, img.width, img.height, Math.round(img.width / 30))
      const tmp = document.createElement('canvas')
      tmp.width = img.width
      tmp.height = img.height
      const data = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length)
      tmp.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
      c.drawImage(tmp, 0, 0)
    }
    readout.textContent = `${columns} cols → rows = rdiv(${scene.height}·${columns}·${p.atlas.cellWidth}, ${scene.width}·${p.atlas.cellHeight}) = ${rows} · ${columns * rows} cells`

    inspect(lastCell ? Math.min(lastCell[0], columns - 1) : Math.round(columns * 0.63), lastCell ? Math.min(lastCell[1], rows - 1) : Math.round(rows * 0.38), frame)
  }

  let lastCell: [number, number] | null = null
  let lastFrame: ReturnType<typeof matchFrame>

  function inspect(cx: number, cy: number, frame?: ReturnType<typeof matchFrame>): void {
    lastCell = [cx, cy]
    if (frame) lastFrame = frame
    const fr = lastFrame
    for (const s of stages) {
      s.outline.style.left = `${(cx / columns) * 100}%`
      s.outline.style.top = `${(cy / rows) * 100}%`
      s.outline.style.width = `${100 / columns}%`
      s.outline.style.height = `${100 / rows}%`
    }
    const d = cellDetail(reduced, columns, cx, cy)
    const SW = columns * 8
    const zoom = grid8Canvas(
      (k) => {
        const o = ((cy * 8 + (k >> 3)) * SW + cx * 8 + (k % 8)) * 4
        return `rgba(${reduced[o]},${reduced[o + 1]},${reduced[o + 2]},${reduced[o + 3] / 255})`
      },
      88,
      cellAspect(p),
    )
    const parts: HTMLElement[] = [col(label(`cell (${cx}, ${cy}) · its 64 samples`), zoom)]
    const clsNote = document.createElement('div')
    clsNote.className = 'wnote'
    if (d.cls === 'transparent') {
      clsNote.textContent = `mean alpha ${d.meanAlpha} < 128 → transparent. Blank glyph, zero colors, done.`
      parts.push(col(label('classify'), clsNote))
    } else if (d.cls === 'flat') {
      clsNote.textContent = `Δluma ${d.deltaLuma} < ${FLAT_THRESHOLD} → flat. Coverage nearest mean luma ${d.meanLuma} picks the glyph; fitted color = the cell mean.`
      parts.push(col(label('classify'), clsNote))
    } else {
      clsNote.textContent = `Δluma ${d.deltaLuma} ≥ ${FLAT_THRESHOLD} → structured`
      parts.push(
        col(label('classify'), clsNote),
        col(label('mask · 1 = ink'), grid8Canvas((k) => (d.mask![k] ? '#45e845' : '#14141d'), 88, cellAspect(p))),
      )
    }
    const ci = cy * columns + cx
    const gid = fr.glyphIds[ci]
    const fgWord = fr.foreground?.[ci] ?? 0xffffffff
    const sw = document.createElement('span')
    sw.className = 'wswatch'
    sw.style.background = `rgb(${fgWord & 0xff},${(fgWord >> 8) & 0xff},${(fgWord >> 16) & 0xff})`
    const winNote = document.createElement('div')
    winNote.className = 'wnote'
    winNote.append(`'${p.glyphs[gid]}' · glyph ${gid} · fitted `, sw)
    parts.push(col(label('winner'), glyphCanvas(p, gid, 64), winNote))
    detail.replaceChildren(...parts)
  }

  for (const s of stages) {
    // Bound to the canvas rather than its wrapper: pointerUV reads offsets
    // relative to the event target, and the cell marker over it is
    // pointer-events:none, so the canvas is the only thing that can be hit.
    s.canvas.addEventListener('pointermove', (e) => {
      const [u, v] = pointerUV(e, s.canvas)
      const cx = Math.max(0, Math.min(columns - 1, Math.floor(u * columns)))
      const cy = Math.max(0, Math.min(rows - 1, Math.floor(v * rows)))
      inspect(cx, cy)
    })
  }
  slider.addEventListener('input', render)
  render()
}

// ————— widget 5: temporal reuse —————

let temporalStop: (() => void) | null = null

function buildTemporalWidget(host: HTMLElement, p: AsciiProfile): void {
  temporalStop?.()
  host.replaceChildren()
  const W = 240
  const H = 96
  const columns = 20
  const rows = deriveGrid(W, H, p, columns).rows

  const sceneCv = document.createElement('canvas')
  sceneCv.width = W
  sceneCv.height = H
  const sc = sceneCv.getContext('2d', { willReadFrequently: true })!
  const drawScene = (t: number): RawImage => {
    const g = sc.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, '#1c2350')
    g.addColorStop(1, '#4b2a6e')
    sc.fillStyle = g
    sc.fillRect(0, 0, W, H)
    sc.fillStyle = '#2ee66b'
    sc.fillRect(14, 14, 40, 68)
    sc.fillStyle = '#e2903a'
    sc.fillRect(196, 22, 30, 52)
    const x = 70 + ((Math.sin(t / 900) + 1) / 2) * 100
    const y = 48 + Math.sin(t / 411) * 22
    sc.fillStyle = '#f4f0e6'
    sc.beginPath()
    sc.arc(x, y, 13, 0, Math.PI * 2)
    sc.fill()
    const img = sc.getImageData(0, 0, W, H)
    return { width: W, height: H, data: img.data }
  }

  const view = document.createElement('canvas')
  view.className = 'wtemporal'
  const counter = document.createElement('div')
  counter.className = 'wnote'
  counter.style.maxWidth = 'none'
  const play = document.createElement('button')
  play.type = 'button'
  play.setAttribute('aria-label', 'pause')
  play.append(icon(Pause))
  const tools = document.createElement('div')
  tools.className = 'wtools'
  tools.append(play, counter)
  host.append(view, tools)

  let prevReduced: Uint8Array | null = null
  let running = true
  let raf = 0
  let last = 0
  let composited: RawImage | undefined

  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick)
    if (!running || now - last < 260) return
    last = now
    const scene = drawScene(now)
    const reduced = reduceSource(scene, columns, rows, false)
    // The engine's temporal rule (§ Going faster): a cell whose 8×8×RGBA
    // block is byte-identical to last frame reuses its previous result.
    const changed = new Uint8Array(columns * rows)
    let changedCount = columns * rows
    if (prevReduced) {
      changedCount = 0
      const rowBytes = columns * 8 * 4
      for (let ci = 0; ci < columns * rows; ci++) {
        const cx = ci % columns
        const cy = (ci / columns) | 0
        let same = true
        outer: for (let j = 0; j < 8; j++) {
          const o = (cy * 8 + j) * rowBytes + cx * 8 * 4
          for (let b = 0; b < 32; b++) {
            if (reduced[o + b] !== prevReduced[o + b]) {
              same = false
              break outer
            }
          }
        }
        if (!same) {
          changed[ci] = 1
          changedCount++
        }
      }
    } else {
      changed.fill(1)
    }
    prevReduced = reduced

    const frame = matchFrame(scene, { profile: p, columns, rows, color: 'foreground', alpha: 'ignore' })
    composited = compositeFrame(frame, {}, composited)
    const img = composited
    view.width = img.width
    view.height = img.height
    const c = view.getContext('2d')!
    const data = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length)
    c.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
    const cw = img.width / columns
    const ch = img.height / rows
    c.fillStyle = 'rgba(248, 113, 113, 0.28)'
    c.strokeStyle = 'rgba(248, 113, 113, 0.7)'
    for (let ci = 0; ci < changed.length; ci++) {
      if (!changed[ci]) continue
      c.fillRect((ci % columns) * cw, ((ci / columns) | 0) * ch, cw, ch)
      c.strokeRect((ci % columns) * cw + 0.5, ((ci / columns) | 0) * ch + 0.5, cw - 1, ch - 1)
    }
    const total = columns * rows
    counter.textContent = `re-matched ${changedCount} / ${total} cells · ${(((total - changedCount) / total) * 100).toFixed(0)}% reused`
  }
  raf = requestAnimationFrame(tick)
  play.addEventListener('click', () => {
    running = !running
    play.setAttribute('aria-label', running ? 'pause' : 'play')
    play.replaceChildren(icon(running ? Pause : Play))
  })
  temporalStop = () => cancelAnimationFrame(raf)
}

// ————— entry —————

export function refreshExplainer(profile: AsciiProfile): void {
  const mounts: Record<string, (host: HTMLElement, p: AsciiProfile) => void> = {
    wCell: buildCellWidget,
    wFlat: buildFlatWidget,
    wAtlas: buildAtlasWidget,
    wPipe: buildPipelineWidget,
    wTemporal: buildTemporalWidget,
  }
  for (const [id, build] of Object.entries(mounts)) {
    const host = document.getElementById(id)
    if (host) build(host, profile)
  }
}
