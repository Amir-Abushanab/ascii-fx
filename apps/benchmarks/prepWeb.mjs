// Copies the cross-library harness into the docs site so visitors can run the
// comparison on their own machine. The docs page frames these files; the CLI
// benchmark serves the very same ones from apps/benchmarks, so "run it yourself"
// and the published table are the same code.
//
// Run: pnpm --filter @ascii-fx-internal/benchmarks run prep:web
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildShape6Profile, HARNESS_FILES, HARNESS_PACKAGE_DISTS, repoRoot } from './harnessAssets.mjs'

const target = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../docs/public/bench/', import.meta.url))

const missing = []

mkdirSync(target, { recursive: true })

for (const [name, source] of Object.entries(HARNESS_FILES)) {
  if (!existsSync(source)) {
    missing.push(`${name} (expected at ${source})`)
    continue
  }
  const dest = join(target, name)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(source, dest)
}

// The harness imports the built packages through its importmap, so it needs the
// same dist output that consumers get — not the TypeScript sources.
for (const pkg of HARNESS_PACKAGE_DISTS) {
  const source = join(repoRoot, 'packages', pkg, 'dist')
  if (!existsSync(source)) {
    missing.push(`packages/${pkg}/dist (run \`pnpm build\` first)`)
    continue
  }
  cpSync(source, join(target, 'packages', pkg, 'dist'), { recursive: true })
}

if (missing.length > 0) {
  console.error('[bench] cannot assemble the in-browser harness:')
  for (const m of missing) console.error(`  - ${m}`)
  process.exit(1)
}

// Compiling the shape6 LUT takes a few seconds, so only redo it when absent.
// Delete public/bench/shape6.asciip (or the whole directory) to force a rebuild.
const shape6 = join(target, 'shape6.asciip')
if (!existsSync(shape6) || statSync(shape6).size === 0) {
  console.log('[bench] compiling shape6 profile…')
  writeFileSync(shape6, await buildShape6Profile())
}

console.log(`[bench] harness ready at ${target}`)
