# @ascii-fx/vite

Compile glyph profiles and static frames at build time, and import them like any other asset.

```sh
pnpm add -D @ascii-fx/vite
```

```ts
// vite.config.ts
import { ascii } from '@ascii-fx/vite'

export default defineConfig({
  plugins: [ascii({ config: './ascii-fx.config.ts' })],
})
```

```ts
// ascii-fx.config.ts
import { defineAsciiConfig } from '@ascii-fx/vite'

export default defineAsciiConfig({
  profiles: { default: { font: './fonts/GeistMono-Regular.ttf' } },
  frames: { hero: { profile: 'default', image: './src/hero.png', columns: 160 } },
})
```

```ts
import profileUrl from 'virtual:ascii-profile/default?url'
import heroUrl from 'virtual:ascii-frame/hero?url'
```

Typed, hashed, and cached like any other Vite asset. Add `@ascii-fx/vite/client` to your `tsconfig` `types` for the module declarations.

## What it buys you

Compiling a profile costs real time — rasterizing every glyph, building the atlas, deriving structural masks. The runtime packages will do it at startup if they have to, but doing it once at build time means the client downloads a compact binary instead, and gets byte-identical glyphs on every machine rather than whatever the runtime produced that session.

A precompiled **frame** goes further: matching already happened, so the client ships glyph ids and colours and does no matching at all. That's the cheapest possible path for a static hero image.

## Watching

Fonts and images are watched. Change a font and the profiles built from it recompile and hot-reload; change a source image and its frame does. A corrupt cache entry rebuilds rather than failing forever.

None of the compiler reaches the client bundle — it runs in Vite's Node context and emits assets.

## License

[MIT](../../LICENSE)
