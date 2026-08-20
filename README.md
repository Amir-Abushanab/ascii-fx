# ASCII FX

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

| package | what it owns |
| --- | --- |
| [`@ascii-fx/core`](./packages/core) | types, exact `structural-v1` CPU matcher (the oracle), codecs, exports, runtime profiles |
| [`@ascii-fx/compiler`](./packages/compiler) | deterministic font rasterization, atlases, `.asciip`/`.asciif`, CLI |
| [`@ascii-fx/gpu`](./packages/gpu) | WebGPU compute matching + one-draw compositor, interactions, CPU fallback |
| [`@ascii-fx/three`](./packages/three) | `AsciiPass` for `WebGPURenderer`, instanced `AsciiGlyphs` |
| [`@ascii-fx/react`](./packages/react) | `<AsciiImage>` `<AsciiVideo>` `<AsciiCanvas>` + hooks, SSR-safe |
| [`@ascii-fx/react-three`](./packages/react-three) | `<AsciiEffect>` `<AsciiGlyphs>` for R3F |
| [`@ascii-fx/vite`](./packages/vite) | build-time profiles/frames as typed virtual modules |

Apps: `apps/docs` (the whole Astro site — the playground and pipeline explainer, with benchmarks and API reference below; deploys to GitHub Pages via `.github/workflows/deploy-docs.yml` and dogfoods the Vite plugin for its own profile), `apps/benchmarks` (CPU perf + approximate-matcher quality reports → [`RESULTS.md`](./apps/benchmarks/RESULTS.md)).

## Benchmarks

Real published libraries, identical animated 1280×720 source, same 160×42 glyph grid where each library allows it, vsync off, each row in an isolated page (best of 2 passes, headless Chromium on an M3 Pro). Only the shape-aware rows pick glyphs by shape; the rest map brightness.

| approach | picks glyphs by | p50 ms/frame | ~fps |
| --- | --- | ---: | ---: |
| **ascii-fx · WebGPU** | **shape + fitted color (exact)** | **2.7** | **370** |
| p5.asciify 0.10 (WebGL) | brightness + color | 3.0 | 333 |
| three.js AsciiEffect | brightness | 5.9 | 169 |
| aalib.js 2.0 · mono | brightness | 9.5 | 105 |
| aalib.js 2.0 · colored | brightness + color | 15.0 | 67 |
| ascii-fx · CPU fallback | shape + fitted color (exact) | 38.8 | 26 |
| chafa-wasm 0.3 | shape-aware blocks + fg/bg | 45.3 | 22 |

The scene-only floor is 2.6ms, so the WebGPU path costs the main thread ~0.1ms — matching and compositing overlap on the GPU. Full table (baseline, our approximate matchers, hand-optimized reference implementations), methodology, and regeneration: [`RESULTS.md`](./apps/benchmarks/RESULTS.md) · `pnpm --filter @ascii-fx-internal/benchmarks compare`.

## Documents

- [`ALGORITHM.md`](./ALGORITHM.md) — **normative**: every constant, bit layout, and tie-break of `structural-v1`, the binary formats, `shape6-v1`/`ramp-v1`.
- [`ascii-fx-spec.md`](./ascii-fx-spec.md) — the product spec this repo implements.

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

### Benchmarks

Every performance figure the docs site publishes is read out of `apps/benchmarks/RESULTS.md` when the site
builds — the pages hold no transcribed numbers, so regenerating a benchmark is the only way they move. The
same cross-library harness is also served at `/#run-it-yourself` for visitors to run themselves
(in an ordinary tab, so vsync caps it — indicative, not the published figure).

```bash
pnpm bench            # CPU matcher reference           → RESULTS.md
pnpm bench:compare    # cross-library render loop       → RESULTS.md  (headless, vsync off, ~4 min)
pnpm bench:quality    # approximate-matcher quality     → RESULTS.md
```

Hygiene tooling:

```bash
pnpm ncu              # dependency updates across the workspace (npm-check-updates, 7-day release cooldown via .ncurc.json)
pnpm knip             # unused files / exports / dependencies
pnpm depcruise        # dependency rules: no cycles, resolvable imports, spec §1 package boundaries enforced
```

Docs deploy: push to `main` with GitHub Pages set to "GitHub Actions" (repo Settings → Pages) and
`.github/workflows/deploy-docs.yml` publishes `apps/docs` to `https://<user>.github.io/<repo>/` automatically.

Exactness is the contract: the GPU matcher must agree with the CPU reference bit-for-bit (glyphs, colors, flags) — enforced by the conformance suite across color modes, palettes, alpha modes, uneven reductions, temporal reuse, and dirty-region rematches.
