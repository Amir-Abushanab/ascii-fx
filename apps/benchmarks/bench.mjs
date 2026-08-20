// CPU matcher benchmark harness (spec §35, Phase 1 scope: CPU metrics only).
// Usage: pnpm bench  (requires `pnpm build` and fixtures/profiles/default.asciip
// from `pnpm golden:update`).
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { decodeProfile, matchFrame } from '@ascii-fx/core'
import { markdownTable, upsertSection } from './resultsFile.mjs'

const profileBytes = await readFile(new URL('../../fixtures/profiles/default.asciip', import.meta.url))
const profile = decodeProfile(new Uint8Array(profileBytes))

// Procedural 1280×720 source: gradient + rings + deterministic noise.
const W = 1280
const H = 720
const src = new Uint8Array(W * H * 4)
{
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4
      const dx = x - W / 2
      const dy = y - H / 2
      const d = Math.sqrt(dx * dx + dy * dy)
      const ring = Math.sin(d / 24) * 0.5 + 0.5
      const noise = rnd() * 40
      src[p] = Math.min(255, ((x / W) * 200 + ring * 55 + noise) | 0)
      src[p + 1] = Math.min(255, ((y / H) * 180 + ring * 75 + noise) | 0)
      src[p + 2] = Math.min(255, (120 + ring * 120) | 0)
      src[p + 3] = 255
    }
  }
}
const source = { width: W, height: H, data: src }

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

const WARMUP = 3
const RUNS = 15
const results = []

for (const columns of [80, 120, 160, 240, 320]) {
  for (const color of ['mono', 'full']) {
    let frame
    for (let i = 0; i < WARMUP; i++) frame = matchFrame(source, { profile, columns, color })
    const times = []
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      frame = matchFrame(source, { profile, columns, color })
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    const cells = frame.columns * frame.rows
    results.push({
      grid: `${frame.columns}×${frame.rows}`,
      color,
      cells,
      p50: percentile(times, 50),
      p95: percentile(times, 95),
    })
  }
}

console.log(`\nCPU structural-v1 · ${W}×${H} source · Node ${process.version} · ${profile.glyphCount} glyphs\n`)
console.log('grid       color  cells    p50 ms   p95 ms   cells/ms')
console.log('---------  -----  -------  -------  -------  --------')
for (const r of results) {
  console.log(
    `${r.grid.padEnd(9)}  ${r.color.padEnd(5)}  ${String(r.cells).padEnd(7)}  ` +
      `${r.p50.toFixed(2).padStart(7)}  ${r.p95.toFixed(2).padStart(7)}  ${(r.cells / r.p50).toFixed(0).padStart(8)}`,
  )
}
console.log()

// Published by the docs site, so it is written to RESULTS.md rather than left
// in the console for someone to transcribe.
const section = `## CPU reference (single-threaded)

Generated ${new Date().toISOString()} · Node ${process.version} · ${W}×${H} procedural source (gradient + rings + deterministic noise) · exact \`structural-v1\` matcher · ${profile.glyphCount} glyphs · p50/p95 of ${RUNS} runs after ${WARMUP} warmup.

${markdownTable(
  ['grid', 'color', 'cells', 'p50 ms', 'p95 ms', 'cells/ms'],
  ['left', 'left', 'right', 'right', 'right', 'right'],
  results.map((r) => [
    r.grid,
    r.color,
    String(r.cells),
    r.p50.toFixed(2),
    r.p95.toFixed(2),
    (r.cells / r.p50).toFixed(0),
  ]),
)}

This is the fallback path for machines without WebGPU. It is the exact reference implementation the GPU
compute path is verified against bit-for-bit, so the fallback costs speed and never quality.
`

await upsertSection('## CPU reference (single-threaded)', section)
console.log('RESULTS.md updated.\n')
