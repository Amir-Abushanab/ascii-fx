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
  'p5.min.js': join(here, 'node_modules/p5/lib/p5.min.js'),
  'p5.asciify.umd.js': join(here, 'node_modules/p5.asciify/dist/p5.asciify.umd.js'),
  'chafa.js': join(here, 'node_modules/chafa-wasm/dist/chafa.js'),
  'chafa.wasm': join(here, 'node_modules/chafa-wasm/dist/chafa.wasm'),
  'default.asciip': join(repoRoot, 'fixtures/profiles/default.asciip'),
}

/** Built package output the harness imports through its importmap. */
export const HARNESS_PACKAGE_DISTS = ['core', 'gpu']

/**
 * The shape6+LUT profile the Harri-style matcher rows need. The committed
 * fixture profile carries structural data only, so this is compiled on demand
 * rather than checked in.
 */
export async function buildShape6Profile() {
  const font = new Uint8Array(await readFile(join(repoRoot, 'fixtures/fonts/GeistMono-Regular.ttf')))
  return encodeProfile(buildProfile({ font, shape6: { lut: true } }).profile)
}
