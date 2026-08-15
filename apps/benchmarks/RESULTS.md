# Approximate matcher quality (spec §36)

Generated 2026-08-10T08:16:12.196Z · Node v24.19.0 · Apple M3 Pro
Reference: `structural-v1` (exact). Corpus: procedural 192×128 images at 32 columns, Geist Mono ascii profile.
Deltas are per-sample squared-RGB reconstruction error increases vs exact (lower is better, 0 = identical quality).

| image | color | matcher | glyph recall % | mean Δerr/sample | p95 Δerr/sample |
| --- | --- | --- | ---: | ---: | ---: |
| gradient | mono | shape6-lut | 100.0 | 0.0 | 0.0 |
| gradient | mono | shape6-brute | 100.0 | 0.0 | 0.0 |
| gradient | mono | ramp | 100.0 | 0.0 | 0.0 |
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
| rings | mono | shape6-lut | 0.3 | 2979.8 | 7785.5 |
| rings | mono | shape6-brute | 6.9 | 2279.3 | 6494.5 |
| rings | mono | ramp | 0.3 | 4887.3 | 10682.1 |
| rings | full | shape6-lut | 1.6 | 97.1 | 409.8 |
| rings | full | shape6-brute | 5.3 | 83.1 | 399.3 |
| rings | full | ramp | 0.3 | 102.8 | 430.5 |
| noise | mono | shape6-lut | 1.9 | 3712.9 | 8203.8 |
| noise | mono | shape6-brute | 2.2 | 3867.9 | 8590.3 |
| noise | mono | ramp | 1.6 | 4478.9 | 8964.8 |
| noise | full | shape6-lut | 0.6 | 337.2 | 806.1 |
| noise | full | shape6-brute | 0.9 | 336.7 | 842.3 |
| noise | full | ramp | 1.6 | 320.8 | 761.2 |
| typography | mono | shape6-lut | 67.8 | 5887.3 | 24384.4 |
| typography | mono | shape6-brute | 57.5 | 8008.8 | 26894.5 |
| typography | mono | ramp | 57.5 | 12261.9 | 32393.0 |
| typography | full | shape6-lut | 66.9 | 213.2 | 958.7 |
| typography | full | shape6-brute | 57.5 | 623.9 | 5136.3 |
| typography | full | ramp | 57.5 | 497.8 | 5136.3 |

Worst shape6-lut case: **rings / mono** at 0.3% recall.

## Speed (640×360 source, 160 columns, full color, p50 of 9 runs)

| matcher | ms | speedup vs exact |
| --- | ---: | ---: |
| structural (exact) | 34.21 | 1.0× |
| shape6 + LUT | 9.60 | 3.6× |
| shape6 brute | 13.91 | 2.5× |
| ramp | 8.89 | 3.9× |

Per spec §5/§11 the approximate matchers are explicit opt-ins (`matcher: 'shape6' | 'ramp'`) and are never
selected automatically. shape6 recall is structural agreement, not a quality score — its winners can be
visually reasonable while differing from the exact winner; the error deltas above are the quality measure.

## Cross-library render loop

Generated 2026-08-15T00:53:26.921Z · headless Chromium, vsync disabled · identical 1280×720 animated source, 200 timed frames after 40 warmup, each library at (or as near as it allows) the same 160×42 glyph grid. Each row runs in a fresh page (no cross-library GC/GPU contamination); best of 2 passes. Times are main-thread wall clock per frame and include drawing the source scene — the baseline row is that shared floor.

| library | glyph grid | p50 ms/frame | p95 ms/frame | ~fps |
| --- | --- | ---: | ---: | ---: |
| baseline (no ascii) | — | 2.60 | 3.00 | 385 |
| ascii-fx webgpu | 160×42 | 2.70 | 3.20 | 370 |
| ascii-fx cpu | 160×42 | 38.80 | 40.80 | 26 |
| ascii-fx shape6-lut | 160×42 · match 9.7ms | 37.70 | 39.90 | 27 |
| ascii-fx ramp matcher | 160×42 · match 9.4ms | 36.60 | 39.70 | 27 |
| aalib.js mono | 160×42 | 9.50 | 19.00 | 105 |
| aalib.js colored | 160×42 | 15.00 | 34.30 | 67 |
| p5.asciify | 106×60 | 3.00 | 3.30 | 333 |
| chafa-wasm | 160×42 | 45.30 | 50.20 | 22 |
| ramp reference mono | 160×42 | 2.80 | 3.10 | 357 |
| ramp reference color | 160×42 | 8.00 | 8.50 | 125 |
| three.js AsciiEffect | 160×42 | 5.90 | 6.40 | 169 |

Method notes: library rows are the real published packages — aalib.js 2.0 (reader → aa() → its canvas renderer), p5.asciify 0.10 on p5 2.x (WebGL textmode add-on, instance mode, redraw-driven), chafa-wasm 0.3 (raw ImageData → imageToHtml, default shape-aware symbol set), three.js AsciiEffect from three 0.185 (CanvasTexture quad, its DOM output). ascii-fx webgpu/cpu rows run the exact structural matcher with per-cell color fitting ('foreground'). The shape6-lut row is the in-repo implementation of Alex Harri's shape-vector approach (a spec-credited influence, published as writing rather than a package) with its 3-bit LUT, and the ramp-matcher row is our cheapest opt-in — both through the real core path (matchFrame → compositeFrame) on the main thread. The "ramp reference" rows are not libraries: the standard brightness-ramp technique hand-optimized with zero library overhead, the technique's floor. What each computes differs: aalib and AsciiEffect map brightness to a ramp (aalib's colored mode adds per-cell color), p5.asciify maps brightness to a colored textmode grid, chafa does shape-aware block/border selection with fg+bg colors — with Harri's descriptor, the two shape-aware influences this project credits. The spec's structural-reconstruction credit ("Ditherlab / chafa-style") is represented here by chafa-wasm: the credited 8×8 mask → Hamming prefilter → exact-rerank pipeline is chafa's documented algorithm, and no separately runnable Ditherlab artifact could be located to bench. Equal speed is not equal output.
