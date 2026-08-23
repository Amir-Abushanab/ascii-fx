# @ascii-fx/compiler

Build-time only: turns a font into a glyph profile the matcher can use, and an image into a precompiled frame. Node, never the browser.

```sh
pnpm add -D @ascii-fx/compiler
```

Most people never import this directly — [`@ascii-fx/vite`](../vite) wraps it as a plugin, and the runtime packages can compile a profile themselves at startup. Reach for it when you want to compile ahead of time, or in a build that isn't Vite.

```ts
import { readFile } from 'node:fs/promises'
import { buildProfile } from '@ascii-fx/compiler'

const font = new Uint8Array(await readFile('GeistMono-Regular.ttf'))
const { profile, binary } = buildProfile({ font, characters: ' .:-=+*#%@' })
await writeFile('public/default.asciip', binary)
```

## Deterministic on purpose

Rasterization is an in-house fixed-point scanline rasterizer over [fontkit](https://github.com/foliojs/fontkit)'s glyph outlines — **no system rasterizer anywhere in the path**. The same font and the same options produce byte-identical `.asciip` output on macOS, Linux, and CI.

That matters because a profile's fingerprint is what a `.asciif` frame is validated against. If rasterization drifted between machines, frames compiled on your laptop would be refused by the same code running in CI. Golden-file tests pin it.

## Colour glyphs

`buildChromaticProfile` builds from decoded colour images rather than a font, carrying an RGBA atlas alongside the coverage plane, so the profile still works with the mask-fitting matchers:

```ts
import { buildChromaticProfile } from '@ascii-fx/compiler'

const { binary } = buildChromaticProfile({ glyphs: [{ char: '🌊', image }, ...] })
```

## Static frames

`buildFrame` matches an image at build time and emits `.asciif`, so the client ships glyph ids instead of doing any matching:

```ts
import { buildFrame, decodePng } from '@ascii-fx/compiler'

const { binary } = buildFrame({ profile, image: decodePng(png), columns: 160 })
```

A frame records the fingerprint of the profile it was built against and refuses to decode against a different one — a stale `.asciif` fails loudly rather than rendering garbage.

## CLI

```sh
npx ascii-fx profile build --font GeistMono-Regular.ttf --out default.asciip
npx ascii-fx frame build --image hero.png --profile default.asciip --columns 160 --out hero.asciif
npx ascii-fx inspect default.asciip
```

## License

[MIT](../../LICENSE)
