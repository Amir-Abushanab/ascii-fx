import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// A fresh random port each run: a pinned port can be held hostage by a stale
// server, and 5173 is every Vite project's default. Vite prints the resolved
// URL on startup; set PORT=xxxx when you need a stable address.
const port = process.env.PORT ? Number(process.env.PORT) : 5200 + Math.floor(Math.random() * 3800)

export default defineConfig({
  // Set when the docs site embeds the built playground under /play/.
  base: process.env.PG_BASE ?? '/',
  server: {
    port,
    strictPort: false,
  },
  preview: {
    port,
    strictPort: false,
  },
  build: {
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@ascii-fx/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@ascii-fx/gpu': fileURLToPath(new URL('../../packages/gpu/src/index.ts', import.meta.url)),
    },
  },
})
