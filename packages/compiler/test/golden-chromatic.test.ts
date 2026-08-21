// Golden corpus for chromatic-v1 (ALGORITHM.md §C). The unit tests pin the
// algorithm; this pins the *binary format* and the compiled profile, so a
// change to either shows up as a diff rather than as silence.
//
// The palette is generated procedurally rather than loaded from an emoji set:
// the fixtures then depend on nothing outside the repo, and the test says
// something about the compiler rather than about Noto's artwork.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RGB, RawImage } from '@ascii-fx/core'
import { decodeFrame, decodeProfile, encodeFrame, matchFrame } from '@ascii-fx/core'
import { buildChromaticProfile } from '@ascii-fx/compiler'
import { GOLDEN_IMAGES } from './images.js'

const UPDATE = process.env.UPDATE_GOLDEN === '1'
const GOLDEN_DIR = fileURLToPath(new URL('../../../fixtures/golden/', import.meta.url))
const PROFILE_PATH = fileURLToPath(new URL('../../../fixtures/profiles/chromatic.asciip', import.meta.url))

const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296)

/**
 * A 24-glyph synthetic palette: flat swatches, vertical splits, and diagonal
 * gradients, so the descriptors carry real sub-cell structure and a range of
 * alpha rather than being 24 flat colours the matcher could not tell apart
 * structurally.
 */
function palette(): { char: string; image: RawImage }[] {
  const rnd = lcg(0x5eed)
  const size = 24
  return Array.from({ length: 24 }, (_, i) => {
    const a = [rnd() * 256, rnd() * 256, rnd() * 256].map(Math.floor)
    const b = [rnd() * 256, rnd() * 256, rnd() * 256].map(Math.floor)
    const alpha = i % 6 === 0 ? 96 + Math.floor(rnd() * 120) : 255
    const kind = i % 3
    const data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let c: number[]
        if (kind === 0) c = a
        else if (kind === 1) c = x < size / 2 ? a : b
        else {
          const t = (x + y) / (2 * size - 2)
          c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
        }
        const p = (y * size + x) * 4
        data[p] = Math.round(c[0])
        data[p + 1] = Math.round(c[1])
        data[p + 2] = Math.round(c[2])
        data[p + 3] = alpha
      }
    }
    return { char: String.fromCodePoint(0x1f300 + i), image: { width: size, height: size, data } }
  })
}

const built = buildChromaticProfile({ glyphs: palette(), id: 'chromatic-golden' })
const { profile } = built

// The backdrop is part of the objective (§C3), so the corpus covers more than one.
const BACKDROPS: Array<[string, RGB]> = [
  ['onblack', [0, 0, 0]],
  ['onwhite', [255, 255, 255]],
]
const COLUMNS = 24

describe('golden corpus (chromatic-v1 × synthetic palette)', () => {
  if (UPDATE) {
    it('writes fixtures', () => {
      mkdirSync(GOLDEN_DIR, { recursive: true })
      mkdirSync(dirname(PROFILE_PATH), { recursive: true })
      writeFileSync(PROFILE_PATH, built.binary)
      for (const [name, image] of Object.entries(GOLDEN_IMAGES)) {
        for (const [bdName, background] of BACKDROPS) {
          const frame = matchFrame(image, { profile, columns: COLUMNS, matcher: 'chromatic', background })
          writeFileSync(`${GOLDEN_DIR}${name}-chromatic-${bdName}.asciif`, encodeFrame(frame))
          writeFileSync(`${GOLDEN_DIR}${name}-chromatic-${bdName}.txt`, frame.toText() + '\n')
        }
      }
      expect(true).toBe(true)
    })
    return
  }

  it('fixture profile matches the freshly built profile byte-for-byte', () => {
    expect(existsSync(PROFILE_PATH), 'missing fixtures — run `pnpm golden:update` once').toBe(true)
    expect(new Uint8Array(readFileSync(PROFILE_PATH))).toEqual(built.binary)
  })

  it('the fixture profile round-trips its chromatic sections', () => {
    const decoded = decodeProfile(new Uint8Array(readFileSync(PROFILE_PATH)))
    expect(decoded.chromatic!.samples).toEqual(profile.chromatic!.samples)
    expect(decoded.atlas.rgba).toEqual(profile.atlas.rgba)
  })

  for (const [name, image] of Object.entries(GOLDEN_IMAGES)) {
    for (const [bdName, background] of BACKDROPS) {
      it(`${name} / ${bdName}`, () => {
        const goldenPath = `${GOLDEN_DIR}${name}-chromatic-${bdName}.asciif`
        expect(existsSync(goldenPath), `missing golden ${name}-chromatic-${bdName} — run \`pnpm golden:update\``).toBe(
          true,
        )
        const frame = matchFrame(image, { profile, columns: COLUMNS, matcher: 'chromatic', background })
        const bytes = encodeFrame(frame)
        expect(bytes).toEqual(new Uint8Array(readFileSync(goldenPath)))
        const decoded = decodeFrame(bytes, profile)
        expect(decoded.glyphIds).toEqual(frame.glyphIds)
        expect(decoded.colorMode).toBe('glyph')
        // 'glyph' frames carry no colour planes; the colour is in the glyph.
        expect(decoded.foreground).toBeUndefined()
        expect(decoded.background).toBeUndefined()
      })
    }
  }
})
