// Emoji mode: the same playground, driven by chromatic-v1 instead of
// structural-v1 (ALGORITHM.md §C). Everything downstream of matching — sources,
// interactions, exports, the compositor — is shared, because a chromatic frame
// is an AsciiFrame like any other. Only the profile and the matcher change.
//
// Both palettes load lazily. The curated 100 is 527 KB and is all the renderer
// ever needs; the full 1301-glyph set is 6.8 MB and exists only so the picker
// can offer glyphs outside the default, so it is fetched on first use rather
// than on page load.

import type { AsciiProfile } from '@ascii-fx/core'
import { decodeProfile, subsetProfile } from '@ascii-fx/core'

const base = import.meta.env.BASE_URL

let curatedPending: Promise<AsciiProfile> | undefined
let fullPending: Promise<AsciiProfile> | undefined
let defaultGlyphs: Set<string> | undefined
/** null = the default selection; a list = an explicit pick from the picker. */
let selection: string[] | null = null

async function fetchProfile(name: string): Promise<AsciiProfile> {
  const res = await fetch(`${base}emoji/${name}`)
  if (!res.ok) {
    throw new Error(
      `${name} missing — run \`pnpm --filter @ascii-fx-internal/docs prep:emoji\` to compile the emoji palette`,
    )
  }
  return decodeProfile(new Uint8Array(await res.arrayBuffer()))
}

/** The 100-glyph default. Small, and what the renderer runs on unless narrowed. */
function loadCuratedPalette(): Promise<AsciiProfile> {
  curatedPending ??= fetchProfile('noto-curated.asciip').catch((err: unknown) => {
    curatedPending = undefined
    throw err
  })
  return curatedPending
}

/**
 * The full 1301-glyph pool, for the picker only. Deliberately not loaded to
 * render with: measurement put a curated 100 within 1% of the whole pool at a
 * thirteenth of the per-cell work, so searching all 1301 buys almost nothing.
 */
export function loadFullPalette(): Promise<AsciiProfile> {
  fullPending ??= fetchProfile('noto-full.asciip').catch((err: unknown) => {
    fullPending = undefined
    throw err
  })
  return fullPending
}

/** Graphemes selected by default — the usage-curated set. */
export async function defaultSelection(): Promise<ReadonlySet<string>> {
  if (!defaultGlyphs) defaultGlyphs = new Set((await loadCuratedPalette()).glyphs)
  return defaultGlyphs
}

/** Whether the curated palette is already in memory, so the caller can say what it is waiting on. */
export function paletteReady(): boolean {
  return defaultGlyphs !== undefined
}

export function setSelection(glyphs: readonly string[] | null): void {
  selection = glyphs === null ? null : [...glyphs]
}

export function selectionSize(): number | null {
  return selection === null ? null : selection.length
}

/**
 * The profile to render with. Narrowing to a selection that is exactly the
 * default returns the curated profile untouched, so the common case never pays
 * for a subset or for the 6.8 MB fetch.
 */
export async function activeProfile(): Promise<AsciiProfile> {
  const curated = await loadCuratedPalette()
  if (selection === null) return curated
  if (selection.length === 0) {
    throw new Error('select at least one emoji — the matcher needs something to pick')
  }
  const inCurated = new Set(curated.glyphs)
  // Subsetting the curated profile avoids the big fetch whenever the selection
  // happens to sit inside it, which it does for every default-then-deselect path.
  if (selection.every((g) => inCurated.has(g))) {
    return selection.length === curated.glyphCount
      ? curated
      : subsetProfile(curated, curated.glyphs.filter((g) => selection!.includes(g)))
  }
  const full = await loadFullPalette()
  const picked = new Set(selection)
  return subsetProfile(
    full,
    full.glyphs.filter((g) => picked.has(g)),
  )
}
