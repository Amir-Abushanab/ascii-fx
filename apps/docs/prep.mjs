// Copies the committed fixture profile (and the font it was compiled from, used
// as the playground's UI font) into public/. The playground page fetches both
// through the site base at runtime.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const profile = fileURLToPath(new URL('../../fixtures/profiles/default.asciip', import.meta.url))
const font = fileURLToPath(new URL('../../fixtures/fonts/GeistMono-Regular.ttf', import.meta.url))
const dstDir = fileURLToPath(new URL('./public/', import.meta.url))

if (!existsSync(profile)) {
  console.error(
    'fixtures/profiles/default.asciip missing — run `pnpm golden:update` at the repo root first.',
  )
  process.exit(1)
}
mkdirSync(dstDir, { recursive: true })
copyFileSync(profile, `${dstDir}default.asciip`)
copyFileSync(font, `${dstDir}GeistMono-Regular.ttf`)
