// palette-v1 (ALGORITHM.md §22): snap each cell's fitted colours to a fixed
// palette, optionally through an ordered (Bayer) dither. A colour transform on
// the cell planes, downstream of matching — the glyph choice is untouched, so a
// renderer can change the palette without rematching. Integer throughout, so a
// GPU pass that runs the same steps agrees with this one bit for bit.
import type { RGB } from './types.js'
import { FLAG_TRANSPARENT } from './types.js'
import { AsciiFrame } from './frame.js'
import { idiv } from './util.js'

export const PALETTE_VERSION = 'palette-v1'

/** Largest palette accepted. A GPU uniform carries it, so it has a ceiling. */
export const MAX_PALETTE_COLORS = 256

/**
 * Ordered dither by Bayer matrix size. Error diffusion (Floyd–Steinberg and
 * kin) is deliberately absent: it carries error from cell to cell in scan
 * order, which a GPU pass cannot do in parallel and stay exact.
 */
export type DitherKind = 'none' | 'bayer2' | 'bayer4' | 'bayer8'

export interface PaletteOptions {
  /** 1..256 colours. Ties between equally near entries go to the earlier one. */
  colors: readonly RGB[]
  /** Default 'none'. */
  dither?: DitherKind
  /**
   * Dither amplitude in 0..255 channel units, default 64: the threshold offsets
   * span roughly ±spread/2. Around the gap between neighbouring palette colours
   * is a good value; much more turns gradients into noise.
   */
  spread?: number
}

/** A palette reduced to what the per-cell step reads. */
export interface ResolvedPalette {
  /** Packed 0xBBGGRR, palette order. */
  colors: Uint32Array
  /** Bayer matrix side: 1 (no dither), 2, 4 or 8. */
  size: number
  /** Threshold offset per matrix position, row-major, size² entries. */
  offsets: Int32Array
}

const DITHER_SIZE: Record<DitherKind, number> = { none: 1, bayer2: 2, bayer4: 4, bayer8: 8 }

/** Bayer index matrix, row-major, values 0..n²−1: B₂ₙ = [[4B, 4B+2], [4B+3, 4B+1]]. */
function bayerMatrix(n: number): Uint8Array {
  let m = new Uint8Array([0])
  let size = 1
  while (size < n) {
    const next = new Uint8Array(4 * size * size)
    const s2 = size * 2
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = 4 * m[y * size + x]
        next[y * s2 + x] = v
        next[y * s2 + x + size] = v + 2
        next[(y + size) * s2 + x] = v + 3
        next[(y + size) * s2 + x + size] = v + 1
      }
    }
    m = next
    size = s2
  }
  return m
}

const channel = (v: number, what: string): number => {
  if (!Number.isInteger(v) || v < 0 || v > 255) {
    throw new Error(`Palette ${what} must be an integer in 0..255; got ${v}.`)
  }
  return v
}

/** Validate and pack a palette for {@link quantizeFrame} or a GPU upload. */
export function resolvePalette(palette: PaletteOptions): ResolvedPalette {
  const n = palette.colors.length
  if (n < 1 || n > MAX_PALETTE_COLORS) {
    throw new Error(`A palette needs 1..${MAX_PALETTE_COLORS} colours; got ${n}.`)
  }
  const colors = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const c = palette.colors[i]
    colors[i] =
      (channel(c[0], `colour ${i}`) |
        (channel(c[1], `colour ${i}`) << 8) |
        (channel(c[2], `colour ${i}`) << 16)) >>>
      0
  }
  const dither = palette.dither ?? 'none'
  const size = DITHER_SIZE[dither]
  if (size === undefined) throw new Error(`Unknown dither ${JSON.stringify(dither)}.`)
  const spreadIn = palette.spread ?? 64
  if (!Number.isFinite(spreadIn)) throw new Error(`Palette spread must be finite; got ${spreadIn}.`)
  const spread = Math.min(255, Math.max(0, Math.round(spreadIn)))
  const offsets = new Int32Array(size * size)
  if (size > 1) {
    const m = bayerMatrix(size)
    const half = spread >> 1
    for (let i = 0; i < m.length; i++) {
      offsets[i] = idiv((2 * m[i] + 1) * spread, 2 * size * size) - half
    }
  }
  return { colors, size, offsets }
}

/**
 * Snap one packed colour to the palette at cell (cx, cy). The alpha byte is
 * carried through; the result's RGB is always a palette entry.
 */
export function quantizeColor(c: number, cx: number, cy: number, palette: ResolvedPalette): number {
  const { size, colors } = palette
  const off = palette.offsets[(cy % size) * size + (cx % size)]
  const r = Math.min(255, Math.max(0, (c & 0xff) + off))
  const g = Math.min(255, Math.max(0, ((c >>> 8) & 0xff) + off))
  const b = Math.min(255, Math.max(0, ((c >>> 16) & 0xff) + off))
  let best = 0
  let bestErr = Infinity
  for (let i = 0; i < colors.length; i++) {
    const p = colors[i]
    const dr = r - (p & 0xff)
    const dg = g - ((p >>> 8) & 0xff)
    const db = b - ((p >>> 16) & 0xff)
    const err = dr * dr + dg * dg + db * db
    if (err < bestErr) {
      bestErr = err
      best = i
    }
  }
  return ((colors[best] & 0xffffff) | (c & 0xff000000)) >>> 0
}

/**
 * The frame with its colour planes snapped to `palette` (palette-v1, §22).
 * Glyphs, flags and grid are shared with the input, not copied. `mono` and
 * `glyph` frames have no per-cell colour to snap and come back as they are.
 */
export function quantizeFrame(
  frame: AsciiFrame,
  palette: PaletteOptions | ResolvedPalette,
): AsciiFrame {
  if (frame.colorMode === 'mono' || frame.colorMode === 'glyph' || !frame.foreground) return frame
  const resolved = 'offsets' in palette ? palette : resolvePalette(palette)
  const { columns, rows } = frame
  const snap = (plane: Uint32Array | undefined): Uint32Array | undefined => {
    if (!plane) return undefined
    const out = new Uint32Array(plane.length)
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < columns; cx++) {
        const i = cy * columns + cx
        // Transparent cells carry no colour (§11); there is nothing to snap.
        out[i] =
          frame.flags[i] & FLAG_TRANSPARENT ? plane[i] : quantizeColor(plane[i], cx, cy, resolved)
      }
    }
    return out
  }
  return new AsciiFrame({
    columns,
    rows,
    colorMode: frame.colorMode,
    glyphIds: frame.glyphIds,
    foreground: snap(frame.foreground),
    background: snap(frame.background),
    flags: frame.flags,
    profile: frame.profile,
  })
}
