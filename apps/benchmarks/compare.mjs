// Cross-library render-loop comparison: ascii-fx (WebGPU + CPU) vs the real
// three.js AsciiEffect and the standard canvas-ramp approach, on identical
// input (1280×720 animated scene) and an identical 160×42 glyph grid, with
// vsync disabled so throughput is visible past the refresh rate.
//
// Run: pnpm --filter @ascii-fx-internal/benchmarks compare
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { buildShape6Profile, HARNESS_FILES, repoRoot as root } from './harnessAssets.mjs'
import { upsertSection } from './resultsFile.mjs'

// A shape6+LUT profile for the Harri-style matcher rows (the fixture profile
// carries structural data only).
console.log('building shape6 profile (one-time)…')
const shape6Bytes = await buildShape6Profile()
const { chromium } = await import(join(root, 'node_modules/playwright/index.mjs'))

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.asciip': 'application/octet-stream', '.wasm': 'application/wasm' }
// The harness fetches its assets relative to index.html, which this server
// mounts at the root; the same files are copied under /bench/ for the docs site.
const ROUTES = Object.fromEntries(Object.entries(HARNESS_FILES).map(([name, path]) => [`/${name}`, path]))
ROUTES['/'] = HARNESS_FILES['index.html']

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
const kinds = await namesPage.evaluate(() => window.benchKinds)
await namesPage.close()

const PASSES = 2
const EMOJI_GRID = '160×90'
const byName = new Map()
for (let pass = 0; pass < PASSES; pass++) {
  for (const name of names) {
    const page = await openPage()
    const r = await page.evaluate((n) => window.runBench(n), name)
    await page.close()
    if (r.skipped) {
      if (pass === 0) console.log(`pass ${pass + 1}  ${name.padEnd(32)} skipped (no compiled emoji palette)`)
      continue
    }
    const prev = byName.get(name)
    // Keep the faster pass per row: slower passes carry interference noise.
    if (!prev || r.p50 < prev.p50) byName.set(name, r)
    console.log(
      `pass ${pass + 1}  ${r.name.padEnd(32)} grid ${String(r.grid).padEnd(20)} p50 ${r.p50.toFixed(2).padStart(7)} ms   p95 ${r.p95.toFixed(2).padStart(7)} ms   ~${r.fps.toFixed(0)} fps`,
    )
  }
}
const results = names.filter((n) => byName.has(n)).map((n) => byName.get(n))
const asciiResults = results.filter((r) => kinds[r.name] !== 'emoji')
const emojiResults = results.filter((r) => kinds[r.name] === 'emoji')
await browser.close()
server.close()

const fmt = (v, digits = 2) => v.toFixed(digits)
const tableOf = (rows) =>
  [
    '| library | glyph grid | p50 ms/frame | p95 ms/frame | ~fps |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows.map((r) => `| ${r.name} | ${r.grid} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.fps, 0)} |`),
  ].join('\n')
const table = tableOf(asciiResults)

const section = `## Cross-library render loop

Generated ${new Date().toISOString()} · headless Chromium, vsync disabled · identical 1280×720 animated source, 200 timed frames after 40 warmup, each library at (or as near as it allows) the same 160×42 glyph grid. Each row runs in a fresh page (no cross-library GC/GPU contamination); best of ${PASSES} passes. Times are main-thread wall clock per frame and include drawing the source scene — the baseline row is that shared floor.

${table}

Method notes: library rows are the real published packages — aalib.js 2.0 (reader → aa() → its canvas renderer), textmode.js 0.17 (WebGL, standalone; the successor its author points p5.asciify at), chafa-wasm 0.3 (raw ImageData → imageToHtml, default shape-aware symbol set), three.js AsciiEffect from three 0.185 (CanvasTexture quad, its DOM output). textmode.js is the one row not on the shared grid: it sizes cells from a font size and keeps them square, so fontSize 12 lands it on 106×60 rather than 160×42, about 5% fewer cells. ascii-fx webgpu/cpu rows run the exact structural matcher with per-cell color fitting ('foreground'). The shape6-lut row is the in-repo implementation of Alex Harri's shape-vector approach (a spec-credited influence, published as writing rather than a package) with its 3-bit LUT, and the ramp-matcher row is our cheapest opt-in — both through the real core path (matchFrame → compositeFrame) on the main thread. The "ramp reference" rows are not libraries: the standard brightness-ramp technique hand-optimized with zero library overhead, the technique's floor. What each computes differs: aalib and AsciiEffect map brightness to a ramp (aalib's colored mode adds per-cell color), textmode.js maps brightness to a colored textmode grid, chafa does shape-aware block/border selection with fg+bg colors — with Harri's descriptor, the two shape-aware influences this project credits. The spec's structural-reconstruction credit ("Ditherlab / chafa-style") is represented here by chafa-wasm: the credited 8×8 mask → Hamming prefilter → exact-rerank pipeline is chafa's documented algorithm, and no separately runnable Ditherlab artifact could be located to bench. Equal speed is not equal output.
`

await upsertSection('## Cross-library render loop', section)

// The emoji rows match a different objective on a different (square-celled)
// grid, so they get their own section rather than sharing a table whose times
// would invite a comparison that does not hold.
if (emojiResults.length > 0) {
  const emojiSection = `## Cross-library render loop (emoji)

Generated ${new Date().toISOString()} · same harness, same 1280×720 animated source, ${EMOJI_GRID} square cells, best of ${PASSES} passes. **Not comparable with the ASCII table above** — different objective, different grid, different cell aspect.

${tableOf(emojiResults)}

Method notes: **no npm package publishes image→emoji rendering.** Every emoji-mosaic project we could find — emoji-mosaic (NYT), Emojifier, the emojicam family — is an application, not a library, so there is nothing to install and bench the way aalib.js or chafa-wasm can be. The \`mean-color reference\` rows are therefore reference implementations of the technique all of them share: reduce each emoji to one mean colour, reduce each cell to one mean colour, take the nearest. \`scan\` is the plain linear search; \`cube LUT\` is the accelerated variant (a precomputed colour cube, as in vjsrinivas' emojicam) at 5 bits per channel. Both draw the chosen emoji's 8×8 descriptor so they pay the same compositing cost as the matcher rows. The ascii-fx rows run \`chromatic-v1\` — squared error against the emoji's own 64 samples composited over the backdrop — over the same curated palette. Equal speed is not equal output: mean-colour matching is a colour quantiser and cannot see sub-cell structure at all.
`
  await upsertSection('## Cross-library render loop (emoji)', emojiSection)
}
console.log('\nRESULTS.md updated.')
