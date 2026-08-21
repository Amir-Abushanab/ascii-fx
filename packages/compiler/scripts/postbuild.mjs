/**
 * The emitted dist/font.d.ts and dist/raster.d.ts `import type … from 'fontkit'`, and fontkit
 * ships no type declarations. In-repo that resolves through the ambient shim src/fontkit.d.ts,
 * but declaration-only tsc never emits ambient files — so the published types would hand every
 * skipLibCheck:false consumer a TS2307. Ship the shim into dist and reference it from the
 * types entry, so loading index.d.ts pulls the ambient module declaration into the consumer's
 * program.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

copyFileSync(
  new URL('../src/fontkit.d.ts', import.meta.url),
  new URL('../dist/fontkit.d.ts', import.meta.url),
)

const entry = new URL('../dist/index.d.ts', import.meta.url)
const ref = '/// <reference path="./fontkit.d.ts" />\n'
const dts = readFileSync(entry, 'utf8')
if (!dts.startsWith(ref)) writeFileSync(entry, ref + dts)
