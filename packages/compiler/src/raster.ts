// raster-v1 (ALGORITHM.md §13): deterministic fixed-point (26.6) scanline
// rasterizer. No system rasterizer may replace this — profile bytes must be
// identical across platforms.

import { fdiv, idiv, rdiv } from '@ascii-fx/core'
import type { FontPathCommand } from 'fontkit'

export const SUPERSAMPLE = 4
export const QUAD_SEGMENTS = 16
export const CUBIC_SEGMENTS = 24

/** Font-unit → 26.6 pixel-space mappers (y-down). */
export interface FxMapping {
  x(v: number): number
  y(v: number): number
}

/** Flatten outline commands to non-horizontal line segments [x0,y0,x1,y1, ...] in 26.6. */
export function flattenCommands(commands: readonly FontPathCommand[], map: FxMapping): number[] {
  const edges: number[] = []
  let curX = 0
  let curY = 0
  let startX = 0
  let startY = 0
  let open = false

  const push = (x0: number, y0: number, x1: number, y1: number): void => {
    if (y0 !== y1) edges.push(x0, y0, x1, y1)
  }
  const lineTo = (x: number, y: number): void => {
    push(curX, curY, x, y)
    curX = x
    curY = y
  }
  const close = (): void => {
    if (open && (curX !== startX || curY !== startY)) push(curX, curY, startX, startY)
    open = false
  }

  for (const cmd of commands) {
    const a = cmd.args
    switch (cmd.command) {
      case 'moveTo':
        close()
        curX = startX = map.x(a[0])
        curY = startY = map.y(a[1])
        open = true
        break
      case 'lineTo':
        lineTo(map.x(a[0]), map.y(a[1]))
        break
      case 'quadraticCurveTo': {
        const n = QUAD_SEGMENTS
        const x0 = curX
        const y0 = curY
        const cx = map.x(a[0])
        const cy = map.y(a[1])
        const x2 = map.x(a[2])
        const y2 = map.y(a[3])
        for (let i = 1; i <= n; i++) {
          const w0 = (n - i) * (n - i)
          const w1 = 2 * i * (n - i)
          const w2 = i * i
          lineTo(rdiv(w0 * x0 + w1 * cx + w2 * x2, n * n), rdiv(w0 * y0 + w1 * cy + w2 * y2, n * n))
        }
        break
      }
      case 'bezierCurveTo': {
        const n = CUBIC_SEGMENTS
        const x0 = curX
        const y0 = curY
        const c1x = map.x(a[0])
        const c1y = map.y(a[1])
        const c2x = map.x(a[2])
        const c2y = map.y(a[3])
        const x3 = map.x(a[4])
        const y3 = map.y(a[5])
        for (let i = 1; i <= n; i++) {
          const u = n - i
          const w0 = u * u * u
          const w1 = 3 * i * u * u
          const w2 = 3 * i * i * u
          const w3 = i * i * i
          lineTo(
            rdiv(w0 * x0 + w1 * c1x + w2 * c2x + w3 * x3, n * n * n),
            rdiv(w0 * y0 + w1 * c1y + w2 * c2y + w3 * y3, n * n * n),
          )
        }
        break
      }
      case 'closePath':
        close()
        break
    }
  }
  close()
  return edges
}

export interface GlyphRaster {
  /** Per-pixel subsample hit counts, cellW·cellH, each 0..SUPERSAMPLE². */
  hits: Uint8Array
  /** Subsample hits per 8×8 mask cell. */
  maskHits: Int32Array
  totalHits: number
}

/** Subsample totals per 8×8 mask cell — identical for every glyph of a given cell size. */
export function maskTotals(cellW: number, cellH: number): Int32Array {
  const S = SUPERSAMPLE
  const subW = cellW * S
  const subH = cellH * S
  const totals = new Int32Array(64)
  for (let sy = 0; sy < subH; sy++) {
    const rowBase = idiv(sy * 8, subH) * 8
    for (let sx = 0; sx < subW; sx++) totals[rowBase + idiv(sx * 8, subW)]++
  }
  return totals
}

/** Scanline fill (non-zero winding) over subsample centers. */
export function rasterizeGlyph(
  edges: readonly number[],
  cellW: number,
  cellH: number,
): GlyphRaster {
  const S = SUPERSAMPLE
  const step = idiv(64, S) // 26.6 units between subsample centers
  const half = idiv(step, 2)
  const subW = cellW * S
  const subH = cellH * S
  const hits = new Uint8Array(cellW * cellH)
  const maskHits = new Int32Array(64)
  let totalHits = 0
  if (edges.length === 0) return { hits, maskHits, totalHits }

  for (let sy = 0; sy < subH; sy++) {
    const y = sy * step + half
    const crossings: Array<[number, number]> = []
    for (let e = 0; e < edges.length; e += 4) {
      const y0 = edges[e + 1]
      const y1 = edges[e + 3]
      const lo = Math.min(y0, y1)
      const hi = Math.max(y0, y1)
      if (y < lo || y >= hi) continue
      const x0 = edges[e]
      const x1 = edges[e + 2]
      crossings.push([x0 + fdiv((x1 - x0) * (y - y0), y1 - y0), y1 > y0 ? 1 : -1])
    }
    if (crossings.length === 0) continue
    crossings.sort((a, b) => a[0] - b[0])
    const mRowBase = idiv(sy * 8, subH) * 8
    const pRow = idiv(sy, S) * cellW
    let ci = 0
    let winding = 0
    for (let sx = 0; sx < subW; sx++) {
      const X = sx * step + half
      while (ci < crossings.length && crossings[ci][0] <= X) {
        winding += crossings[ci][1]
        ci++
      }
      if (winding !== 0) {
        hits[pRow + idiv(sx, S)]++
        maskHits[mRowBase + idiv(sx * 8, subW)]++
        totalHits++
      }
    }
  }
  return { hits, maskHits, totalHits }
}

/** Mask bit = 1 ⇔ 2·hits ≥ total (tie → ink). Returns 64-bit mask as lo/hi u32. */
export function deriveMask(maskHits: Int32Array, totals: Int32Array): { lo: number; hi: number } {
  let lo = 0
  let hi = 0
  for (let m = 0; m < 64; m++) {
    if (2 * maskHits[m] >= totals[m]) {
      if (m < 32) lo |= 1 << m
      else hi |= 1 << (m - 32)
    }
  }
  return { lo: lo >>> 0, hi: hi >>> 0 }
}
