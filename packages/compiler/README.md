# @ascii-fx/compiler

Node-only build-time compiler: deterministic font rasterization (fontkit parsing + an in-house fixed-point scanline rasterizer — no system rasterizers, so `.asciip` bytes are identical across platforms), glyph atlases, structural masks, and static frame precompilation.

```ts
import { readFile } from 'node:fs/promises'
import { buildProfile, buildFrame, decodePng } from '@ascii-fx/compiler'

const { profile, binary } = buildProfile({
  font: await readFile('./GeistMono-Regular.ttf'),
  charset: 'ascii', // or characters: '@#*+. '
  shape6: { lut: true }, // optional approximate-matcher data (adds ~514KiB raw)
})

const frame = buildFrame({ image: decodePng(pngBytes), profile, columns: 140, color: 'full' })
```

## CLI

```bash
ascii-fx profile build --font GeistMono-Regular.ttf --out default.asciip [--shape6|--shape6-lut]
ascii-fx frame build --image hero.png --profile default.asciip --columns 140 --color full --out hero.asciif
ascii-fx inspect default.asciip
```

Constraints: monospace fonts only (equal advances over the charset — enforced); the charset must be fully covered by the font (missing glyphs are listed, never tofu'd); PNG only for `frame build` in v1. Profiles embed content fingerprints; identical inputs → identical bytes, verified by tests.
