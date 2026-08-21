import type { AsciiProfile, RawImage } from '@ascii-fx/core'
import { nextPow2, rdiv } from '@ascii-fx/core'

export interface SynthGlyph {
  char: string
  /** 8 strings of 8 chars; '1' = ink. */
  rows: string[]
}

export const G_SPACE: SynthGlyph = { char: ' ', rows: Array(8).fill('00000000') }
export const G_FULL: SynthGlyph = { char: '█', rows: Array(8).fill('11111111') }
export const G_TOP: SynthGlyph = { char: '▀', rows: [...Array(4).fill('11111111'), ...Array(4).fill('00000000')] }
export const G_BOTTOM: SynthGlyph = { char: '▄', rows: [...Array(4).fill('00000000'), ...Array(4).fill('11111111')] }
export const G_LEFT: SynthGlyph = { char: '▌', rows: Array(8).fill('11110000') }
export const G_RIGHT: SynthGlyph = { char: '▐', rows: Array(8).fill('00001111') }

/** Hand-built profile with 8×8 pixel cells whose atlas mirrors the masks exactly. */
export function makeProfile(glyphs: SynthGlyph[]): AsciiProfile {
  const n = glyphs.length
  const masksLo = new Uint32Array(n)
  const masksHi = new Uint32Array(n)
  const coverage = new Uint16Array(n)
  const cell = 8
  const padding = 4
  const pitch = nextPow2(cell + 2 * padding)
  let columns = 1
  while (columns * columns < n) columns++
  const rows = Math.ceil(n / columns)
  const atlas = new Uint8Array(columns * pitch * rows * pitch)

  glyphs.forEach((g, gi) => {
    let lo = 0
    let hi = 0
    let bits = 0
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        if (g.rows[j][i] === '1') {
          const k = j * 8 + i
          if (k < 32) lo |= 1 << k
          else hi |= 1 << (k - 32)
          bits++
          const tileX = (gi % columns) * pitch + padding
          const tileY = Math.floor(gi / columns) * pitch + padding
          atlas[(tileY + j) * columns * pitch + tileX + i] = 255
        }
      }
    }
    masksLo[gi] = lo >>> 0
    masksHi[gi] = hi >>> 0
    coverage[gi] = rdiv(bits * 65535, 64)
  })

  // Content-derived pseudo-fingerprint so distinct synthetic profiles mismatch.
  let h = 0x811c9dc5
  const fnv = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193) >>> 0
  }
  glyphs.forEach((g, gi) => {
    fnv(g.char.codePointAt(0) ?? 0)
    fnv(masksLo[gi])
    fnv(masksHi[gi])
  })
  const fingerprint = h.toString(16).padStart(8, '0').repeat(8)

  return {
    version: 1,
    id: 'synthetic',
    fingerprint,
    charsetHash: '11'.repeat(32),
    fontHash: '22'.repeat(32),
    glyphs: glyphs.map((g) => g.char),
    glyphCount: n,
    metrics: {
      unitsPerEm: 1000,
      ascent: 800,
      descent: -200,
      lineGap: 0,
      advanceUnits: 500,
      cellWidth: cell,
      cellHeight: cell,
      baseline: 6,
    },
    atlas: {
      width: columns * pitch,
      height: rows * pitch,
      pitchWidth: pitch,
      pitchHeight: pitch,
      cellWidth: cell,
      cellHeight: cell,
      padding,
      columns,
      data: atlas,
    },
    structural: { masksLo, masksHi, coverage },
    metadata: { id: 'synthetic', charset: 'custom', compilerVersion: 'test' },
  }
}

export const STANDARD_SIX = [G_SPACE, G_FULL, G_TOP, G_BOTTOM, G_LEFT, G_RIGHT]

/** 8×8 single-cell image from a per-sample color function. */
export function makeCell(fn: (i: number, j: number) => [number, number, number, number?]): RawImage {
  const data = new Uint8Array(8 * 8 * 4)
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const [r, g, b, a] = fn(i, j)
      const p = (j * 8 + i) * 4
      data[p] = r
      data[p + 1] = g
      data[p + 2] = b
      data[p + 3] = a ?? 255
    }
  }
  return { width: 8, height: 8, data }
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomProfile(glyphCount: number, seed: number): AsciiProfile {
  const rnd = mulberry32(seed)
  const glyphs: SynthGlyph[] = []
  for (let g = 0; g < glyphCount; g++) {
    const rows: string[] = []
    for (let j = 0; j < 8; j++) {
      let row = ''
      for (let i = 0; i < 8; i++) row += rnd() < 0.5 ? '0' : '1'
      rows.push(row)
    }
    glyphs.push({ char: String.fromCharCode(0x21 + g), rows })
  }
  return makeProfile(glyphs)
}

export function randomImage(width: number, height: number, seed: number, withAlpha = false): RawImage {
  const rnd = mulberry32(seed)
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = Math.floor(rnd() * 256)
    data[i * 4 + 1] = Math.floor(rnd() * 256)
    data[i * 4 + 2] = Math.floor(rnd() * 256)
    data[i * 4 + 3] = withAlpha ? Math.floor(rnd() * 256) : 255
  }
  return { width, height, data }
}

export interface ChromaticGlyph {
  char: string
  /** Per-sample straight-alpha RGBA; alpha defaults to 255. */
  at: (i: number, j: number) => [number, number, number, number?]
}

/** Solid-colour glyph, the simplest thing chromatic-v1 can match against. */
export function solid(char: string, r: number, g: number, b: number, a = 255): ChromaticGlyph {
  return { char, at: () => [r, g, b, a] }
}

/**
 * Profile carrying both structural and chromatic data. The structural masks are
 * derived from alpha, which is what a real chromatic compile does — it keeps
 * blankGlyphId and every structural consumer working on a chromatic profile.
 */
export function makeChromaticProfile(glyphs: ChromaticGlyph[]): AsciiProfile {
  const n = glyphs.length
  const samples = new Uint8Array(n * 256)
  const synth: SynthGlyph[] = glyphs.map((g) => {
    const rows: string[] = []
    for (let j = 0; j < 8; j++) {
      let row = ''
      for (let i = 0; i < 8; i++) {
        const [, , , a = 255] = g.at(i, j)
        row += a >= 128 ? '1' : '0'
      }
      rows.push(row)
    }
    return { char: g.char, rows }
  })
  glyphs.forEach((g, gi) => {
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const [r, gg, b, a = 255] = g.at(i, j)
        const p = gi * 256 + (j * 8 + i) * 4
        samples[p] = r
        samples[p + 1] = gg
        samples[p + 2] = b
        samples[p + 3] = a
      }
    }
  })
  const base = makeProfile(synth)
  // The RGBA atlas mirrors the 8x8 descriptors exactly, so a composited cell is
  // directly comparable with the samples the matcher scored.
  const { width, pitchWidth, pitchHeight, padding, columns } = base.atlas
  const rgba = new Uint8Array(width * base.atlas.height * 4)
  glyphs.forEach((g, gi) => {
    const tileX = (gi % columns) * pitchWidth + padding
    const tileY = Math.floor(gi / columns) * pitchHeight + padding
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const [r, gg, b, a = 255] = g.at(i, j)
        const dst = ((tileY + j) * width + tileX + i) * 4
        rgba[dst] = r
        rgba[dst + 1] = gg
        rgba[dst + 2] = b
        rgba[dst + 3] = a
      }
    }
  })
  return { ...base, atlas: { ...base.atlas, rgba }, chromatic: { samples } }
}
