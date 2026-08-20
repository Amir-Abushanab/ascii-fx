// @ts-check
import { defineConfig } from 'astro/config'
import { ascii } from '@ascii-fx/vite'

// GitHub Pages project sites live under /<repo>/ — the deploy workflow sets
// DOCS_BASE (and optionally DOCS_SITE) accordingly.
const base = process.env.DOCS_BASE ?? '/'

export default defineConfig({
  site: process.env.DOCS_SITE,
  base,
  // The playground used to live here before it became the site itself.
  redirects: { '/play': '/' },
  vite: {
    plugins: [ascii({ config: './ascii-fx.config.ts' })],
  },
})
