# @ascii-fx/vite

## 0.9.1

### Patch Changes

- [#32](https://github.com/Amir-Abushanab/ascii-fx/pull/32) [`7b511ca`](https://github.com/Amir-Abushanab/ascii-fx/commit/7b511ca89a6650ef4ba2fe194dedbf3865ff0a7e) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Built with tsup 9. The published output is byte-identical to 0.9.0's, so nothing changes for consumers.
- Updated dependencies [[`7b511ca`](https://github.com/Amir-Abushanab/ascii-fx/commit/7b511ca89a6650ef4ba2fe194dedbf3865ff0a7e)]:
  - @ascii-fx/core@0.9.1
  - @ascii-fx/compiler@0.9.1

## 0.9.0

### Minor Changes

- [#29](https://github.com/Amir-Abushanab/ascii-fx/pull/29) [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Non-Latin scripts: grapheme glyphs, OpenType shaping, Arabic sets with optional joining, font collections, any-width fonts, bidi-safe exports, and charsets far past 2048 glyphs on the GPU.

  **Breaking:** a custom `characters` string now splits into grapheme clusters, not code points, so `'क्ष'`, `'é'` and `'👍🏽'` are one glyph each, and an array's elements are glyphs as given rather than being split further. Sets of single-code-point characters resolve exactly as before.

  - **Shaping.** The compiler shapes any glyph that isn't one code point the font maps (a conjunct, a letter with marks), using the font's own OpenType rules via fontkit, and rasterizes the shaped run. Single mapped code points rasterize exactly as before, so existing profiles are byte-identical. Where a font carries both OpenType and Apple `morx` tables, the compiler shapes with OpenType: fontkit prefers `morx`, and its `morx` engine never returns on some input (Thai sara am in Ayuthaya). Verified with Arabic, Hebrew, Thai, Devanagari, Cyrillic and Tai Le, Tai Tham and Tai Viet system fonts. Because shaped glyphs depend on fontkit's code as well as the font, golden fixtures built from committed OFL Noto subsets (Arabic, Devanagari, Thai) and Geist's combining marks pin every shaped glyph's mask, coverage and atlas pixels, so a fontkit update that changes one fails CI and names it.
  - **Arabic.** New built-in sets `arabic` (the 40 isolated letterforms, which never connect) and `arabic-joined` (every final, initial and medial form, plus tatweel). Joining is opt-in by choosing the set. In `arabic-joined`, joining forms are drawn with kashida to the edge they join at, so adjacent cells' strokes meet. Both sets use presentation-form code points, which text viewers display as written. A form is drawn by shaping its base letter in context (`shapingText`), in the compiler and in browser-built profiles alike, so it comes from the profile's own font even when that font leaves the presentation block unmapped, rather than from whatever fallback font maps it. `joiningSide`, `kashidaText`, `glyphOffset` and `shapingText` in core are the reference.
  - **Any-width fonts.** The compiler no longer requires a monospace font. The cell is the widest glyph's and the rest are centred (or pushed to the edge they join at), so Arabic in any font and kanji next to Latin compile. Monospace sets compile byte-for-byte as before. Runtime profiles now follow the same rule, which fixes full-width glyphs such as kanji being clipped to their left half.
  - **Font collections.** `face` (a PostScript name or an index) picks a face from a `.ttc`/`.otc`, through `buildProfile`, the Vite config and `--face` on the CLI. CJK and Arabic system fonts nearly all ship this way.
  - **Exports.** `frameToText`, `frameToAnsi`, `frameToHTML` and `frameToSVG` force rows containing right-to-left glyphs into cell order (LRO/PDF in text, `unicode-bidi: bidi-override` in HTML and SVG), where a viewer's bidi algorithm would otherwise reverse them. A set of full-width glyphs writes blanks as U+3000 so columns align in a terminal. Latin exports are unchanged.
  - **GPU glyph limit.** The WebGPU matcher's per-glyph workgroup array is gone: each lane keeps its own top 8 and lane 0 merges them, which is the same result, verified bit for bit up to 3000 glyphs, and no slower for small sets. `MAX_GPU_GLYPHS` is now the 16-bit glyph id (65535). In practice the limit is the glyph atlas fitting in one texture (about 4,000 kanji-sized glyphs at the usual 8192 px), and a profile past it fails with a clear error before anything is drawn.

### Patch Changes

- Updated dependencies [[`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c), [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c), [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c), [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c)]:
  - @ascii-fx/core@0.9.0
  - @ascii-fx/compiler@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`11b0332`](https://github.com/Amir-Abushanab/ascii-fx/commit/11b0332eab378d53e6664cd633f848cbd70bd014)]:
  - @ascii-fx/core@0.8.0
  - @ascii-fx/compiler@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`c95c9f7`](https://github.com/Amir-Abushanab/ascii-fx/commit/c95c9f78373d4b3a2b44527fe64d21d5c3357c55), [`580b9bf`](https://github.com/Amir-Abushanab/ascii-fx/commit/580b9bf1bf93613ee03f1c907af99b409c1a0290)]:
  - @ascii-fx/core@0.7.0
  - @ascii-fx/compiler@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @ascii-fx/compiler@0.6.0
  - @ascii-fx/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`e3cf88e`](https://github.com/Amir-Abushanab/ascii-fx/commit/e3cf88ed80ddab106894fc7b3e70309ae85e14a3)]:
  - @ascii-fx/core@0.5.0
  - @ascii-fx/compiler@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`f6861a5`](https://github.com/Amir-Abushanab/ascii-fx/commit/f6861a583f9434717e7f826980ff0a57c4d06fb1)]:
  - @ascii-fx/core@0.4.0
  - @ascii-fx/compiler@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @ascii-fx/compiler@0.3.1
  - @ascii-fx/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [[`79dda82`](https://github.com/Amir-Abushanab/ascii-fx/commit/79dda828e89d69d8e7b0f11527507fb9087f8096)]:
  - @ascii-fx/core@0.3.0
  - @ascii-fx/compiler@0.3.0

## 0.2.0

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

- Updated dependencies [[`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2), [`6a9cf29`](https://github.com/Amir-Abushanab/ascii-fx/commit/6a9cf2924e69b8591e69213c7ac90662401e1d96), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2)]:
  - @ascii-fx/compiler@0.2.0
  - @ascii-fx/core@0.2.0
