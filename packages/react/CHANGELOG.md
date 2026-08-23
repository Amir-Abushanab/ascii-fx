# @ascii-fx/react

## 0.2.0

### Minor Changes

- [#1](https://github.com/Amir-Abushanab/ascii-fx/pull/1) [`0a58244`](https://github.com/Amir-Abushanab/ascii-fx/commit/0a58244f4ad2549489e2b9abebba4e59aa7c82ab) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - React: add `onError` to `<AsciiImage>`, `<AsciiVideo>` and `<AsciiCanvas>`.

  The components already degrade correctly when the renderer cannot be built — the `<img>`/`<video>` fallback is on screen and stays there — but they discarded the error `useAscii` had already computed, so an app had no way to tell a silent degrade from a success. Hook users could read `error` off `useAscii`; component users had nothing. `onError` fires once per distinct failure, for both a failed renderer init and a GPU device loss that could not be recovered from.

### Patch Changes

- [`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add `chromatic-v1`: matching for glyph sets whose colour is baked into the glyph, such as colour emoji.

  `structural-v1` matches a 1-bit mask and fits colour to it — with foreground and background free, the best colours for a mask are the means of its two sample sets, which is what makes its rerank exact. A colour glyph leaves nothing to fit, so `chromatic-v1` compares a cell's 64 reduced samples against the glyph's own, composited over the backdrop it will be drawn on. It is a separate algorithm rather than an approximation: no flat path, no polarity, and no candidate prefilter. `ALGORITHM.md §C` is normative.

  - `@ascii-fx/core` — `matchFrameChromatic`, `matcher: 'chromatic'`, the `'glyph'` colour mode (frames carry no colour planes), optional hysteresis for video, `chromatic` profile data, and compositing for glyph-coloured frames.
  - `@ascii-fx/compiler` — `buildChromaticProfile` builds a profile from decoded colour images rather than a font, carrying an RGBA atlas alongside the coverage plane so the profile still works with the mask-fitting matchers.
  - `@ascii-fx/gpu` — a WebGPU matcher parallel over glyphs rather than samples, an RGBA atlas with its own mip chain, and a compositor branch. Held to the CPU oracle bit-for-bit by the conformance suite.
  - `@ascii-fx/react` — `matcher` and `hysteresis` reach the memo key, so changing either re-runs matching.

  `ColorMode` gains `'glyph'`; it is an output mode, and passing it to a mask-fitting matcher is an error rather than a silent fallback.

- [`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Recover from GPU device loss instead of silently rendering nothing.

  A `GPUDevice` can be taken away at any point — a browser reclaims it under memory pressure, the GPU process crashes, a driver resets. Nothing throws when it happens: submits against a lost device are validly dropped. The renderer kept its loop running, kept reporting a grid and a frame rate, and left whatever was last presented sitting on the canvas, so the failure looked like a healthy renderer with a frozen picture.

  The WebGPU renderer now watches `device.lost` and rebuilds in place on a fresh device, reconfiguring the same canvas context. `captureFrame()` waits out a rebuild rather than reading back through the dead device. When a replacement cannot be acquired the new `onDeviceLost` option fires, so the caller can swap in a fresh `<canvas>` and continue on the CPU matcher — recovery cannot cross backends by itself, since an element is bound to its first context type for good.

  Also fixes `backend: 'auto'` failing outright when WebGPU initialisation got far enough to acquire the canvas context and then failed — on a browser with a partial implementation, that bound the canvas to `'webgpu'` and left the CPU fallback with no context to take. The context is now acquired last, after everything that can fail.

  `@ascii-fx/react` handles the whole path on its own: `useAscii` now returns a `canvasKey` that changes when the canvas has to be replaced, and `<AsciiImage>`/`<AsciiVideo>`/`<AsciiCanvas>` apply it. A device loss the renderer cannot recover from remounts the canvas, which lets `backend: 'auto'` run again and land on the CPU matcher — previously `auto` chose once at construction and a GPU that died later left the component on a dead renderer. Three unrecovered losses in a row stop the cycle and surface an error instead.

  Also surfaces WebGPU failures that are not device loss. WebGPU validates `createBuffer`, `createTexture`, `createBindGroup` and every dispatch silently — errors go to an error scope or `uncapturederror`, never to a throw — so a browser whose limits or WGSL support differ could accept the whole of setup and then render nothing, while the renderer reported backend `webgpu` at a healthy frame rate. Setup now runs inside validation and internal error scopes and throws if either reports, which lets `backend: 'auto'` fall back to the exact CPU matcher; run-time errors reach the new `onError` option, which logs by default instead of vanishing.

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

- [#1](https://github.com/Amir-Abushanab/ascii-fx/pull/1) [`0a58244`](https://github.com/Amir-Abushanab/ascii-fx/commit/0a58244f4ad2549489e2b9abebba4e59aa7c82ab) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - React: reduced-motion reads correctly on the first client render, and `<AsciiVideo>` reliably pauses on unmount.

  `usePrefersReducedMotion` moves from state-plus-effect to `useSyncExternalStore`. It used to render `false`, then set the real value in an effect — so a user who asks for reduced motion got one animated frame and a re-render before the preference took hold. The store form reads the media query on the first client render and declares an explicit `false` server snapshot, so hydration still matches.

  The continuous-playback cleanup captured the media element at effect setup instead of reading `mediaRef.current` at teardown, where React may already have detached the ref and the `pause()` would silently no-op.

- Updated dependencies [[`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb), [`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2), [`7a97a32`](https://github.com/Amir-Abushanab/ascii-fx/commit/7a97a3262271b58d211897aece93ffdd69ce4ee0), [`6a9cf29`](https://github.com/Amir-Abushanab/ascii-fx/commit/6a9cf2924e69b8591e69213c7ac90662401e1d96), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2)]:
  - @ascii-fx/core@0.2.0
  - @ascii-fx/gpu@0.2.0
