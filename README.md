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

Apps: `apps/docs` (Astro site — live demos with explanations, deploys to GitHub Pages via `.github/workflows/deploy-docs.yml`; it dogfoods the Vite plugin for its own profile), `apps/playground` (kitchen-sink demo: backends, interactions, animation), `apps/benchmarks` (CPU perf + approximate-matcher quality reports → [`RESULTS.md`](./apps/benchmarks/RESULTS.md)).

## Documents

- [`ALGORITHM.md`](./ALGORITHM.md) — **normative**: every constant, bit layout, and tie-break of `structural-v1`, the binary formats, `shape6-v1`/`ramp-v1`.
- [`ascii-fx-spec.md`](./ascii-fx-spec.md) — the product spec this repo implements.

## Develop

```bash
pnpm install
pnpm build            # all packages (tsup, ESM + d.ts)
pnpm test             # node suite: unit, golden, oracle-conformance, SSR
pnpm test:gpu         # browser suite: CPU↔GPU bit-exact conformance (headless Chromium + WebGPU)
pnpm bench            # CPU matcher benchmarks
pnpm --filter @ascii-fx-internal/benchmarks run quality   # approximate-matcher quality report
pnpm playground       # kitchen-sink demo at localhost:5273 (pinned, strictPort)
pnpm docs:dev         # docs site (Astro) at localhost:4321
pnpm docs:build       # static docs build (set DOCS_BASE=/<repo>/ for GitHub Pages)
pnpm golden:update    # regenerate goldens after an intentional algorithm change
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
