// Everything compare/index.html needs to run, in one place. Two hosts serve it:
// the CLI benchmark (an ephemeral node server, vsync disabled) and the docs site
// (copied into public/bench/ so visitors can run it themselves). Keeping the
// manifest here is what stops the two from drifting apart.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeProfile } from '@ascii-fx/core'
import { buildProfile } from '@ascii-fx/compiler'

const here = fileURLToPath(new URL('.', import.meta.url))
export const repoRoot = join(here, '../..')

const threeRoot = join(here, 'node_modules/three')

/**
 * Files the harness fetches, keyed by the path it requests them at (relative to
 * wherever index.html is served from).
 */
export const HARNESS_FILES = {
  'index.html': join(here, 'compare/index.html'),
  'three.module.js': join(threeRoot, 'build/three.module.js'),
  'three.core.js': join(threeRoot, 'build/three.core.js'),
  'AsciiEffect.js': join(threeRoot, 'examples/jsm/effects/AsciiEffect.js'),
  'aalib.js': join(here, 'node_modules/aalib.js/dist/aalib.js'),
  'textmode.umd.js': join(here, 'node_modules/textmode.js/dist/textmode.umd.js'),
  'chafa.js': join(here, 'node_modules/chafa-wasm/dist/chafa.js'),
  'chafa.wasm': join(here, 'node_modules/chafa-wasm/dist/chafa.wasm'),
  'default.asciip': join(repoRoot, 'fixtures/profiles/default.asciip'),
  // Compiled by `pnpm --filter @ascii-fx-internal/docs prep:emoji`. Not checked
  // in — it is a 6.8 MB atlas built from fetched Noto assets — so the emoji
  // rows skip themselves when it is missing rather than failing the run.
  'chromatic.asciip': join(repoRoot, 'apps/docs/public/emoji/noto-curated.asciip'),
}

/**
 * Files the harness can run without. The emoji rows need a compiled chromatic
 * profile, which is built from fetched assets by `prep:emoji` and is not in the
 * repo — so its absence downgrades the run rather than failing it, and `pnpm
 * dev` keeps working on a fresh clone.
 */
export const OPTIONAL_HARNESS_FILES = new Set(['chromatic.asciip'])

/** Built package output the harness imports through its importmap. */
export const HARNESS_PACKAGE_DISTS = ['core', 'gpu']

/**
 * The shape6+LUT profile the Harri-style matcher rows need. The committed
 * fixture profile carries structural data only, so this is compiled on demand
 * rather than checked in.
 */
export async function buildShape6Profile() {
  const font = new Uint8Array(
    await readFile(join(repoRoot, 'fixtures/fonts/GeistMono-Regular.ttf')),
  )
  return encodeProfile(buildProfile({ font, shape6: { lut: true } }).profile)
}
