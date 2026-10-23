---
'@ascii-fx/core': minor
'@ascii-fx/gpu': minor
'@ascii-fx/react': minor
'@ascii-fx/three': minor
---

Add palettes, post effects, two glyph sets and SVG export.

`palette: { colors, dither?, spread? }` snaps each cell's fitted colours to a list of up to 256 through an optional ordered Bayer dither. It is `palette-v1`, specified in `ALGORITHM.md §22` and integer throughout, so the WebGPU compute pass agrees bit for bit with the new `quantizeFrame()` in `@ascii-fx/core`, which the CPU backend runs. It sits between matching and the composite: changing it never rematches, and `captureFrame()` returns the snapped colours. Error diffusion is deliberately absent, since it cannot run in parallel and stay exact.

`post: { scanlines, vignette, curvature, aberration, grain, bloom }` adds screen-space effects to the composite on both shader compositors. Bloom comes from a per-cell glow field built from each glyph's coverage and colour, so it costs a pass over the grid rather than the canvas. The palette and glow compute pipelines are built the first time a palette or bloom is set, so a renderer that uses neither compiles nothing extra at startup. The Canvas2D fallback draws scanlines, vignette and bloom. With everything on, a 1080p WebGPU frame takes about 0.3 ms longer.

New built-in charsets: `blocks` (the Block Elements range) and `braille` (all 256 patterns). `frameToSVG(frame)` exports a frame as vector text with every glyph pinned to its column.

Runtime profiles (`createAsciiProfile`) now size the cell to the widest glyph instead of to `M`. Full-width glyphs such as kanji were being clipped to their left half. Monospace Latin sets are unaffected.

The WebGL2 compositor no longer samples the motion field in place of the RGBA atlas when an emoji profile is combined with `interaction: { source: 'motion' }`.

Shader comments and indentation are now stripped at build time. With these features added, the `@ascii-fx/gpu` bundle is 35.3 KB gzipped, up from 33.6 KB.
