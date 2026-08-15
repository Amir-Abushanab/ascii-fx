import { defineAsciiConfig } from '@ascii-fx/vite'

export default defineAsciiConfig({
  profiles: {
    // The docs site dogfoods the Vite plugin: this compiles at build time into
    // a hashed .asciip asset behind `virtual:ascii-profile/default`.
    // shape6 vectors (~2KB) power the live matcher comparison; no LUT needed.
    default: {
      font: '../../fixtures/fonts/GeistMono-Regular.ttf',
      charset: 'ascii',
      shape6: true,
    },
  },
})
