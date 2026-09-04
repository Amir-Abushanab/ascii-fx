// Copies the committed fixture profile (and the font it was compiled from, used
// as the playground's UI font) into public/. The playground page fetches both
// through the site base at runtime.
//
// The social card comes along the same way. It lives in assets/ because the README and
// GitHub's repository social preview want it there too, and one copy is what keeps the
// link preview, the repository card and the hero the same picture.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const profile = fileURLToPath(new URL('../../fixtures/profiles/default.asciip', import.meta.url))
const font = fileURLToPath(new URL('../../fixtures/fonts/GeistMono-Regular.ttf', import.meta.url))
const card = fileURLToPath(new URL('../../assets/og.png', import.meta.url))
const dstDir = fileURLToPath(new URL('./public/', import.meta.url))

if (!existsSync(profile)) {
  console.error(
    'fixtures/profiles/default.asciip missing — run `pnpm golden:update` at the repo root first.',
  )
  process.exit(1)
}
if (!existsSync(card)) {
  console.error('assets/og.png missing — run `pnpm assets og` at the repo root first.')
  process.exit(1)
}
mkdirSync(dstDir, { recursive: true })
copyFileSync(profile, `${dstDir}default.asciip`)
copyFileSync(font, `${dstDir}GeistMono-Regular.ttf`)
copyFileSync(card, `${dstDir}og.png`)
