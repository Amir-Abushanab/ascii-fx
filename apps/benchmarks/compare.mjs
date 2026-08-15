// Cross-library render-loop comparison: ascii-fx (WebGPU + CPU) vs the real
// three.js AsciiEffect and the standard canvas-ramp approach, on identical
// input (1280×720 animated scene) and an identical 160×42 glyph grid, with
// vsync disabled so throughput is visible past the refresh rate.
//
// Run: pnpm --filter @ascii-fx-internal/benchmarks compare
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeProfile } from '@ascii-fx/core'
import { buildProfile } from '@ascii-fx/compiler'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '../..')

// A shape6+LUT profile for the Harri-style matcher rows (the fixture profile
// carries structural data only).
console.log('building shape6 profile (one-time)…')
const font = new Uint8Array(await readFile(join(root, 'fixtures/fonts/GeistMono-Regular.ttf')))
const shape6Bytes = encodeProfile(buildProfile({ font, shape6: { lut: true } }).profile)
const { chromium } = await import(join(root, 'node_modules/playwright/index.mjs'))

// three's export map hides internal file paths from require.resolve; the
// pnpm symlink in our own node_modules is stable, so read files through it.
const threeRoot = join(here, 'node_modules/three')
const threeModule = join(threeRoot, 'build/three.module.js')
const asciiEffect = join(threeRoot, 'examples/jsm/effects/AsciiEffect.js')

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.asciip': 'application/octet-stream', '.wasm': 'application/wasm' }
const ROUTES = {
  '/': join(here, 'compare/index.html'),
  '/three.module.js': threeModule,
  '/three.core.js': join(threeRoot, 'build/three.core.js'),
  '/AsciiEffect.js': asciiEffect,
  '/aalib.js': join(here, 'node_modules/aalib.js/dist/aalib.js'),
  '/p5.min.js': join(here, 'node_modules/p5/lib/p5.min.js'),
  '/p5.asciify.umd.js': join(here, 'node_modules/p5.asciify/dist/p5.asciify.umd.js'),
  '/chafa.js': join(here, 'node_modules/chafa-wasm/dist/chafa.js'),
  '/chafa.wasm': join(here, 'node_modules/chafa-wasm/dist/chafa.wasm'),
  '/default.asciip': join(root, 'fixtures/profiles/default.asciip'),
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0]
  if (url === '/shape6.asciip') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(shape6Bytes)
    return
  }
  const path = ROUTES[url] ?? join(root, url)
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=metal',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
  ],
})
// Each contender runs in a fresh page so GC pressure and GPU state from one
// library cannot contaminate the next row's numbers.
const openPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', (e) => console.error('pageerror:', e.message))
  await page.goto(`http://localhost:${port}/`)
  await page.waitForFunction(() => document.getElementById('status').textContent === 'ready', { timeout: 30000 })
  return page
}

const namesPage = await openPage()
const names = await namesPage.evaluate(() => window.benchNames)
await namesPage.close()

const PASSES = 2
const byName = new Map()
for (let pass = 0; pass < PASSES; pass++) {
  for (const name of names) {
    const page = await openPage()
    const r = await page.evaluate((n) => window.runBench(n), name)
    await page.close()
    const prev = byName.get(name)
    // Keep the faster pass per row: slower passes carry interference noise.
    if (!prev || r.p50 < prev.p50) byName.set(name, r)
    console.log(
      `pass ${pass + 1}  ${r.name.padEnd(22)} grid ${String(r.grid).padEnd(20)} p50 ${r.p50.toFixed(2).padStart(7)} ms   p95 ${r.p95.toFixed(2).padStart(7)} ms   ~${r.fps.toFixed(0)} fps`,
    )
  }
}
const results = names.map((n) => byName.get(n))
await browser.close()
server.close()

const fmt = (v, digits = 2) => v.toFixed(digits)
const table = [
  '| library | glyph grid | p50 ms/frame | p95 ms/frame | ~fps |',
  '| --- | --- | ---: | ---: | ---: |',
  ...results.map((r) => `| ${r.name} | ${r.grid} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.fps, 0)} |`),
].join('\n')

const section = `## Cross-library render loop

Generated ${new Date().toISOString()} · headless Chromium, vsync disabled · identical 1280×720 animated source, 200 timed frames after 40 warmup, each library at (or as near as it allows) the same 160×42 glyph grid. Each row runs in a fresh page (no cross-library GC/GPU contamination); best of ${PASSES} passes. Times are main-thread wall clock per frame and include drawing the source scene — the baseline row is that shared floor.

${table}

Method notes: library rows are the real published packages — aalib.js 2.0 (reader → aa() → its canvas renderer), p5.asciify 0.10 on p5 2.x (WebGL textmode add-on, instance mode, redraw-driven), chafa-wasm 0.3 (raw ImageData → imageToHtml, default shape-aware symbol set), three.js AsciiEffect from three 0.185 (CanvasTexture quad, its DOM output). ascii-fx webgpu/cpu rows run the exact structural matcher with per-cell color fitting ('foreground'). The shape6-lut row is the in-repo implementation of Alex Harri's shape-vector approach (a spec-credited influence, published as writing rather than a package) with its 3-bit LUT, and the ramp-matcher row is our cheapest opt-in — both through the real core path (matchFrame → compositeFrame) on the main thread. The "ramp reference" rows are not libraries: the standard brightness-ramp technique hand-optimized with zero library overhead, the technique's floor. What each computes differs: aalib and AsciiEffect map brightness to a ramp (aalib's colored mode adds per-cell color), p5.asciify maps brightness to a colored textmode grid, chafa does shape-aware block/border selection with fg+bg colors — with Harri's descriptor, the two shape-aware influences this project credits. The spec's structural-reconstruction credit ("Ditherlab / chafa-style") is represented here by chafa-wasm: the credited 8×8 mask → Hamming prefilter → exact-rerank pipeline is chafa's documented algorithm, and no separately runnable Ditherlab artifact could be located to bench. Equal speed is not equal output.
`

const resultsPath = join(here, 'RESULTS.md')
let md = await readFile(resultsPath, 'utf8')
const marker = '## Cross-library render loop'
md = md.includes(marker) ? md.slice(0, md.indexOf(marker)).trimEnd() + '\n\n' + section : md.trimEnd() + '\n\n' + section
await writeFile(resultsPath, md)
console.log('\nRESULTS.md updated.')
