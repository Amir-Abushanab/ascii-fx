/**
 * Type-check the TypeScript in the READMEs.
 *
 * Nothing else reads those snippets, so they rot quietly: 0.9's READMEs called a method
 * `AsciiGlyphs` never had, passed React Three Fiber's `gl` factory the wrong argument, and
 * imported a subpath that had moved. All three are type errors the moment the snippet is
 * compiled against the packages it documents.
 *
 * A README snippet is a fragment, not a program: it uses `profile`, `scene`, `video` without
 * saying where they come from. So names nobody declared are let through — they are `any`, and
 * the rest of the snippet is still held to the real types of whatever it imports. What this
 * catches is the snippet disagreeing with the library: a missing export, a method or option
 * that does not exist, an argument of the wrong shape. What it cannot catch is anything only
 * running would show.
 *
 * Mark a fence ```ts no-check to leave it out (pseudo-code, alternatives side by side).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packages = readdirSync(join(root, 'packages'))
const DOCS = ['README.md', ...packages.map((name) => `packages/${name}/README.md`)]
const OUT = '.doc-snippets'

/** Diagnostics a fragment is allowed: names it never declared, and the reader's own files. */
const FREE_NAME = new Set(['TS2304', 'TS2552', 'TS2580', 'TS2591', 'TS2693', 'TS18004'])
const isOwnFile = (code, message) =>
  code === 'TS2307' && /module '(\.{1,2}\/|\/)/.test(message.replaceAll('"', "'"))

/**
 * Which package's node_modules a snippet is compiled from: `@ascii-fx/*` is mapped to source
 * below, but `three`, `react` and `vite` are only installed where a package depends on them.
 */
function hostFor(code, lang) {
  if (code.includes('@react-three/fiber')) return 'react-three'
  const usesThree = /from 'three(\/[^']*)?'/.test(code)
  if (lang === 'tsx' || /from 'react'/.test(code)) return usesThree ? 'react-three' : 'react'
  if (usesThree) return 'three'
  if (/from 'vite'|@ascii-fx\/vite|virtual:/.test(code)) return 'vite'
  return 'gpu'
}

/** Every ```ts / ```tsx fence, with the line it starts on. */
function fences(file) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  const found = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(tsx?)\b(.*)$/.exec(lines[i])
    if (!open) continue
    const start = i + 1
    const body = []
    for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i])
    if (/\bno-check\b/.test(open[2])) continue
    found.push({ file, line: start + 1, lang: open[1], code: body.join('\n') })
  }
  return found
}

const byHost = new Map()
for (const doc of DOCS) {
  for (const snippet of fences(doc)) {
    const host = hostFor(snippet.code, snippet.lang)
    if (!byHost.has(host)) byHost.set(host, [])
    byHost.get(host).push(snippet)
  }
}

const source = (name, entry = 'index.ts') => [join(root, 'packages', name, 'src', entry)]
const paths = {
  '@ascii-fx/core': source('core'),
  '@ascii-fx/compiler': source('compiler'),
  '@ascii-fx/gpu': source('gpu'),
  '@ascii-fx/gpu/tilt': source('gpu', 'tilt.ts'),
  '@ascii-fx/gpu/webgpu': source('gpu', 'webgpu.ts'),
  '@ascii-fx/gpu/cpu': source('gpu', 'cpu.ts'),
  '@ascii-fx/react': source('react'),
  '@ascii-fx/three': source('three'),
  '@ascii-fx/react-three': source('react-three', 'index.tsx'),
  '@ascii-fx/vite': source('vite'),
}

let problems = 0
let checked = 0
const tsc = join(root, 'node_modules/.bin/tsc')

for (const [host, snippets] of byHost) {
  const dir = join(root, 'packages', host, OUT)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const origin = new Map()
    snippets.forEach((snippet, index) => {
      const name = `snippet-${index}.${snippet.lang}`
      origin.set(name, snippet)
      // `export {}` makes it a module, so top-level await and re-declared names are fine.
      writeFileSync(join(dir, name), `${snippet.code}\nexport {}\n`)
    })
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          jsx: 'react-jsx',
          // A fragment is not held to the library's own strictness: no implicit-any noise
          // from parameters it left untyped, and `null`-checks are the reader's business.
          strict: false,
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          types: [],
          paths,
        },
        // By path rather than through `types`: neither is installed in every host package.
        include: [
          '*.ts',
          '*.tsx',
          join(root, 'packages/vite/client.d.ts'),
          join(root, 'packages/gpu/node_modules/@webgpu/types/dist/index.d.ts'),
        ],
      }),
    )
    let output = ''
    try {
      execFileSync(tsc, ['-p', join(dir, 'tsconfig.json'), '--pretty', 'false'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`
      if (!output.trim()) throw err
    }
    checked += snippets.length
    for (const line of output.split('\n')) {
      const m = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
      if (!m) {
        // Anything tsc says that is not a located error is a problem with this script's
        // setup, and must not pass for "no errors".
        if (/error TS\d+/.test(line)) {
          console.error(`  ${line}`)
          problems++
        }
        continue
      }
      const [, file, row, , code, message] = m
      const snippet = origin.get(relative(dir, resolve(dir, file)))
      // An error inside the packages' own sources is the typecheck's to report, not ours.
      if (!snippet) continue
      if (FREE_NAME.has(code) || isOwnFile(code, message)) continue
      console.error(`${snippet.file}:${snippet.line + Number(row) - 1}  ${code}: ${message}`)
      problems++
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (problems > 0) {
  console.error(
    `\n${problems} problem(s) in README snippets. Fix the snippet, or mark the fence \`no-check\` if it is not meant to compile.`,
  )
  process.exit(1)
}
console.log(`README snippets: ${checked} checked against the packages' sources, all consistent.`)
