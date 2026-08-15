# @ascii-fx/vite

Thin Vite integration over `@ascii-fx/compiler`: compiles font profiles and static frames at build time, exposes them as typed virtual modules backed by hashed assets, watches fonts/images for HMR, and keeps all compiler code out of the client bundle.

```ts
// vite.config.ts
import { ascii } from '@ascii-fx/vite'
export default defineConfig({ plugins: [ascii({ config: './ascii-fx.config.ts' })] })

// ascii-fx.config.ts
import { defineAsciiConfig } from '@ascii-fx/vite'
export default defineAsciiConfig({
  profiles: {
    default: { font: './public/fonts/GeistMono-Regular.woff2', charset: 'ascii' },
  },
  frames: {
    hero: { image: './src/assets/hero.png', profile: 'default', columns: 140, color: 'full' },
  },
})
```

```ts
/// <reference types="@ascii-fx/vite/client" />
import profileRef from 'virtual:ascii-profile/default' // { url, id }
import heroRef from 'virtual:ascii-frame/hero'         // { url, id, profile }

const profile = await loadProfile(profileRef)
const frame = await loadFrame(heroRef, profile)        // zero matching at runtime (spec §16)
```

Compiled assets cache in `node_modules/.ascii-fx`, content-addressed — rebuilt only when the font/image/options change. Static frames are explicit config, never AST magic (spec §16). Size reality: a 160-column full-color frame is ~22KB brotli; the ascii profile ~13KB brotli.
