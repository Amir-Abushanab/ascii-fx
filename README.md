# ASCII FX

[![CI](https://github.com/Amir-Abushanab/ascii-fx/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Amir-Abushanab/ascii-fx/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ascii-fx/core?label=%40ascii-fx%2Fcore)](https://www.npmjs.com/package/@ascii-fx/core)
[![bundle](https://img.shields.io/bundlephobia/minzip/@ascii-fx/core?label=core%20min%2Bgzip)](https://bundlephobia.com/package/@ascii-fx/core)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

High-fidelity, high-performance ASCII rendering for the web. Structural reconstruction — an exact 8×8 mask + Hamming-prefilter + RGB-rerank matcher — not a brightness ramp, with the whole pipeline running as WebGPU compute and a bit-identical CPU reference underneath.

```tsx
<AsciiImage src="/cat.jpg" alt="Cat" />
```

```ts
import { createAsciiRenderer } from '@ascii-fx/gpu'
const ascii = await createAsciiRenderer({ canvas, profile })
ascii.setSource(video)
ascii.start()
```

## Packages

| package                                           | what it owns                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`@ascii-fx/core`](./packages/core)               | types, exact `structural-v1` and `chromatic-v1` CPU matchers (the oracles), codecs, exports, runtime profiles |
| [`@ascii-fx/compiler`](./packages/compiler)       | deterministic font rasterization, colour-glyph profiles, atlases, `.asciip`/`.asciif`, CLI                    |
| [`@ascii-fx/gpu`](./packages/gpu)                 | WebGPU compute matching + one-draw compositor, interactions, CPU fallback                                     |
| [`@ascii-fx/three`](./packages/three)             | `AsciiPass` for `WebGPURenderer`, instanced `AsciiGlyphs`                                                     |
| [`@ascii-fx/react`](./packages/react)             | `<AsciiImage>` `<AsciiVideo>` `<AsciiCanvas>` + hooks, SSR-safe                                               |
| [`@ascii-fx/react-three`](./packages/react-three) | `<AsciiEffect>` `<AsciiGlyphs>` for R3F                                                                       |
| [`@ascii-fx/vite`](./packages/vite)               | build-time profiles/frames as typed virtual modules                                                           |

Apps: `apps/docs` (the whole Astro site — the playground and pipeline explainer, with benchmarks and API reference below; deploys to GitHub Pages via the `deploy-docs` job in `.github/workflows/ci.yml` and dogfoods the Vite plugin for its own profile), `apps/benchmarks` (CPU perf + approximate-matcher quality reports → [`RESULTS.md`](./apps/benchmarks/RESULTS.md)).

## Colour glyphs (`chromatic-v1`)

Emoji carry their own colour, which removes the move `structural-v1` is built
on: with a free foreground and background, the best colours for a mask are the
means of its two sample sets, and that is what makes its rerank exact. Baked
colour leaves nothing to fit, so `chromatic-v1` compares the cell's 64 samples
against the glyph's own, composited over the backdrop it will be drawn on.

```ts
import { buildChromaticProfile } from '@ascii-fx/compiler'
const { binary } = buildChromaticProfile({ glyphs: [{ char: '🌊', image }, ...] })
```

```ts
const frame = matchFrame(source, { profile, matcher: 'chromatic', background: [11, 11, 15] })
// colorMode 'glyph' — no colour planes, because the colour is in the glyph
```

It is a separate algorithm, not an approximation: no flat path, no polarity, no
prefilter. [`ALGORITHM.md §C`](./ALGORITHM.md) is normative, and the WebGPU path
is held to the CPU oracle bit-for-bit by the same conformance suite
`structural-v1` uses. Measurements behind each of those choices — including why
the palette is curated to ~100 glyphs, and why a prefilter turned out to cost
more quality than it saved time — are in
[`CHROMATIC-FINDINGS.md`](./CHROMATIC-FINDINGS.md). Flip **Emoji mode** in the
playground to drive it.

## Benchmarks

Real published libraries, identical animated 1280×720 source, same 160×42 glyph grid where each library allows it, vsync off, each row in an isolated page (best of 2 passes, headless Chromium on an M3 Pro). Only the shape-aware rows pick glyphs by shape; the rest map brightness.

| approach                 | picks glyphs by                  | p50 ms/frame |    ~fps |
| ------------------------ | -------------------------------- | -----------: | ------: |
| **ascii-fx · WebGPU**    | **shape + fitted color (exact)** |      **2.8** | **357** |
| textmode.js 0.17 (WebGL) | brightness + color               |          3.7 |     270 |
| three.js AsciiEffect     | brightness                       |          6.0 |     167 |
| aalib.js 2.0 · mono      | brightness                       |          9.1 |     110 |
| aalib.js 2.0 · colored   | brightness + color               |         14.7 |      68 |
| ascii-fx · CPU fallback  | shape + fitted color (exact)     |         39.8 |      25 |
| chafa-wasm 0.3           | shape-aware blocks + fg/bg       |         47.1 |      21 |

The scene-only floor is 2.6ms, so the WebGPU path costs the main thread ~0.2ms — matching and compositing overlap on the GPU. textmode.js is the exception to the shared grid: it sizes cells from a font size and keeps them square, so it runs 106×60 rather than 160×42, about 5% fewer cells. Full table (baseline, our approximate matchers, hand-optimized reference implementations), methodology, and regeneration: [`RESULTS.md`](./apps/benchmarks/RESULTS.md) · `pnpm --filter @ascii-fx-internal/benchmarks compare`.

## Documents

- [`ALGORITHM.md`](./ALGORITHM.md) — **normative**: every constant, bit layout, and tie-break of `structural-v1`, the binary formats, `shape6-v1`/`ramp-v1`.
- [`ascii-fx-spec.md`](./ascii-fx-spec.md) — the product spec this repo implements.
- [`RELEASING.md`](./RELEASING.md) — changesets, the release workflow, and the one-time npm/Pages setup.

## Develop

```bash
pnpm install
pnpm build            # all packages (tsup, ESM + d.ts)
pnpm dev              # the site at localhost:4321 — the playground, with performance and API below it
pnpm test             # node suite: unit, golden, oracle-conformance, SSR
pnpm test:gpu         # browser suite: CPU↔GPU bit-exact conformance (headless Chromium + WebGPU)
pnpm docs:build       # static docs build (set DOCS_BASE=/<repo>/ for GitHub Pages)
pnpm golden:update    # regenerate goldens after an intentional algorithm change
```

One Astro app, one page: the playground and its interactive pipeline explainer, with the benchmark tables and
the API reference folded onto the end. One dev server, one build.

### Regenerating benchmarks

Every performance figure the docs site publishes is read out of `apps/benchmarks/RESULTS.md` when the site
builds — the pages hold no transcribed numbers, so regenerating a benchmark is the only way they move. The
same cross-library harness is also served at `/#run-it-yourself` for visitors to run themselves
(in an ordinary tab, so vsync caps it — indicative, not the published figure).

```bash
pnpm bench            # CPU matcher reference           → RESULTS.md
pnpm bench:compare    # cross-library render loop       → RESULTS.md  (headless, vsync off, ~4 min)
pnpm bench:quality    # approximate-matcher quality     → RESULTS.md
```

Hygiene tooling — `pnpm check` runs all of it plus the two test suites, and is also the pre-commit hook:

```bash
pnpm format           # oxfmt (pnpm format:check in CI)
pnpm lint             # oxlint: correctness + suspicious, react-hooks deps, no stray console in shipped packages
pnpm ncu              # dependency updates across the workspace (npm-check-updates, 7-day release cooldown via .ncurc.json)
pnpm knip             # unused files / exports / dependencies
pnpm depcruise        # dependency rules: no cycles, resolvable imports, no undeclared deps, spec §1 package boundaries
pnpm package:check    # publint + are-the-types-wrong + smoke, against the packed tarballs (needs a build first)
pnpm smoke            # install the tarballs into a throwaway npm project and actually import/run them
pnpm test:coverage    # node-project coverage with thresholds (see vitest.config.ts)
```

`pnpm smoke` is the step that catches what shape checks cannot. publint and attw both read the
package without executing it, and the test suite aliases `@ascii-fx/*` straight to `src/`, so
nothing else in the repo ever imports the built output — a package that packs perfectly and throws
on import would otherwise ship green. It asserts two things: that every entry point imports cleanly
in bare Node, which is the SSR contract (a stray top-level `window` touch breaks every
server-rendering consumer), and that the Node-capable packages actually work — build a profile,
match a frame, round-trip both codecs, refuse a frame whose profile fingerprint does not match.

Dependencies age before they land. `minimumReleaseAge` in `pnpm-workspace.yaml` refuses any version
published in the last 7 days, transitive ones included — compromised releases are usually yanked
within hours-to-days, so a week's lag lets the ecosystem find the bad ones first, at the cost of
adopting genuine fixes a week late. `pnpm install --frozen-lockfile` re-checks every lockfile entry
against it, so CI enforces the same rule the lockfile was resolved under. `.ncurc.json` carries the
matching `cooldown` so `pnpm ncu` never proposes a bump the installer would then reject. Separately,
CI runs `pnpm audit --audit-level high` in a job that gates nothing — an advisory appears with no
change on our side, so it should be visible without red-lighting an unrelated PR.

Docs deploy: push to `main` with GitHub Pages set to "GitHub Actions" (repo Settings → Pages) and
the `deploy-docs` job in `.github/workflows/ci.yml` publishes `apps/docs` to `https://<user>.github.io/<repo>/` automatically.

Exactness is the contract: the GPU matcher must agree with the CPU reference bit-for-bit (glyphs, colors, flags) — enforced by the conformance suite across color modes, palettes, alpha modes, uneven reductions, temporal reuse, and dirty-region rematches.
