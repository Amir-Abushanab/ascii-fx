// Glyph picker for the live view.
//
// chromatic-v1 searches every glyph it is given and takes the lowest error, so
// flat colour swatches win constantly: a solid tile is the best possible
// reconstruction of a flat cell, and emoji sets are full of them (the skin-tone
// modifiers 🏻🏼🏽🏾🏿 render as plain squares, and ⚫️🟦🟥 are literally squares).
// That is the objective working correctly and looking dull. Removing a glyph is
// the only way to stop the matcher reaching for it, which is what this does —
// it trades reconstruction error for recognisable emoji, deliberately.
//
// Swatches are drawn from the profile's own RGBA atlas rather than from
// fillText, so what you pick is what will actually be drawn.

import type { AsciiProfile } from '@ascii-fx/core'
import { idiv } from '@ascii-fx/core'


export interface PickerHandles {
  /** Currently selected graphemes, in profile order. */
  selection: () => string[]
  destroy: () => void
}

export interface PickerOptions {
  profile: AsciiProfile
  /** Selected on mount. Everything is selected when omitted. */
  initial?: (glyph: string, id: number) => boolean
  /** Restored by the "Default" action; falls back to `initial` when omitted. */
  defaultSelection?: ReadonlySet<string>
  onChange: (selected: string[]) => void
}

/**
 * How much like a solid colour swatch a glyph is, on 0..1.
 *
 * This is what actually drives the matcher's taste for boring glyphs: a cell
 * with little internal variation is best reconstructed by a glyph with little
 * internal variation, and emoji sets are full of them. Opacity is the wrong
 * proxy — a Noto tile never fills its cell edge to edge, so no glyph is ever
 * ~100% opaque — so this measures flatness of the descriptor the matcher
 * actually compares against, scaled by coverage so a mostly-transparent glyph
 * does not read as "flat" merely for being empty.
 */
function flatness(profile: AsciiProfile, id: number): number {
  const samples = profile.chromatic?.samples
  if (!samples) return 0
  let sr = 0
  let sg = 0
  let sb = 0
  let sa = 0
  for (let k = 0; k < 64; k++) {
    const p = id * 256 + k * 4
    sr += samples[p]
    sg += samples[p + 1]
    sb += samples[p + 2]
    sa += samples[p + 3]
  }
  const mr = sr / 64
  const mg = sg / 64
  const mb = sb / 64
  let variance = 0
  for (let k = 0; k < 64; k++) {
    const p = id * 256 + k * 4
    variance += (samples[p] - mr) ** 2 + (samples[p + 1] - mg) ** 2 + (samples[p + 2] - mb) ** 2
  }
  // 3 * 128^2 is the variance of a maximally split tile; anything past it is 0.
  const spread = Math.min(1, variance / 64 / (3 * 128 ** 2))
  return (1 - spread) * (sa / 64 / 255)
}

/**
 * The whole RGBA atlas as one object URL, used as a shared CSS sprite sheet.
 * A canvas per glyph would mean 1300+ GPU-backed surfaces; this is one image
 * and a background-position per cell.
 */
function atlasSpriteUrl(profile: AsciiProfile): string | null {
  const { atlas } = profile
  if (!atlas.rgba) return null
  const canvas = document.createElement('canvas')
  canvas.width = atlas.width
  canvas.height = atlas.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(atlas.rgba), atlas.width, atlas.height), 0, 0)
  return canvas.toDataURL()
}

export function mountPicker(host: HTMLElement, options: PickerOptions): PickerHandles {
  const { profile } = options
  const n = profile.glyphCount
  const selected = new Uint8Array(n)
  for (let i = 0; i < n; i++) selected[i] = options.initial ? (options.initial(profile.glyphs[i], i) ? 1 : 0) : 1
  const flat = Array.from({ length: n }, (_, i) => flatness(profile, i))

  const grid = document.createElement('div')
  grid.className = 'glyph-grid'
  const cells: HTMLButtonElement[] = []
  const sprite = atlasSpriteUrl(profile)
  const { atlas } = profile
  // Cells are laid out at a fixed size; the sheet is scaled to match so a tile
  // lands exactly inside one cell.
  const DISPLAY = 30
  const scale = DISPLAY / atlas.cellWidth

  const syncCell = (i: number): void => {
    cells[i].classList.toggle('on', selected[i] === 1)
    cells[i].setAttribute('aria-pressed', selected[i] ? 'true' : 'false')
  }

  const currentSelection = (): string[] => {
    const list: string[] = []
    for (let i = 0; i < n; i++) if (selected[i]) list.push(profile.glyphs[i])
    return list
  }

  const count = document.createElement('span')
  count.className = 'glyph-count'
  const emit = (): void => {
    const list = currentSelection()
    count.textContent = `${list.length} / ${n} selected`
    options.onChange(list)
  }

  // Drag-to-paint: the value is decided by the cell the drag starts on, so a
  // drag either only selects or only deselects. Toggling per cell instead would
  // flip anything the pointer grazed twice.
  let painting: 0 | 1 | null = null
  const paint = (i: number): void => {
    if (painting === null || selected[i] === painting) return
    selected[i] = painting
    syncCell(i)
  }

  for (let i = 0; i < n; i++) {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'glyph-cell'
    cell.title = `${profile.glyphs[i]}  ·  ${Math.round(flat[i] * 100)}% flat`
    const art = document.createElement('span')
    art.className = 'glyph-art'
    if (sprite) {
      const tileX = (i % atlas.columns) * atlas.pitchWidth + atlas.padding
      const tileY = idiv(i, atlas.columns) * atlas.pitchHeight + atlas.padding
      art.style.backgroundImage = `url(${sprite})`
      art.style.backgroundSize = `${atlas.width * scale}px ${atlas.height * scale}px`
      art.style.backgroundPosition = `-${tileX * scale}px -${tileY * scale}px`
    }
    cell.append(art)
    cell.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      painting = selected[i] ? 0 : 1
      paint(i)
    })
    cell.addEventListener('pointerenter', () => paint(i))
    cells.push(cell)
    grid.append(cell)
    syncCell(i)
  }

  const endPaint = (): void => {
    if (painting === null) return
    painting = null
    emit()
  }
  window.addEventListener('pointerup', endPaint)
  window.addEventListener('pointercancel', endPaint)

  const bar = document.createElement('div')
  bar.className = 'glyph-actions'

  const setAll = (fn: (i: number) => boolean): void => {
    for (let i = 0; i < n; i++) {
      selected[i] = fn(i) ? 1 : 0
      syncCell(i)
    }
    emit()
  }
  const action = (label: string, title: string, fn: (i: number) => boolean): void => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.title = title
    b.addEventListener('click', () => setAll(fn))
    bar.append(b)
  }
  if (options.defaultSelection) {
    const def = options.defaultSelection
    action('Default', `Restore the ${def.size} glyphs selected on load`, (i) => def.has(profile.glyphs[i]))
  }
  action('All', 'Select every glyph', () => true)
  action('None', 'Deselect everything — the live view needs at least one', () => false)
  action('Invert', 'Swap selected and unselected', (i) => !selected[i])
  action(
    'Drop flat swatches',
    'Deselect glyphs with little internal variation — the solid blocks the matcher favours',
    (i) => flat[i] < 0.75,
  )
  bar.append(count)
  count.textContent = `${currentSelection().length} / ${n} selected`

  host.append(bar, grid)

  return {
    selection: currentSelection,
    destroy: () => {
      window.removeEventListener('pointerup', endPaint)
      window.removeEventListener('pointercancel', endPaint)
      host.innerHTML = ''
    },
  }
}
