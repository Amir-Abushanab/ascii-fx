---
'@ascii-fx/core': minor
'@ascii-fx/gpu': minor
---

Bring exact temporal reuse (spec §21) to the CPU worker pool, where it was previously WebGPU-only.

A cell's glyph, colours, and flags depend on nothing but its own 64 source samples and the options, so a cell whose samples are byte-identical to the previous match already has its answer. `matchBand` takes an optional fifth argument carrying the previous band's samples and cells and copies through the ones that did not move; comparing 256 bytes — usually one or two, since the scan stops at the first difference — costs far less than a prefilter over the charset plus a rerank.

At 320×84 over Geist Mono in `full`, a frame where nothing moved matches in 8.9 ms instead of 125.7 ms, a quarter-changed frame in 37.4 ms, and a wholly changed one in the full 129.6 ms. It is a skip, not an approximation: output is byte-identical at every fraction.

`@ascii-fx/gpu` passes `temporal` through to its workers, each of which retains its own band keyed on the grid, band bounds, colour mode, alpha mode, thresholds, palette, and profile — so a resize, an option change, or a re-init re-matches from scratch rather than serving cells matched against something else. Bands are now assigned to workers by index rather than round-robin so a worker sees the same band each frame. The CPU backend's inline path (the first frame, `captureFrame()`, and any frame the pool is too busy to take) still matches in full.
