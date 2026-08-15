// Builds the playground with the right base path and embeds it into the docs
// dist under /play/, so the deployed site ships the full control-room demo.
import { execSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const docsBase = process.env.DOCS_BASE ?? '/'
const pgBase = `${docsBase.endsWith('/') ? docsBase : docsBase + '/'}play/`
const playgroundDir = fileURLToPath(new URL('../playground', import.meta.url))
const target = fileURLToPath(new URL('./dist/play', import.meta.url))

console.log(`[docs] building playground with base ${pgBase}…`)
execSync('pnpm run build', { cwd: playgroundDir, stdio: 'inherit', env: { ...process.env, PG_BASE: pgBase } })
if (existsSync(target)) rmSync(target, { recursive: true })
cpSync(fileURLToPath(new URL('../playground/dist', import.meta.url)), target, { recursive: true })
console.log('[docs] playground embedded at /play/')
