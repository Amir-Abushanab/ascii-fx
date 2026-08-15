// @ts-check
import { defineConfig } from 'astro/config'
import { ascii } from '@ascii-fx/vite'

// GitHub Pages project sites live under /<repo>/ — the deploy workflow sets
// DOCS_BASE (and optionally DOCS_SITE) accordingly.
export default defineConfig({
  site: process.env.DOCS_SITE,
  base: process.env.DOCS_BASE ?? '/',
  vite: {
    plugins: [ascii({ config: './ascii-fx.config.ts' })],
  },
})
