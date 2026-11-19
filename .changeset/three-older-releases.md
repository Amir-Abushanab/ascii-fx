---
'@ascii-fx/three': minor
'@ascii-fx/react-three': minor
---

Two fixes for three releases older than the one this package is developed on, both regressions in 0.10.0:

- **r170–r173: `pass.init()` threw after your own `renderer.init()`.** 0.10.0 made `init()` initialize the renderer, and those releases throw "Backend has already been initialized" from a second call. It now initializes the renderer only when nothing has.
- **r174–r177: a render target of a custom size came out resampled.** Those releases have output render targets but run the output pass from a buffer the size of the canvas, so with `width`/`height` set the glyphs were matched against a scaled copy of the scene. The output pass, and with it tone mapping and antialiasing, is now used from r178; before that the pass renders straight into its target as it did in 0.9.

The suite now runs against r170, r174, r178 and r187 (`pnpm test:three-versions`), where before only the pinned release was ever exercised.

Also:

- **Breaking:** `AsciiPass` refuses what the renderer refuses: a motion-driven `wave`, `push` or `resolution`, and `jitter` out of range. It used to accept them and do nothing; the constructor, `set()` and `setInteraction()` now throw, so code passing one of these stops working until the option is removed.
- `<AsciiEffect>` picks up a change to its `motion` option.
- When the pass cannot reach the renderer's internals, the error names the three revision that is running and the ones it was tested on; three below r170 gets one warning.
