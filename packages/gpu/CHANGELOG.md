# @ascii-fx/gpu

## 0.5.0

### Patch Changes

- Updated dependencies [[`e3cf88e`](https://github.com/Amir-Abushanab/ascii-fx/commit/e3cf88ed80ddab106894fc7b3e70309ae85e14a3)]:
  - @ascii-fx/core@0.5.0

## 0.4.0

### Minor Changes

- [#12](https://github.com/Amir-Abushanab/ascii-fx/pull/12) [`f6861a5`](https://github.com/Amir-Abushanab/ascii-fx/commit/f6861a583f9434717e7f826980ff0a57c4d06fb1) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Paint the CPU fallback with WebGL2 instead of Canvas2D.

  This is the other half of spec §12's fallback ("CPU/Worker structural matcher →
  compact glyph field → WebGL2 fullscreen composite"). The glyph field goes to a
  uint texture and one fullscreen draw samples it against the atlas, rather than
  `compositeFrame` building a full-resolution RGBA buffer on the CPU and
  `putImageData` blitting it.

  The shader is `COMPOSITE_WGSL` ported to GLSL ES 3.00 — the same compositor the
  WebGPU backend runs — so the pointer interactions come with it as the real
  shader, where the Canvas2D path approximated them at cell granularity.

  At 160×42 on an M3 Pro the fallback goes from 31.9 ms/frame to **2.8**, which is
  what the WebGPU backend posts and 0.1 ms off the scene-only floor. With the
  worker matcher, that is 42.0 → 2.8 for the whole no-GPU path.

  The canvas takes a `webgl2` context where it can, so `getContext('2d')` on it
  returns null; `compositor: 'canvas2d'` opts out and is unchanged. Canvas2D is
  still the automatic path wherever WebGL2 is unavailable, and the two are not
  pixel-identical — Canvas2D builds the grid at native cell size and scales down,
  WebGL2 samples a mipped atlas the way WebGPU does, so `auto` is also the closer
  match to the GPU output.

- [#12](https://github.com/Amir-Abushanab/ascii-fx/pull/12) [`f6861a5`](https://github.com/Amir-Abushanab/ascii-fx/commit/f6861a583f9434717e7f826980ff0a57c4d06fb1) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Move the CPU fallback's matcher off the main thread: 39.1 → 29.3 ms/frame at
  160×42 on an M3 Pro (26 → 34 fps), with what remains being the Canvas2D
  composite.

  The CPU backend now matches on a pool of workers by default — one per core less
  one, capped at 8 — and the main thread keeps only the extract and the composite.
  This is spec §11's second tier ("Worker/CPU exact structural"), and it changes
  when a live source's cells arrive, never what they are.

  `@ascii-fx/core` gains the band primitives the pool is built from:
  `reduceBand`, `matchBand`, and `bandSourceRows`. `matchBand` is the same code
  `matchFrame` runs — `matchFrame` is now a whole-frame band — so a banded match
  is byte-identical to a whole-frame one, and the new tests in `band.test.ts` and
  `match-pool.test.ts` hold it there across colour modes, alpha modes, and uneven
  splits.

  Live sources trade one frame of latency for the parallelism: a frame is
  presented while the next one matches. The first frame, static sources, and
  `captureFrame()` are matched inline and carry none. `chromatic` keeps
  frame-to-frame hysteresis and stays on the main thread.

  New `workers` option on `createAsciiRenderer`: `false` pins matching to the main
  thread, a number fixes the pool size.

### Patch Changes

- Updated dependencies [[`f6861a5`](https://github.com/Amir-Abushanab/ascii-fx/commit/f6861a583f9434717e7f826980ff0a57c4d06fb1)]:
  - @ascii-fx/core@0.4.0

## 0.3.1

### Patch Changes

- [#9](https://github.com/Amir-Abushanab/ascii-fx/pull/9) [`9299da6`](https://github.com/Amir-Abushanab/ascii-fx/commit/9299da6259d8f0b20ad56360212aba4cd05b7722) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - A `clearColor` with alpha < 1 now drops the background plane inside the grid for `mono` and chromatic frames, on both backends — the grid itself presents transparent, not just the letterbox.

  0.3.0 keyed the canvas's alphaMode on whether the output can be transparent, but the base composite still keyed the frame's ground on `color === 'foreground'`: mono cells kept an opaque background plane the clear could not touch, so a mono overlay still presented as a slab over the page. The two decisions now share one predicate — `color: 'foreground'`, or an explicit `clearColor` with alpha below 1 — so the canvas and the frame can no longer disagree about transparency.

  Under a see-through ground `mono` keeps its meaning: a fixed foreground where brightness picks the glyph and the ramp does the work, now over nothing instead of over `background`. `color: 'full'` deliberately keeps its per-cell sampled background — that plane is content, not a backdrop — so its transparency still comes from `alpha: 'mask'` cells and the letterbox. Chromatic frames follow the same rule: a transparent `clearColor` now emits glyphs with their own alpha, exactly like `color: 'foreground'` already did, including on the CPU backend, which previously drew them over an opaque backdrop.

- Updated dependencies []:
  - @ascii-fx/core@0.3.1

## 0.3.0

### Minor Changes

- [#4](https://github.com/Amir-Abushanab/ascii-fx/pull/4) [`79dda82`](https://github.com/Amir-Abushanab/ascii-fx/commit/79dda828e89d69d8e7b0f11527507fb9087f8096) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - The mono/foreground flat path now spans the charset's own tonal range instead of collapsing its top two thirds onto one glyph.

  `structural-v1` §6 mapped a flat cell's mean luma onto glyph ink coverage as `luma · 257`, i.e. onto the full 0..65535 a _completely_ inked cell would score. No ASCII glyph is completely inked: `@` in Geist Mono covers 16906/65535, about 26%. Every flat cell brighter than that targeted a coverage no glyph could reach and clamped to the densest one. A linear gradient rendered as six glyphs of ramp followed by eighteen cells of solid `@`.

  The target is now normalised into the profile's own range — `rdiv(luma · covMax, 255)`, where `covMax` is the densest glyph the profile actually has. Both the CPU matcher and the WGSL matcher changed together and remain bit-identical; the conformance suite passes unchanged.

  **This changes output** for `color: 'mono'` and `color: 'foreground'` on flat cells, which is why it is a minor rather than a patch. `color: 'full'` is unaffected (flat cells there emit the blank glyph with fg = bg = mean), and structural cells are unaffected in every mode. Charsets whose densest glyph is near-fully-inked — `ascii-blocks`, which has `█` — barely move, because for them the old ceiling was already about right. That is also why this survived to release: the charset that exposes it worst is the default one.

  `ALGORITHM.md` §6 is updated, including why the previous rationale for leaving it unnormalised does not hold: it argued the structural rerank saturates at the densest glyph in the same way, but structural cells plateau at whatever glyph matches their _shape_ — measured at `w` (11656) for a high-contrast cell, well below the `@` (16906) the old flat target reached. The two paths were never consistent.

### Patch Changes

- [#4](https://github.com/Amir-Abushanab/ascii-fx/pull/4) [`79dda82`](https://github.com/Amir-Abushanab/ascii-fx/commit/79dda828e89d69d8e7b0f11527507fb9087f8096) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - `clearColor` with alpha below 1 now presents transparent in every colour mode, not only `color: 'foreground'`.

  The canvas was configured `alphaMode: color === 'foreground' ? 'premultiplied' : 'opaque'`, so in `mono`, `full`, and `glyph` the compositor was told the canvas is opaque and discarded the alpha channel on present. A documented option was silently ignored in three of four modes, and the letterbox — the one region `clearColor` governs in those modes, since every cell there carries an opaque background by construction — painted black instead of letting the page through.

  The configuration now keys on whether the output can be transparent rather than on the colour mode: `foreground`, or an explicit `clearColor` with alpha < 1. It deliberately does _not_ key on `alpha: 'mask'`, which is the default and would make every canvas premultiplied, giving up the opaque fast path that lets the browser skip blending the canvas against the page for the common fully-opaque case.

  `setOptions` reconfigures whenever that answer changes, rather than only on the `foreground` boundary.

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

- [`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Recover from GPU device loss instead of silently rendering nothing.

  A `GPUDevice` can be taken away at any point — a browser reclaims it under memory pressure, the GPU process crashes, a driver resets. Nothing throws when it happens: submits against a lost device are validly dropped. The renderer kept its loop running, kept reporting a grid and a frame rate, and left whatever was last presented sitting on the canvas, so the failure looked like a healthy renderer with a frozen picture.

  The WebGPU renderer now watches `device.lost` and rebuilds in place on a fresh device, reconfiguring the same canvas context. `captureFrame()` waits out a rebuild rather than reading back through the dead device. When a replacement cannot be acquired the new `onDeviceLost` option fires, so the caller can swap in a fresh `<canvas>` and continue on the CPU matcher — recovery cannot cross backends by itself, since an element is bound to its first context type for good.

  Also fixes `backend: 'auto'` failing outright when WebGPU initialisation got far enough to acquire the canvas context and then failed — on a browser with a partial implementation, that bound the canvas to `'webgpu'` and left the CPU fallback with no context to take. The context is now acquired last, after everything that can fail.

  `@ascii-fx/react` handles the whole path on its own: `useAscii` now returns a `canvasKey` that changes when the canvas has to be replaced, and `<AsciiImage>`/`<AsciiVideo>`/`<AsciiCanvas>` apply it. A device loss the renderer cannot recover from remounts the canvas, which lets `backend: 'auto'` run again and land on the CPU matcher — previously `auto` chose once at construction and a GPU that died later left the component on a dead renderer. Three unrecovered losses in a row stop the cycle and surface an error instead.

  Also surfaces WebGPU failures that are not device loss. WebGPU validates `createBuffer`, `createTexture`, `createBindGroup` and every dispatch silently — errors go to an error scope or `uncapturederror`, never to a throw — so a browser whose limits or WGSL support differ could accept the whole of setup and then render nothing, while the renderer reported backend `webgpu` at a healthy frame rate. Setup now runs inside validation and internal error scopes and throws if either reports, which lets `backend: 'auto'` fall back to the exact CPU matcher; run-time errors reach the new `onError` option, which logs by default instead of vanishing.

- [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Pre-publish audit fixes, exactness batch:

  - `encodeProfile` now emits sections in ascending type order as ALGORITHM.md §14 requires (chromatic profiles previously wrote `[…, 11, 10, 9]`); the chromatic profile fixture is regenerated and a codec test pins the invariant.
  - The WGSL chromatic hysteresis compare is exact at all error magnitudes: the §C5 products need 44 bits, so the shader now compares 16-bit-split (hi, lo) pairs instead of a wrapping u32 multiply. A conformance test drives errors past the 32-bit ceiling and fails against the old compare.
  - Chromatic rendering draws the backdrop it matched against: the §C3 `background` uniforms are now written (previously hardcoded to 0, compositing over black), the letterbox clears to the backdrop, and `color: 'foreground'` selects a transparent canvas for chromatic exactly as the CPU backend already did. Pixel-truth tests cover both modes.

- [`7a97a32`](https://github.com/Amir-Abushanab/ascii-fx/commit/7a97a3262271b58d211897aece93ffdd69ce4ee0) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - WebGPU availability guards check `navigator.gpu` truthiness instead of `'gpu' in navigator`, so environments where the property exists but is undefined (privacy modes, test shims) get the clear "WebGPU is unavailable" error instead of a raw TypeError.

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
