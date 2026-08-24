# @ascii-fx/compiler

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @ascii-fx/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [[`79dda82`](https://github.com/Amir-Abushanab/ascii-fx/commit/79dda828e89d69d8e7b0f11527507fb9087f8096)]:
  - @ascii-fx/core@0.3.0

## 0.2.0

### Minor Changes

- [`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add `chromatic-v1`: matching for glyph sets whose colour is baked into the glyph, such as colour emoji.

  `structural-v1` matches a 1-bit mask and fits colour to it — with foreground and background free, the best colours for a mask are the means of its two sample sets, which is what makes its rerank exact. A colour glyph leaves nothing to fit, so `chromatic-v1` compares a cell's 64 reduced samples against the glyph's own, composited over the backdrop it will be drawn on. It is a separate algorithm rather than an approximation: no flat path, no polarity, and no candidate prefilter. `ALGORITHM.md §C` is normative.

  - `@ascii-fx/core` — `matchFrameChromatic`, `matcher: 'chromatic'`, the `'glyph'` colour mode (frames carry no colour planes), optional hysteresis for video, `chromatic` profile data, and compositing for glyph-coloured frames.
  - `@ascii-fx/compiler` — `buildChromaticProfile` builds a profile from decoded colour images rather than a font, carrying an RGBA atlas alongside the coverage plane so the profile still works with the mask-fitting matchers.
  - `@ascii-fx/gpu` — a WebGPU matcher parallel over glyphs rather than samples, an RGBA atlas with its own mip chain, and a compositor branch. Held to the CPU oracle bit-for-bit by the conformance suite.
  - `@ascii-fx/react` — `matcher` and `hysteresis` reach the memo key, so changing either re-runs matching.

  `ColorMode` gains `'glyph'`; it is an output mode, and passing it to a mask-fitting matcher is an error rather than a silent fallback.

### Patch Changes

- [`6a9cf29`](https://github.com/Amir-Abushanab/ascii-fx/commit/6a9cf2924e69b8591e69213c7ac90662401e1d96) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Pre-publish audit fixes, high tier:

  - `@ascii-fx/gpu`: the option-change reset key covers `matcher`/`temporal`/`hysteresis`, so the temporal snapshot can no longer survive a matcher flip (stale black cells) and hysteresis is suppressed for one frame after any option change on both backends identically (the CPU backend now resets on change, not on every call). `resize()` schedules a repaint when no loop is running instead of leaving the canvas blank. Device-loss recovery is bounded (3 attempts per incident window) with `destroyed` re-checked across its awaits, an already-lost device is detected during initial setup before the canvas is bound (so `'auto'` can still fall back to CPU), and an unrecoverable loss without an `onDeviceLost` handler logs instead of failing silently.
  - `@ascii-fx/react`: renderer inits are serialized per hook, so a superseded init (StrictMode double-invoke, rapid profile swaps) can no longer resolve late and unconfigure the shared canvas context out from under the surviving renderer.
  - `@ascii-fx/react-three`: the profile-load effect keys sources semantically (URL/bytes-identity/fingerprint) instead of a no-op ternary, ending full AsciiPass rebuilds on every parent re-render for inline and buffer sources; `<AsciiGlyphs>` skips frames from a previous grid during prop transitions instead of throwing to the nearest error boundary.
  - `@ascii-fx/compiler`: the CLI validates `--color`/`--alpha` against their enums and `--columns`/`--rows` as positive integers — typos now fail loudly instead of writing silently wrong or unloadable artifacts with exit 0.
  - `@ascii-fx/vite`: every stored path and emitted specifier goes through Vite's `normalizePath`, making font/image/config invalidation work on Windows; cache writes are atomic (temp + rename) and an unreadable cache entry is treated as a miss and rebuilt instead of wedging every future build.

- [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Pre-publish audit fixes, mechanical batch:

  - `@ascii-fx/compiler` ships its fontkit type shim in `dist/` and references it from the types entry, so consumers with `skipLibCheck: false` no longer hit TS2307 on the published declarations. New `COMPILER_PACKAGE_VERSION` export: the installed package version, read from the manifest at runtime.
  - `@ascii-fx/vite` salts both build-cache keys with `COMPILER_PACKAGE_VERSION`, so caches in `node_modules/.ascii-fx` never outlive the compiler that wrote them.
  - `@ascii-fx/react-three` declares the `react` peer it can actually satisfy (`^19`, required by `@react-three/fiber` v9) and includes `matcher`/`hysteresis` in the option-change key, so changing only those no longer silently no-ops.
  - `@ascii-fx/gpu` destroys the RGBA atlas texture in `AsciiEngine.destroy()`, closing a per-rebuild leak on shared-device hosts.
  - `@ascii-fx/three` disposes the `InstancedMesh` in `AsciiGlyphs.dispose()`, releasing its instanced attributes deterministically.
  - `@ascii-fx/react` drops a needless `<AsciiCanvas>` source-effect re-run on `renderMode` changes.

- Updated dependencies [[`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2)]:
  - @ascii-fx/core@0.2.0
