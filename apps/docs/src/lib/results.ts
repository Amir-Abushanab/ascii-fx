// The benchmark numbers on this site are read out of apps/benchmarks/RESULTS.md
// at build time rather than transcribed into the pages. RESULTS.md is written by
// `pnpm bench:compare` / `pnpm bench:quality`, so regenerating a benchmark is the
// only way the published figures move — they cannot drift from the harness.
//
// Parsing is deliberately strict: a heading or row that stops matching throws at
// build time instead of quietly leaving a stale number on the page.
// Imported as text so Vite inlines it at build time: the file is read through
// the bundler rather than the filesystem, which keeps it working after the page
// module is bundled and makes `astro dev` hot-reload a fresh benchmark run.
import source from '../../../benchmarks/RESULTS.md?raw'

/** Everything under `heading` up to the next `## ` heading. */
function section(heading: string): string {
  const start = source.indexOf(heading)
  if (start === -1) throw new Error(`RESULTS.md is missing the "${heading}" section — regenerate it with \`pnpm bench:compare\`.`)
  const rest = source.slice(start + heading.length)
  const end = rest.indexOf('\n## ')
  return end === -1 ? rest : rest.slice(0, end)
}

/** Rows of the first markdown pipe-table in `body`, as trimmed cell arrays. */
function table(body: string, context: string): string[][] {
  const rows = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|'))
    .map((l) =>
      l
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    )
    // drop the header row and the |---|---| separator
    .filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c)))
    .slice(1)
  if (rows.length === 0) throw new Error(`RESULTS.md: no table rows found under ${context}.`)
  return rows
}

function num(value: string, context: string): number {
  const n = Number(value.replace(/[×~]/g, ''))
  if (!Number.isFinite(n)) throw new Error(`RESULTS.md: "${value}" is not a number (${context}).`)
  return n
}

// ——— cross-library render loop ———

export interface CrossLibraryRow {
  /** The harness's own row label, e.g. `ascii-fx webgpu`. Used as the join key. */
  name: string
  /** Glyph grid the library actually ran at, plus any harness note. */
  grid: string
  p50: number
  p95: number
  fps: number
}

const CROSS_HEADING = '## Cross-library render loop'
const crossBody = section(CROSS_HEADING)

export const crossLibrary: CrossLibraryRow[] = table(crossBody, CROSS_HEADING).map((cells) => {
  const [name, grid, p50, p95, fps] = cells
  return { name, grid, p50: num(p50, name), p95: num(p95, name), fps: num(fps, name) }
})

/** When the cross-library pass was measured, as an ISO string. */
export const crossLibraryGeneratedAt: string = (() => {
  const m = crossBody.match(/Generated (\S+)/)
  if (!m) throw new Error('RESULTS.md: no "Generated <timestamp>" line under the cross-library section.')
  return m[1]
})()

const crossByName = new Map(crossLibrary.map((r) => [r.name, r]))

/** Look up a benchmark row, failing the build if the harness stopped emitting it. */
export function lib(name: string): CrossLibraryRow {
  const row = crossByName.get(name)
  if (!row) {
    throw new Error(
      `RESULTS.md has no cross-library row named "${name}". Known rows: ${[...crossByName.keys()].join(', ')}. ` +
        `Either the harness renamed it or the page references a row that no longer runs.`,
    )
  }
  return row
}

/** The shared floor every row includes: drawing the source scene, no ascii. */
export const baseline = lib('baseline (no ascii)')

// ——— approximate matcher speed ———

export interface MatcherSpeedRow {
  matcher: string
  ms: number
  /** Speed multiple against the exact structural matcher. */
  speedup: number
}

const SPEED_HEADING = '## Speed ('
const speedBody = section(SPEED_HEADING)

const matcherSpeed: MatcherSpeedRow[] = table(speedBody, SPEED_HEADING).map((cells) => {
  const [matcher, ms, speedup] = cells
  return { matcher, ms: num(ms, matcher), speedup: num(speedup, matcher) }
})

const speedByName = new Map(matcherSpeed.map((r) => [r.matcher, r]))

export function matcher(name: string): MatcherSpeedRow {
  const row = speedByName.get(name)
  if (!row) {
    throw new Error(
      `RESULTS.md has no matcher-speed row named "${name}". Known rows: ${[...speedByName.keys()].join(', ')}.`,
    )
  }
  return row
}

// ——— CPU reference ———

export interface CpuReferenceRow {
  grid: string
  color: 'mono' | 'full'
  cells: number
  p50: number
  p95: number
  cellsPerMs: number
}

const CPU_HEADING = '## CPU reference (single-threaded)'
const cpuBody = section(CPU_HEADING)

export const cpuReference: CpuReferenceRow[] = table(cpuBody, CPU_HEADING).map((cells) => {
  const [grid, color, count, p50, p95, perMs] = cells
  const where = `${grid}/${color}`
  return {
    grid,
    color: color as 'mono' | 'full',
    cells: num(count, where),
    p50: num(p50, where),
    p95: num(p95, where),
    cellsPerMs: num(perMs, where),
  }
})

// ——— approximate matcher quality ———

export interface QualityRow {
  image: string
  color: string
  matcher: string
  /** Share of cells where the approximate matcher picked the exact winner. */
  recall: number
  meanErr: number
  p95Err: number
}

const QUALITY_HEADING = '# Approximate matcher quality'
const qualityBody = section(QUALITY_HEADING)

const quality: QualityRow[] = table(qualityBody, QUALITY_HEADING).map((cells) => {
  const [image, color, matcher, recall, meanErr, p95Err] = cells
  const where = `${image}/${color}/${matcher}`
  return {
    image,
    color,
    matcher,
    recall: num(recall, where),
    meanErr: num(meanErr, where),
    p95Err: num(p95Err, where),
  }
})

/** Worst-case structural recall for a matcher across the whole corpus. */
export function worstRecall(matcherName: string): QualityRow {
  const rows = quality.filter((r) => r.matcher === matcherName)
  if (rows.length === 0) throw new Error(`RESULTS.md has no quality rows for matcher "${matcherName}".`)
  return rows.reduce((worst, r) => (r.recall < worst.recall ? r : worst))
}
