# @ascii-fx/core

## 0.9.0

### Minor Changes

- [#29](https://github.com/Amir-Abushanab/ascii-fx/pull/29) [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - **Breaking:** the frame exports are now standalone functions instead of `AsciiFrame` methods.

  ```diff
  - frame.toText()
  - frame.toAnsi()
  - frame.toHTML()
  + import { frameToText, frameToAnsi, frameToHTML, frameToSVG } from '@ascii-fx/core'
  + frameToText(frame)
  + frameToAnsi(frame)
  + frameToHTML(frame)
  + frameToSVG(frame)
  ```

  A bundler drops an unused export but never an unused class method, since it cannot prove nothing reaches the method through the prototype. As methods, every format shipped in every bundle that matched anything, because `matchFrame` returns an `AsciiFrame`. As functions, a bundle carries only the formats it imports: `matchFrame` plus `frameToText` is 5.8 KB gzipped, down from 6.2 KB in 0.8.0, and the `@ascii-fx/gpu` renderer, which formats no text at all, sheds about 1.2 KB. `getCell` stays a method.

- [#29](https://github.com/Amir-Abushanab/ascii-fx/pull/29) [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - **Breaking:** `matchFrame` is structural-v1 only, and the `matcher` option is gone from `MatchOptions`.

  ```diff
  - matchFrame(source, { profile, matcher: 'shape6' })
  - matchFrame(source, { profile, matcher: 'ramp' })
  - matchFrame(source, { profile, matcher: 'chromatic' })
  + matchFrameShape6(source, { profile })
  + matchFrameRamp(source, { profile })
  + matchFrameChromatic(source, { profile })
  ```

  `matchFrame` used to switch on `matcher`, so every bundle that called it also carried shape6, ramp and chromatic-v1. Each matcher is now its own function: `matchFrame` alone drops from 5.5 KB to 3.4 KB gzipped, and an approximate matcher becomes an explicit import rather than a flag. `renderAscii` and the compiler's `buildFrame` are structural-only for the same reason.

  Passing `matcher` to `matchFrame` from untyped code now throws, naming the function to call, rather than quietly running structural-v1. `jitter` is still refused by the matchers that have no rerank; that check moved into them. Renderers keep their `matcher: 'chromatic'` option.

- [#29](https://github.com/Amir-Abushanab/ascii-fx/pull/29) [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add palettes, post effects, two glyph sets and SVG export.

  `palette: { colors, dither?, spread? }` snaps each cell's fitted colours to a list of up to 256 through an optional ordered Bayer dither. It is `palette-v1`, specified in `ALGORITHM.md §22` and integer throughout, so the WebGPU compute pass agrees bit for bit with the new `quantizeFrame()` in `@ascii-fx/core`, which the CPU backend runs. It sits between matching and the composite: changing it never rematches, and `captureFrame()` returns the snapped colours. Error diffusion is deliberately absent, since it cannot run in parallel and stay exact.

  `post: { scanlines, vignette, curvature, aberration, grain, bloom }` adds screen-space effects to the composite on both shader compositors. Bloom comes from a per-cell glow field built from each glyph's coverage and colour, so it costs a pass over the grid rather than the canvas. The palette and glow compute pipelines are built the first time a palette or bloom is set, so a renderer that uses neither compiles nothing extra at startup. The Canvas2D fallback draws scanlines, vignette and bloom. With everything on, a 1080p WebGPU frame takes about 0.3 ms longer.

  New built-in charsets: `blocks` (the Block Elements range) and `braille` (all 256 patterns). `frameToSVG(frame)` exports a frame as vector text with every glyph pinned to its column.

  Runtime profiles (`createAsciiProfile`) now size the cell to the widest glyph instead of to `M`. Full-width glyphs such as kanji were being clipped to their left half. Monospace Latin sets are unaffected.

  The WebGL2 compositor no longer samples the motion field in place of the RGBA atlas when an emoji profile is combined with `interaction: { source: 'motion' }`.

  Shader comments and indentation are now stripped at build time. With these features added, the `@ascii-fx/gpu` bundle is 35.3 KB gzipped, up from 33.6 KB.

- [#29](https://github.com/Amir-Abushanab/ascii-fx/pull/29) [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Non-Latin scripts: grapheme glyphs, OpenType shaping, Arabic sets with optional joining, font collections, any-width fonts, bidi-safe exports, and charsets far past 2048 glyphs on the GPU.

  **Breaking:** a custom `characters` string now splits into grapheme clusters, not code points, so `'क्ष'`, `'é'` and `'👍🏽'` are one glyph each, and an array's elements are glyphs as given rather than being split further. Sets of single-code-point characters resolve exactly as before.

  - **Shaping.** The compiler shapes any glyph that isn't one code point the font maps (a conjunct, a letter with marks), using the font's own OpenType rules via fontkit, and rasterizes the shaped run. Single mapped code points rasterize exactly as before, so existing profiles are byte-identical. Where a font carries both OpenType and Apple `morx` tables, the compiler shapes with OpenType: fontkit prefers `morx`, and its `morx` engine never returns on some input (Thai sara am in Ayuthaya). Verified with Arabic, Hebrew, Thai, Devanagari, Cyrillic and Tai Le, Tai Tham and Tai Viet system fonts. Because shaped glyphs depend on fontkit's code as well as the font, golden fixtures built from committed OFL Noto subsets (Arabic, Devanagari, Thai) and Geist's combining marks pin every shaped glyph's mask, coverage and atlas pixels, so a fontkit update that changes one fails CI and names it.
  - **Arabic.** New built-in sets `arabic` (the 40 isolated letterforms, which never connect) and `arabic-joined` (every final, initial and medial form, plus tatweel). Joining is opt-in by choosing the set. In `arabic-joined`, joining forms are drawn with kashida to the edge they join at, so adjacent cells' strokes meet. Both sets use presentation-form code points, which text viewers display as written. A form is drawn by shaping its base letter in context (`shapingText`), in the compiler and in browser-built profiles alike, so it comes from the profile's own font even when that font leaves the presentation block unmapped, rather than from whatever fallback font maps it. `joiningSide`, `kashidaText`, `glyphOffset` and `shapingText` in core are the reference.
  - **Any-width fonts.** The compiler no longer requires a monospace font. The cell is the widest glyph's and the rest are centred (or pushed to the edge they join at), so Arabic in any font and kanji next to Latin compile. Monospace sets compile byte-for-byte as before. Runtime profiles now follow the same rule, which fixes full-width glyphs such as kanji being clipped to their left half.
  - **Font collections.** `face` (a PostScript name or an index) picks a face from a `.ttc`/`.otc`, through `buildProfile`, the Vite config and `--face` on the CLI. CJK and Arabic system fonts nearly all ship this way.
  - **Exports.** `frameToText`, `frameToAnsi`, `frameToHTML` and `frameToSVG` force rows containing right-to-left glyphs into cell order (LRO/PDF in text, `unicode-bidi: bidi-override` in HTML and SVG), where a viewer's bidi algorithm would otherwise reverse them. A set of full-width glyphs writes blanks as U+3000 so columns align in a terminal. Latin exports are unchanged.
  - **GPU glyph limit.** The WebGPU matcher's per-glyph workgroup array is gone: each lane keeps its own top 8 and lane 0 merges them, which is the same result, verified bit for bit up to 3000 glyphs, and no slower for small sets. `MAX_GPU_GLYPHS` is now the 16-bit glyph id (65535). In practice the limit is the glyph atlas fitting in one texture (about 4,000 kanji-sized glyphs at the usual 8192 px), and a profile past it fails with a clear error before anything is drawn.

## 0.8.0

### Minor Changes

- [#25](https://github.com/Amir-Abushanab/ascii-fx/pull/25) [`11b0332`](https://github.com/Amir-Abushanab/ascii-fx/commit/11b0332eab378d53e6664cd633f848cbd70bd014) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add `motion-v1`, a per-cell motion field, and `interaction: { source: 'motion' }` to drive an effect from it.

  Every interaction has been driven by the pointer — a circle of influence following the cursor. `source: 'motion'` swaps that for the source's own movement: each cell's mean luma is compared against the previous frame's, thresholded to ignore drift, square-root-lifted so subtle movement still reads, and left to decay into a wake. A moving hand lights up hand-shaped and trails behind itself, rather than a circle sitting wherever the cursor is.

  A field rather than a point, which is what makes it hold up on real footage — a centroid of "two people talking" sits in the empty space between them, and a centroid of a camera pan sits motionless in the middle of the frame.

  `motionField()` in `@ascii-fx/core` is the reference, specified as `ALGORITHM.md §21`. It is derived from reduce-v1 samples rather than from the matcher, so `structural-v1` and §17 conformance are untouched, and it is integer end to end — fixed-point smoothstep, and a square root corrected by adjustment rather than trusted — so the WGSL and CPU implementations agree bit-for-bit rather than approximately. `pnpm test:gpu` holds them to that across a sequence, trail decay included.

  Available on both backends and all three composite paths. `wave`, `push` and `resolution` reject it at construction: wave ignores the mask entirely, and the other two need a single origin to push away from or magnify about, which a field does not have.

## 0.7.0

### Minor Changes

- [#22](https://github.com/Amir-Abushanab/ascii-fx/pull/22) [`c95c9f7`](https://github.com/Amir-Abushanab/ascii-fx/commit/c95c9f78373d4b3a2b44527fe64d21d5c3357c55) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add `jitter`, an opt-in effect that varies a cell's glyph among the rerank candidates that reconstruct it nearly as well as the winner does.

  `structural-v1` takes the argmin, so a cell whose top candidates score almost identically always resolves to the same one. On Geist Mono the shortlist is a near-tie plateau — best 27, eighth-best 29 at p50 — so wide regions of similar content lock to a single glyph and read as banding. `jitter: 1..255` widens that to a weighted draw over the candidates within a tolerance of the winner, emitting the colours fitted to whichever one it picks.

  The draw is a hash of the cell's position rather than `Math.random`, so §17 conformance still applies, and the weighting is linear rather than a softmax because `exp` is implementation-defined and could not be specified bit-for-bit. `jitterSeed` shifts the pattern — hold it constant for a stable dither, pass a frame counter for one that moves. `jitter: 0` remains the default and bypasses the path entirely.

  Also adds `rowOffset`, which a band must pass so its cells hash against frame rows rather than band-local ones; it is inert unless `jitter` is set. Specified as jitter-v1 in `ALGORITHM.md §20`. `@ascii-fx/core` only — no GPU backend implements it yet.

- [#22](https://github.com/Amir-Abushanab/ascii-fx/pull/22) [`580b9bf`](https://github.com/Amir-Abushanab/ascii-fx/commit/580b9bf1bf93613ee03f1c907af99b409c1a0290) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Bring exact temporal reuse (spec §21) to the CPU worker pool, where it was previously WebGPU-only.

  A cell's glyph, colours, and flags depend on nothing but its own 64 source samples and the options, so a cell whose samples are byte-identical to the previous match already has its answer. `matchBand` takes an optional fifth argument carrying the previous band's samples and cells and copies through the ones that did not move; comparing 256 bytes — usually one or two, since the scan stops at the first difference — costs far less than a prefilter over the charset plus a rerank.

  At 320×84 over Geist Mono in `full`, a frame where nothing moved matches in 8.9 ms instead of 125.7 ms, a quarter-changed frame in 37.4 ms, and a wholly changed one in the full 129.6 ms. It is a skip, not an approximation: output is byte-identical at every fraction.

  `@ascii-fx/gpu` passes `temporal` through to its workers, each of which retains its own band keyed on the grid, band bounds, colour mode, alpha mode, thresholds, palette, and profile — so a resize, an option change, or a re-init re-matches from scratch rather than serving cells matched against something else. Bands are now assigned to workers by index rather than round-robin so a worker sees the same band each frame. The CPU backend's inline path (the first frame, `captureFrame()`, and any frame the pool is too busy to take) still matches in full.

## 0.6.0

## 0.5.0

### Patch Changes

- [#14](https://github.com/Amir-Abushanab/ascii-fx/pull/14) [`e3cf88e`](https://github.com/Amir-Abushanab/ascii-fx/commit/e3cf88ed80ddab106894fc7b3e70309ae85e14a3) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Document authoring a source FOR the grid in the skill.

  The skill covered the renderer thoroughly and said nothing about what to feed it, which is where a
  correct drawing most often arrives as an empty panel. One cell samples `sourceWidth / columns`
  pixels across and fits a single colour to the block, so a feature narrower than a cell renders as
  its share of that average rather than as a thin thing: a 3px line in a 6px cell fills 31%, and
  `#66779c` at 31% composites to the panel's own colour. Raising the colour cannot fix that — at 31%
  coverage it would need a luma above 255 — so the section is about coverage, with beaded paths as
  the worked example.

  Three gotchas alongside it: `foreground` is `mono` only and is silently ignored in
  `color: 'foreground'` (where colour is fitted per cell from the source); `alpha: 'mask'` gates on
  opacity rather than colour, so faintness belongs in the colour and gradients over an opaque fill
  are fine; and when output is sparse, dump the source canvas before touching the renderer, because
  "drew it wrong" and "drew it too small for the grid" look identical from the output side.

## 0.4.0

### Minor Changes

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

## 0.3.1

## 0.3.0

### Minor Changes

- [#4](https://github.com/Amir-Abushanab/ascii-fx/pull/4) [`79dda82`](https://github.com/Amir-Abushanab/ascii-fx/commit/79dda828e89d69d8e7b0f11527507fb9087f8096) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - The mono/foreground flat path now spans the charset's own tonal range instead of collapsing its top two thirds onto one glyph.

  `structural-v1` §6 mapped a flat cell's mean luma onto glyph ink coverage as `luma · 257`, i.e. onto the full 0..65535 a _completely_ inked cell would score. No ASCII glyph is completely inked: `@` in Geist Mono covers 16906/65535, about 26%. Every flat cell brighter than that targeted a coverage no glyph could reach and clamped to the densest one. A linear gradient rendered as six glyphs of ramp followed by eighteen cells of solid `@`.

  The target is now normalised into the profile's own range — `rdiv(luma · covMax, 255)`, where `covMax` is the densest glyph the profile actually has. Both the CPU matcher and the WGSL matcher changed together and remain bit-identical; the conformance suite passes unchanged.

  **This changes output** for `color: 'mono'` and `color: 'foreground'` on flat cells, which is why it is a minor rather than a patch. `color: 'full'` is unaffected (flat cells there emit the blank glyph with fg = bg = mean), and structural cells are unaffected in every mode. Charsets whose densest glyph is near-fully-inked — `ascii-blocks`, which has `█` — barely move, because for them the old ceiling was already about right. That is also why this survived to release: the charset that exposes it worst is the default one.

  `ALGORITHM.md` §6 is updated, including why the previous rationale for leaving it unnormalised does not hold: it argued the structural rerank saturates at the densest glyph in the same way, but structural cells plateau at whatever glyph matches their _shape_ — measured at `w` (11656) for a high-contrast cell, well below the `@` (16906) the old flat target reached. The two paths were never consistent.

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

- [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Pre-publish audit fixes, exactness batch:

  - `encodeProfile` now emits sections in ascending type order as ALGORITHM.md §14 requires (chromatic profiles previously wrote `[…, 11, 10, 9]`); the chromatic profile fixture is regenerated and a codec test pins the invariant.
  - The WGSL chromatic hysteresis compare is exact at all error magnitudes: the §C5 products need 44 bits, so the shader now compares 16-bit-split (hi, lo) pairs instead of a wrapping u32 multiply. A conformance test drives errors past the 32-bit ceiling and fails against the old compare.
  - Chromatic rendering draws the backdrop it matched against: the §C3 `background` uniforms are now written (previously hardcoded to 0, compositing over black), the letterbox clears to the backdrop, and `color: 'foreground'` selects a transparent canvas for chromatic exactly as the CPU backend already did. Pixel-truth tests cover both modes.

- [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - `subsetProfile`'s string form is now segmented by greedy longest match against the profile's own glyph strings, so the multi-code-point emoji glyphs chromatic palettes contain (VS16, ZWJ sequences) can be selected with a plain string — previously the string was split per code point and threw on the invisible selector halves. The array form is unchanged. Subset fingerprints now hash every code point of every glyph (with a separator) instead of only each glyph's first code point, so distinct subsets can no longer collide (e.g. skin-tone variants); subset fingerprints from earlier unpublished builds change.
