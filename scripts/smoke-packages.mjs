// Install the packed tarballs into a throwaway project and actually run them.
//
// publint and are-the-types-wrong check the *shape* of what gets published — that every
// `exports` path lands on a real file and that the types resolve under each module mode.
// Neither executes a line, and the test suite aliases `@ascii-fx/*` straight to `src/`,
// so nothing in `pnpm check` ever imports the built output. A package that packs cleanly
// and throws on import would ship green. This is the step that would catch it.
//
// Two levels of assertion, because only some of these can run outside a browser:
//   • every entry point must IMPORT cleanly in bare Node. That is the SSR contract
//     (spec §18) — a top-level `window`/`navigator`/`document` touch breaks every
//     server-rendering consumer, and this is the only place that would notice.
//   • the Node-capable packages must also DO something: build a profile, match a frame,
//     round-trip a codec. Import-safety alone would still pass on a gutted bundle.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const PACKAGES = ['core', 'gpu', 'compiler', 'three', 'react', 'react-three', 'vite']

// Peers the tarballs declare but do not bring. Pinned to what the workspace develops
// against, so a smoke failure means our packaging broke, not that a peer moved.
const PEERS = {
  react: '^19.2.8',
  'react-dom': '^19.2.8',
  three: '0.185.1',
  '@react-three/fiber': '^9.7.0',
  vite: '^8.2.1',
}

// pnpm exports its own settings to child processes as npm_config_* environment
// variables, and npm warns about every one it does not recognise ("Unknown env config
// manage-package-manager-versions"). Stripping them silences that, and is what this
// script wants anyway: the throwaway install is meant to resolve the way a stranger's
// would, not to inherit whatever pnpm config happens to be in scope.
const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith('npm_config_')),
  )

const run = (cmd, args, cwd, env) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...cleanEnv(), ...env },
  })

// The body that runs inside the throwaway project. Kept as a string so the file it
// executes resolves `@ascii-fx/*` through that project's node_modules, not the repo's.
const SMOKE = `
import assert from 'node:assert/strict'

// —— import-safety: bare Node, no DOM. This is the SSR contract. ——
const entries = [
  '@ascii-fx/core',
  '@ascii-fx/core/canvas2d',
  '@ascii-fx/gpu',
  '@ascii-fx/compiler',
  '@ascii-fx/three',
  '@ascii-fx/react',
  '@ascii-fx/react-three',
  '@ascii-fx/vite',
]
for (const e of entries) {
  const m = await import(e)
  assert.ok(Object.keys(m).length > 0, e + ' exported nothing')
  console.log('  import ok: ' + e)
}

// —— behaviour: the Node-capable packages have to actually work. ——
const core = await import('@ascii-fx/core')
const { buildProfile } = await import('@ascii-fx/compiler')
const { readFile } = await import('node:fs/promises')

const font = new Uint8Array(await readFile(process.env.ASCII_FX_FONT))
const { profile } = buildProfile({ font })
assert.ok(profile.glyphCount > 1, 'built profile has no glyphs')

// A 16x16 half-dark/half-light source must match to something non-blank.
const w = 16
const h = 16
const data = new Uint8Array(w * h * 4)
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const v = y < h / 2 ? 10 : 240
    const p = (y * w + x) * 4
    data[p] = data[p + 1] = data[p + 2] = v
    data[p + 3] = 255
  }
const frame = core.matchFrame({ width: w, height: h, data }, { profile, columns: 2, color: 'full' })
assert.equal(frame.columns, 2, 'matchFrame ignored columns')
assert.ok(frame.glyphIds.some((id) => id !== 0), 'every cell matched blank')
console.log('  run ok: buildProfile + matchFrame')

// Codecs must round-trip through the published build, not just in-repo.
const bytes = core.encodeProfile(profile)
const back = core.decodeProfile(bytes)
assert.equal(back.fingerprint, profile.fingerprint, 'profile codec lost the fingerprint')
const fBytes = core.encodeFrame(frame)
assert.deepEqual(core.decodeFrame(fBytes, back).glyphIds, frame.glyphIds, 'frame codec lost cells')
// Decoding against a foreign profile has to be refused, not silently mismatched — the
// fingerprint check is the only thing standing between a stale .asciif and garbage output.
const other = buildProfile({ font, characters: ' .:-=+*#%@' }).profile
assert.throws(() => core.decodeFrame(fBytes, other), /profile/i, 'frame decoded against a foreign profile')
console.log('  run ok: profile + frame codecs round-trip, fingerprint mismatch refused')

// The renderer must degrade rather than throw where there is no GPU at all.
const { getAsciiSupport } = await import('@ascii-fx/gpu')
const support = await getAsciiSupport()
assert.equal(typeof support.webgpu, 'boolean', 'getAsciiSupport did not report webgpu')
console.log('  run ok: getAsciiSupport in a GPU-less Node process')
`

const dir = mkdtempSync(join(tmpdir(), 'ascii-fx-smoke-'))
let failed = false
try {
  console.log(`smoke: packing into ${dir}`)
  const deps = { ...PEERS }
  for (const name of PACKAGES) {
    const out = run('pnpm', ['pack', '--pack-destination', dir], join(repo, 'packages', name))
    const tgz = out.trim().split('\n').at(-1)
    deps[`@ascii-fx/${name}`] = `file:${tgz}`
  }

  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'smoke', private: true, type: 'module', dependencies: deps }, null, 2)}\n`,
  )

  // npm, not pnpm: this project must resolve like a stranger's would, with no workspace
  // links and no access to the repo's store. `--ignore-scripts` because a consumer's
  // install of these packages runs no scripts either — if one appeared, that is a finding.
  console.log('smoke: installing tarballs as a fresh consumer would')
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], dir)

  writeFileSync(join(dir, 'smoke.mjs'), SMOKE)
  process.stdout.write(
    run('node', ['smoke.mjs'], dir, {
      ASCII_FX_FONT: join(repo, 'fixtures', 'fonts', 'GeistMono-Regular.ttf'),
    }),
  )
  console.log('smoke: all entry points import and run')
} catch (err) {
  failed = true
  console.error(`\nsmoke: FAILED — ${err.message}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
