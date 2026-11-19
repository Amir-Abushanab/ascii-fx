---
'@ascii-fx/three': patch
'@ascii-fx/react-three': patch
---

Two fixes for three releases older than the one this package is developed on, both regressions in 0.10.0:

- **r170–r173: `pass.init()` threw after your own `renderer.init()`.** 0.10.0 made `init()` initialize the renderer, and those releases throw "Backend has already been initialized" from a second call. It now initializes the renderer only when nothing has.
- **r174–r177: a render target of a custom size came out resampled.** Those releases have output render targets but run the output pass from a buffer the size of the canvas, so with `width`/`height` set the glyphs were matched against a scaled copy of the scene. The output pass, and with it tone mapping and antialiasing, is now used from r178; before that the pass renders straight into its target as it did in 0.9.

The suite now runs against r170, r174, r178 and r187 (`pnpm test:three-versions`), where before only the pinned release was ever exercised.
