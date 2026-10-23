// Golden fixtures for shaped glyphs (ALGORITHM.md §13 "Glyph outlines"). A glyph that is not one
// code point the font maps is drawn from fontkit's shaping, so its pixels depend on fontkit's code
// as well as the font's — a fontkit update can move them with no change on this side. These pin
// every shaped glyph's mask, coverage and atlas pixels, across a fontkit upgrade as much as any
// other change, and say which glyphs moved when they do.
//
// The fonts are OFL subsets committed under fixtures/fonts (see the README there), so this runs
// in CI rather than only where a system font happens to be installed. The Arabic subset leaves the
// presentation block out on purpose: every form is then shaped from its base letter in context.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildProfile } from '@ascii-fx/compiler'

const UPDATE = process.env.UPDATE_GOLDEN === '1'
const font = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/fonts/${name}`, import.meta.url)))
const GOLDEN_PATH = fileURLToPath(
  new URL('../../../fixtures/golden/shaped-profiles.json', import.meta.url),
)

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i))

const CASES: Record<string, Parameters<typeof buildProfile>[0]> = {
  // Base letters with combining marks, placed by GPOS mark attachment.
  'latin-marks': {
    font: font('GeistMono-Regular.ttf'),
    characters: [' ', 'e', 'é', 'à', 'ñ', 'ö', 'ç'],
  },
  // Every positional form, each shaped from its base letter, joining forms with kashida.
  'arabic-joined': { font: font('NotoSansArabic-Regular.subset.ttf'), charset: 'arabic-joined' },
  // Conjuncts and vowel signs: GSUB ligatures and reordering (the i-matra goes before ka).
  devanagari: {
    font: font('NotoSansDevanagari-Regular.subset.ttf'),
    characters: [
      ' ',
      ...Array.from('कखगघचजटडतदनपबमयरलवशषसह'),
      'क्ष',
      'त्र',
      'ज्ञ',
      'श्र',
      ...['ा', 'ि', 'ी', 'ु', 'ू', 'े', 'ै', 'ो', 'ौ', 'ं'].map((s) => `क${s}`),
    ],
  },
  // Stacked marks and sara am, which decomposes in shaping.
  thai: {
    font: font('NotoSansThai-Regular.subset.ttf'),
    characters: [
      ' ',
      ...range(0x0e01, 0x0e2e),
      ...['ำ', 'ิ', 'ี', 'ุ', 'ู', 'ั', '็', '่', '้', '๊', '๋', '่ำ'].map((s) => `ก${s}`),
      'ปิ่',
    ],
  },
}

interface GoldenProfile {
  fontHash: string
  cell: [number, number]
  atlasSha256: string
  /** glyph → [masksLo, masksHi, coverage], hex for the masks so a diff reads as bits. */
  glyphs: Record<string, [string, string, number]>
}

function snapshot(options: Parameters<typeof buildProfile>[0]): GoldenProfile {
  const { profile } = buildProfile(options)
  const glyphs: GoldenProfile['glyphs'] = {}
  profile.glyphs.forEach((g, i) => {
    glyphs[g] = [
      profile.structural.masksLo[i].toString(16).padStart(8, '0'),
      profile.structural.masksHi[i].toString(16).padStart(8, '0'),
      profile.structural.coverage[i],
    ]
  })
  return {
    fontHash: profile.fontHash,
    cell: [profile.atlas.cellWidth, profile.atlas.cellHeight],
    atlasSha256: createHash('sha256').update(profile.atlas.data).digest('hex'),
    glyphs,
  }
}

describe('golden shaped glyphs (raster-v1 × fontkit shaping)', () => {
  const actual = Object.fromEntries(
    Object.entries(CASES).map(([name, options]) => [name, snapshot(options)]),
  )

  if (UPDATE) {
    it('writes fixtures', () => {
      writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + '\n')
      expect(true).toBe(true)
    })
    return
  }

  const golden: Record<string, GoldenProfile> = existsSync(GOLDEN_PATH)
    ? JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'))
    : {}

  for (const name of Object.keys(CASES)) {
    it(name, () => {
      const want = golden[name]
      expect(want, 'missing fixture — run `pnpm golden:update` once').toBeDefined()
      const got = actual[name]
      expect(got.fontHash, 'the fixture font itself changed').toBe(want.fontHash)
      // Name the glyphs that moved, which is what someone reviewing a fontkit bump needs to see.
      const moved = Object.keys(want.glyphs).filter(
        (g) => JSON.stringify(got.glyphs[g]) !== JSON.stringify(want.glyphs[g]),
      )
      expect(moved, 'shaped glyphs whose mask or coverage changed').toEqual([])
      expect(Object.keys(got.glyphs)).toEqual(Object.keys(want.glyphs))
      expect(got.cell).toEqual(want.cell)
      expect(got.atlasSha256, 'atlas pixels changed (anti-aliasing of a shaped glyph)').toBe(
        want.atlasSha256,
      )
    })
  }
})
