// Copies the committed fixture profile (and the font it was compiled from,
// used as the page's UI font) into public/ for the dev server.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../../fixtures/profiles/default.asciip', import.meta.url))
const font = fileURLToPath(new URL('../../fixtures/fonts/GeistMono-Regular.ttf', import.meta.url))
const dstDir = fileURLToPath(new URL('./public/', import.meta.url))
if (!existsSync(src)) {
  console.error('fixtures/profiles/default.asciip missing — run `pnpm golden:update` at the repo root first.')
  process.exit(1)
}
mkdirSync(dstDir, { recursive: true })
copyFileSync(src, `${dstDir}default.asciip`)
copyFileSync(font, `${dstDir}GeistMono-Regular.ttf`)
