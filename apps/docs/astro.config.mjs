// @ts-check
import { defineConfig } from 'astro/config'
import { ascii } from '@ascii-fx/vite'

// GitHub Pages project sites live under /<repo>/ — the deploy workflow sets
// DOCS_BASE (and optionally DOCS_SITE) accordingly.
const base = process.env.DOCS_BASE ?? '/'

export default defineConfig({
  site: process.env.DOCS_SITE,
  base,
  // The playground used to live here before it became the site itself. Astro puts the
  // base on the redirect's own route but not on its destination, so a bare '/' sent both
  // the visitor and the canonical it writes to the domain root — which on a project Pages
  // site is somebody else's page. The destination has to carry the base itself.
  redirects: { '/play': base },
  vite: {
    plugins: [ascii({ config: './ascii-fx.config.ts' })],
  },
})
