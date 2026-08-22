import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ColorMode } from '@ascii-fx/core'
import { decodeFrame, encodeFrame, matchFrame } from '@ascii-fx/core'
import { buildProfile } from '@ascii-fx/compiler'
import { GOLDEN_IMAGES } from './images.js'

const UPDATE = process.env.UPDATE_GOLDEN === '1'
const FONT_PATH = fileURLToPath(
  new URL('../../../fixtures/fonts/GeistMono-Regular.ttf', import.meta.url),
)
const GOLDEN_DIR = fileURLToPath(new URL('../../../fixtures/golden/', import.meta.url))
const PROFILE_PATH = fileURLToPath(
  new URL('../../../fixtures/profiles/default.asciip', import.meta.url),
)

const built = buildProfile({ font: new Uint8Array(readFileSync(FONT_PATH)), id: 'default' })
const { profile } = built

const MODES: ColorMode[] = ['mono', 'full']
const COLUMNS = 24

describe('golden corpus (structural-v1 × Geist Mono)', () => {
  if (UPDATE) {
    it('writes fixtures', () => {
      mkdirSync(GOLDEN_DIR, { recursive: true })
      mkdirSync(dirname(PROFILE_PATH), { recursive: true })
      writeFileSync(PROFILE_PATH, built.binary)
      for (const [name, image] of Object.entries(GOLDEN_IMAGES)) {
        for (const color of MODES) {
          const frame = matchFrame(image, { profile, columns: COLUMNS, color })
          writeFileSync(`${GOLDEN_DIR}${name}-${color}.asciif`, encodeFrame(frame))
          writeFileSync(`${GOLDEN_DIR}${name}-${color}.txt`, frame.toText() + '\n')
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

  for (const [name, image] of Object.entries(GOLDEN_IMAGES)) {
    for (const color of MODES) {
      it(`${name} / ${color}`, () => {
        const goldenPath = `${GOLDEN_DIR}${name}-${color}.asciif`
        expect(
          existsSync(goldenPath),
          `missing golden ${name}-${color} — run \`pnpm golden:update\``,
        ).toBe(true)
        const frame = matchFrame(image, { profile, columns: COLUMNS, color })
        const bytes = encodeFrame(frame)
        expect(bytes).toEqual(new Uint8Array(readFileSync(goldenPath)))
        // and the golden decodes back to the live frame
        const decoded = decodeFrame(bytes, profile)
        expect(decoded.glyphIds).toEqual(frame.glyphIds)
        expect(decoded.foreground).toEqual(frame.foreground)
        expect(decoded.background).toEqual(frame.background)
      })
    }
  }
})
