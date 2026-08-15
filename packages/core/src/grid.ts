import type { AsciiProfile } from './types.js'
import { rdiv } from './util.js'

export interface Grid {
  columns: number
  rows: number
}

/** grid-v1 (ALGORITHM.md §3). */
export function deriveGrid(
  width: number,
  height: number,
  profile: AsciiProfile,
  columns?: number,
  rows?: number,
): Grid {
  const cw = profile.atlas.cellWidth
  const ch = profile.atlas.cellHeight
  if (columns !== undefined && rows !== undefined) {
    return { columns: Math.max(1, columns), rows: Math.max(1, rows) }
  }
  if (columns !== undefined) {
    const c = Math.max(1, columns)
    return { columns: c, rows: Math.max(1, rdiv(height * c * cw, width * ch)) }
  }
  if (rows !== undefined) {
    const r = Math.max(1, rows)
    return { columns: Math.max(1, rdiv(width * r * ch, height * cw)), rows: r }
  }
  return deriveGrid(width, height, profile, 120)
}
