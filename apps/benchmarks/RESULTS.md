# Approximate matcher quality (spec §36)

Generated 2026-11-18T20:09:18.954Z · Node v26.13.1 · Apple M3 Pro
Reference: `structural-v1` (exact). Corpus: procedural 192×128 images at 32 columns, Geist Mono ascii profile.
Deltas are per-sample squared-RGB reconstruction error increases vs exact (lower is better, 0 = identical quality).

| image | color | matcher | glyph recall % | mean Δerr/sample | p95 Δerr/sample |
| --- | --- | --- | ---: | ---: | ---: |
| gradient | mono | shape6-lut | 0.0 | 3971.4 | 20439.8 |
| gradient | mono | shape6-brute | 0.0 | 3971.4 | 20439.8 |
| gradient | mono | ramp | 0.0 | 3971.4 | 20439.8 |
| gradient | full | shape6-lut | 100.0 | 0.0 | 0.0 |
| gradient | full | shape6-brute | 100.0 | 0.0 | 0.0 |
| gradient | full | ramp | 100.0 | 0.0 | 0.0 |
| checker | mono | shape6-lut | 20.0 | 11582.6 | 33528.5 |
| checker | mono | shape6-brute | 22.5 | 10668.2 | 33528.5 |
| checker | mono | ramp | 0.0 | 20879.1 | 48768.8 |
| checker | full | shape6-lut | 7.5 | 3372.2 | 7829.8 |
| checker | full | shape6-brute | 5.0 | 3385.3 | 7829.8 |
| checker | full | ramp | 0.0 | 3390.3 | 7582.7 |
| circle | mono | shape6-lut | 89.7 | 1533.4 | 12192.2 |
| circle | mono | shape6-brute | 89.7 | 1419.1 | 12192.2 |
| circle | mono | ramp | 88.8 | 1971.6 | 18288.3 |
| circle | full | shape6-lut | 88.8 | 86.0 | 42.8 |
| circle | full | shape6-brute | 88.8 | 72.7 | 1.5 |
| circle | full | ramp | 88.8 | 104.1 | 3.0 |
| rings | mono | shape6-lut | 0.0 | 3004.4 | 7785.5 |
| rings | mono | shape6-brute | 6.6 | 2304.0 | 6630.0 |
| rings | mono | ramp | 0.0 | 4911.9 | 10682.1 |
| rings | full | shape6-lut | 1.6 | 97.1 | 409.8 |
| rings | full | shape6-brute | 5.3 | 83.1 | 399.3 |
| rings | full | ramp | 0.3 | 102.8 | 430.5 |
| noise | mono | shape6-lut | 1.9 | 3712.9 | 8203.8 |
| noise | mono | shape6-brute | 2.2 | 3867.9 | 8590.3 |
| noise | mono | ramp | 1.6 | 4478.9 | 8964.8 |
| noise | full | shape6-lut | 0.6 | 337.2 | 806.1 |
| noise | full | shape6-brute | 0.9 | 336.7 | 842.3 |
| noise | full | ramp | 1.6 | 320.8 | 761.2 |
| typography | mono | shape6-lut | 10.3 | 10526.6 | 24384.4 |
| typography | mono | shape6-brute | 0.0 | 12648.1 | 26894.5 |
| typography | mono | ramp | 0.0 | 16901.2 | 32393.0 |
| typography | full | shape6-lut | 66.9 | 213.2 | 958.7 |
| typography | full | shape6-brute | 57.5 | 623.9 | 5136.3 |
| typography | full | ramp | 57.5 | 497.8 | 5136.3 |

Worst shape6-lut case: **gradient / mono** at 0.0% recall.

## Speed (640×360 source, 160 columns, full color, p50 of 9 runs)

| matcher | ms | speedup vs exact |
| --- | ---: | ---: |
| structural (exact) | 17.29 | 1.0× |
| shape6 + LUT | 10.04 | 1.7× |
| shape6 brute | 14.28 | 1.2× |
| ramp | 9.22 | 1.9× |

Per spec §5/§11 the approximate matchers are explicit opt-ins (`matchFrameShape6`, `matchFrameRamp`) and are never
selected automatically. shape6 recall is structural agreement, not a quality score — its winners can be
visually reasonable while differing from the exact winner; the error deltas above are the quality measure.

## Cross-library render loop

Generated 2026-11-18T20:45:28.158Z · headless Chromium, vsync disabled · identical 1280×720 animated source, 200 timed frames after 40 warmup, each library at (or as near as it allows) the same 160×42 glyph grid. Each row runs in a fresh page (no cross-library GC/GPU contamination); best of 2 passes. Times are main-thread wall clock per frame and include drawing the source scene — the baseline row is that shared floor.

| library | glyph grid | p50 ms/frame | p95 ms/frame | ~fps |
| --- | --- | ---: | ---: | ---: |
| baseline (no ascii) | — | 2.40 | 2.70 | 417 |
| ascii-fx webgpu | 160×42 | 2.50 | 2.80 | 400 |
| ascii-fx cpu | 160×42 | 39.30 | 41.20 | 25 |
| ascii-fx cpu (workers) | 160×42 | 29.70 | 30.60 | 34 |
| ascii-fx cpu (workers+webgl) | 160×42 | 2.30 | 3.80 | 435 |
| ascii-fx shape6-lut | 160×42 · match 9.8ms | 37.70 | 38.80 | 27 |
| ascii-fx ramp matcher | 160×42 · match 9.9ms | 38.60 | 40.00 | 26 |
| aalib.js mono | 160×42 | 8.90 | 19.10 | 112 |
| aalib.js colored | 160×42 | 13.80 | 20.80 | 72 |
| textmode.js | 106×60 | 3.70 | 4.60 | 270 |
| chafa-wasm | 160×42 | 46.80 | 52.30 | 21 |
| ramp reference mono | 160×42 | 2.60 | 2.90 | 385 |
| ramp reference color | 160×42 | 7.50 | 7.80 | 133 |
| three.js AsciiEffect | 160×42 | 6.00 | 6.50 | 167 |

Method notes: library rows are the real published packages — aalib.js 2.0 (reader → aa() → its canvas renderer), textmode.js 0.18 (WebGL, standalone; the successor its author points p5.asciify at), chafa-wasm 0.3 (raw ImageData → imageToHtml, default shape-aware symbol set), three.js AsciiEffect from three 0.187 (CanvasTexture quad, its DOM output). textmode.js is the one row not on the shared grid: it sizes cells from a font size and keeps them square, so fontSize 12 lands it on 106×60 rather than 160×42, about 5% fewer cells. ascii-fx webgpu/cpu rows run the exact structural matcher with per-cell color fitting ('foreground'). The two CPU rows differ only in which thread matches: `ascii-fx cpu` pins the matcher to the main thread (`workers: false`), `ascii-fx cpu (workers)` puts it on the default worker pool. The cells are the same bytes either way, so the gap between them is the matcher leaving the main thread and nothing else — what remains on both is the Canvas2D composite, which the worker pool does not touch. The shape6-lut row is the in-repo implementation of Alex Harri's shape-vector approach (a spec-credited influence, published as writing rather than a package) with its 3-bit LUT, and the ramp-matcher row is our cheapest opt-in — both through the real core path (matchFrame → compositeFrame) on the main thread. The "ramp reference" rows are not libraries: the standard brightness-ramp technique hand-optimized with zero library overhead, the technique's floor. What each computes differs: aalib and AsciiEffect map brightness to a ramp (aalib's colored mode adds per-cell color), textmode.js maps brightness to a colored textmode grid, chafa does shape-aware block/border selection with fg+bg colors — with Harri's descriptor, the two shape-aware influences this project credits. The spec's structural-reconstruction credit ("Ditherlab / chafa-style") is represented here by chafa-wasm: the credited 8×8 mask → Hamming prefilter → exact-rerank pipeline is chafa's documented algorithm, and no separately runnable Ditherlab artifact could be located to bench. Equal speed is not equal output.

## Cross-library render loop (emoji)

Generated 2026-11-18T20:45:28.159Z · same harness, same 1280×720 animated source, 160×90 square cells, best of 2 passes. **Not comparable with the ASCII table above** — different objective, different grid, different cell aspect.

| library | glyph grid | p50 ms/frame | p95 ms/frame | ~fps |
| --- | --- | ---: | ---: | ---: |
| ascii-fx emoji webgpu | 160×90 | 2.50 | 2.60 | 400 |
| ascii-fx emoji cpu | 160×90 | 60.80 | 62.10 | 16 |
| mean-color reference (scan) | 160×90 | 12.30 | 12.50 | 81 |
| mean-color reference (cube LUT) | 160×90 | 10.10 | 10.50 | 99 |

Method notes: **no npm package publishes image→emoji rendering.** Every emoji-mosaic project we could find — emoji-mosaic (NYT), Emojifier, the emojicam family — is an application, not a library, so there is nothing to install and bench the way aalib.js or chafa-wasm can be. The `mean-color reference` rows are therefore reference implementations of the technique all of them share: reduce each emoji to one mean colour, reduce each cell to one mean colour, take the nearest. `scan` is the plain linear search; `cube LUT` is the accelerated variant (a precomputed colour cube, as in vjsrinivas' emojicam) at 5 bits per channel. Both draw the chosen emoji's 8×8 descriptor so they pay the same compositing cost as the matcher rows. The ascii-fx rows run `chromatic-v1` — squared error against the emoji's own 64 samples composited over the backdrop — over the same curated palette. Equal speed is not equal output: mean-colour matching is a colour quantiser and cannot see sub-cell structure at all.

## CPU reference (single-threaded)

Generated 2026-11-18T20:09:02.527Z · Node v26.13.1 · 1280×720 procedural source (gradient + rings + deterministic noise) · exact `structural-v1` matcher · 95 glyphs · p50/p95 of 15 runs after 3 warmup.

| grid | color | cells | p50 ms | p95 ms | cells/ms |
| --- | --- | ---: | ---: | ---: | ---: |
| 80×21 | mono | 1680 | 6.83 | 7.46 | 246 |
| 80×21 | full | 1680 | 6.83 | 9.14 | 246 |
| 120×32 | mono | 3840 | 12.20 | 12.99 | 315 |
| 120×32 | full | 3840 | 12.37 | 12.85 | 310 |
| 160×42 | mono | 6720 | 18.11 | 18.89 | 371 |
| 160×42 | full | 6720 | 19.24 | 19.74 | 349 |
| 240×63 | mono | 15120 | 36.58 | 39.17 | 413 |
| 240×63 | full | 15120 | 41.70 | 47.59 | 363 |
| 320×84 | mono | 26880 | 60.59 | 64.45 | 444 |
| 320×84 | full | 26880 | 64.39 | 67.78 | 417 |

This is the fallback path for machines without WebGPU. It is the exact reference implementation the GPU
compute path is verified against bit-for-bit, so the fallback costs speed and never quality.
