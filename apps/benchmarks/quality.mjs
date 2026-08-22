// Approximate-matcher quality report (spec §36): glyph recall vs exact,
// reconstruction error deltas, and speedup, kept in the repo (spec §39).
// Usage: pnpm --filter @ascii-fx-internal/benchmarks run quality
import { readFile, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { FLAG_TRANSPARENT, matchFrame, reduceSource } from '@ascii-fx/core'
import { buildProfile } from '@ascii-fx/compiler'
import { upsertSection } from './resultsFile.mjs'

const font = new Uint8Array(await readFile(new URL('../../fixtures/fonts/GeistMono-Regular.ttf', import.meta.url)))
console.log('building profile with shape6 LUT (one-time)…')
const { profile } = buildProfile({ font, shape6: { lut: true } })
const profileNoLut = { ...profile, shape6: { vectors6: profile.shape6.vectors6 } }

// ————— corpus (procedural, deterministic) —————
const make = (w, h, fn) => {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y)
      const p = (y * w + x) * 4
      data[p] = r
      data[p + 1] = g
      data[p + 2] = b
      data[p + 3] = 255
    }
  return { width: w, height: h, data }
}
const W = 192
const H = 128
const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296)
const corpus = {
  gradient: make(W, H, (x) => {
    const v = Math.round((x * 255) / (W - 1))
    return [v, v, v]
  }),
  checker: make(W, H, (x, y) => {
    const v = ((x >> 3) + (y >> 3)) % 2 ? 255 : 0
    return [v, v, v]
  }),
  circle: make(W, H, (x, y) => {
    const dx = 2 * x - (W - 1)
    const dy = 2 * y - (H - 1)
    const v = dx * dx + dy * dy <= (2 * (H / 1.5)) ** 2 ? 255 : 0
    return [v, v, v]
  }),
  rings: make(W, H, (x, y) => {
    const d = Math.hypot(x - W / 2, y - H / 2)
    const v = Math.round((Math.sin(d / 6) * 0.5 + 0.5) * 255)
    return [v, Math.round(v * 0.7), 255 - v]
  }),
  noise: (() => {
    const rnd = lcg(7)
    return make(W, H, () => {
      const v = Math.floor(rnd() * 256)
      return [v, Math.floor(rnd() * 256), Math.floor(rnd() * 256)]
    })
  })(),
  typography: make(W, H, (x, y) => {
    const bar = (y > 20 && y < 32) || (y > 60 && y < 66) || (x > 30 && x < 38 && y < 100)
    const v = bar ? 235 : 15
    return [v, v, v]
  }),
}

// ————— reconstruction error (per ALGORITHM.md §10 objective) —————
const luma8 = (r, g, b) => (77 * r + 150 * g + 29 * b + 128) >> 8
function cellErrors(frame, source, columns) {
  const reduced = reduceSource(source, frame.columns, frame.rows, true)
  const SW = frame.columns * 8
  const { masksLo, masksHi } = frame.profile.structural
  const errors = new Float64Array(frame.columns * frame.rows)
  for (let cy = 0; cy < frame.rows; cy++) {
    for (let cx = 0; cx < frame.columns; cx++) {
      const ci = cy * frame.columns + cx
      if (frame.flags[ci] & FLAG_TRANSPARENT) continue
      const id = frame.glyphIds[ci]
      const lo = masksLo[id]
      const hi = masksHi[id]
      let fg
      let bg
      if (frame.colorMode === 'mono') {
        fg = [255, 255, 255]
        bg = [0, 0, 0]
      } else {
        const f = frame.foreground[ci]
        fg = [f & 0xff, (f >>> 8) & 0xff, (f >>> 16) & 0xff]
        const b = frame.background ? frame.background[ci] : 0xff000000
        bg = frame.background ? [b & 0xff, (b >>> 8) & 0xff, (b >>> 16) & 0xff] : [0, 0, 0]
      }
      let err = 0
      for (let j = 0; j < 8; j++) {
        let p = ((cy * 8 + j) * SW + cx * 8) * 4
        for (let i = 0; i < 8; i++, p += 4) {
          const k = j * 8 + i
          const on = k < 32 ? (lo >>> k) & 1 : (hi >>> (k - 32)) & 1
          const c = on ? fg : bg
          const e0 = reduced[p] - c[0]
          const e1 = reduced[p + 1] - c[1]
          const e2 = reduced[p + 2] - c[2]
          err += e0 * e0 + e1 * e1 + e2 * e2
        }
      }
      errors[ci] = err
    }
  }
  return errors
}

const pctl = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

// ————— quality sweep —————
const COLUMNS = 32
const rows = []
for (const [name, image] of Object.entries(corpus)) {
  for (const color of ['mono', 'full']) {
    const exact = matchFrame(image, { profile, columns: COLUMNS, color })
    const exactErr = cellErrors(exact, image)
    const report = (label, frame) => {
      const errs = cellErrors(frame, image)
      let agree = 0
      const deltas = []
      for (let i = 0; i < frame.glyphIds.length; i++) {
        if (frame.glyphIds[i] === exact.glyphIds[i]) agree++
        deltas.push(errs[i] - exactErr[i])
      }
      deltas.sort((a, b) => a - b)
      const n = frame.glyphIds.length
      rows.push({
        image: name,
        color,
        matcher: label,
        recall: (agree / n) * 100,
        meanDelta: deltas.reduce((a, b) => a + b, 0) / n / 64,
        p95Delta: pctl(deltas, 95) / 64,
      })
    }
    report('shape6-lut', matchFrame(image, { profile, columns: COLUMNS, color, matcher: 'shape6' }))
    report('shape6-brute', matchFrame(image, { profile: profileNoLut, columns: COLUMNS, color, matcher: 'shape6' }))
    report('ramp', matchFrame(image, { profile, columns: COLUMNS, color, matcher: 'ramp' }))
  }
}

// ————— speed —————
const perfSrc = (() => {
  const rnd = lcg(42)
  return make(640, 360, (x, y) => [
    Math.min(255, ((x / 640) * 200 + rnd() * 55) | 0),
    Math.min(255, ((y / 360) * 200 + rnd() * 55) | 0),
    128,
  ])
})()
const time = (opts) => {
  const runs = []
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now()
    matchFrame(perfSrc, { columns: 160, color: 'full', ...opts })
    runs.push(performance.now() - t0)
  }
  runs.sort((a, b) => a - b)
  return runs[4]
}
const tExact = time({ profile })
const tLut = time({ profile, matcher: 'shape6' })
const tBrute = time({ profile: profileNoLut, matcher: 'shape6' })
const tRamp = time({ profile, matcher: 'ramp' })

// ————— report —————
const fmt = (v, d = 2) => v.toFixed(d).padStart(9)
let md = `# Approximate matcher quality (spec §36)

Generated ${new Date().toISOString()} · Node ${process.version} · ${cpus()[0].model}
Reference: \`structural-v1\` (exact). Corpus: procedural ${W}×${H} images at ${COLUMNS} columns, Geist Mono ascii profile.
Deltas are per-sample squared-RGB reconstruction error increases vs exact (lower is better, 0 = identical quality).

| image | color | matcher | glyph recall % | mean Δerr/sample | p95 Δerr/sample |
| --- | --- | --- | ---: | ---: | ---: |
`
for (const r of rows) {
  md += `| ${r.image} | ${r.color} | ${r.matcher} | ${r.recall.toFixed(1)} | ${r.meanDelta.toFixed(1)} | ${r.p95Delta.toFixed(1)} |\n`
}
const worst = rows.filter((r) => r.matcher === 'shape6-lut').sort((a, b) => a.recall - b.recall)[0]
md += `
Worst shape6-lut case: **${worst.image} / ${worst.color}** at ${worst.recall.toFixed(1)}% recall.
`

const SPEED_HEADING = '## Speed (640×360 source, 160 columns, full color, p50 of 9 runs)'
const speed = `${SPEED_HEADING}

| matcher | ms | speedup vs exact |
| --- | ---: | ---: |
| structural (exact) | ${tExact.toFixed(2)} | 1.0× |
| shape6 + LUT | ${tLut.toFixed(2)} | ${(tExact / tLut).toFixed(1)}× |
| shape6 brute | ${tBrute.toFixed(2)} | ${(tExact / tBrute).toFixed(1)}× |
| ramp | ${tRamp.toFixed(2)} | ${(tExact / tRamp).toFixed(1)}× |

Per spec §5/§11 the approximate matchers are explicit opt-ins (\`matcher: 'shape6' | 'ramp'\`) and are never
selected automatically. shape6 recall is structural agreement, not a quality score — its winners can be
visually reasonable while differing from the exact winner; the error deltas above are the quality measure.
`

// This harness owns the document preamble (title through the quality table)
// and the Speed section — and nothing else. Overwriting the whole file here
// used to silently drop every section the other harnesses had written, so the
// benches only composed when this one ran first. Replace the preamble bounded
// at the first `## ` heading, then upsert Speed like everyone else.
const resultsPath = new URL('./RESULTS.md', import.meta.url)
let existing = ''
try {
  existing = await readFile(resultsPath, 'utf8')
} catch {
  // First run: no file yet.
}
const firstSection = existing.indexOf('\n## ')
const tail = firstSection === -1 ? '' : existing.slice(firstSection + 1)
await writeFile(resultsPath, `${md.trimEnd()}\n${tail ? `\n${tail}` : ''}`)
await upsertSection(SPEED_HEADING, speed)
console.log(md + '\n' + speed)
