# @ascii-fx/core

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
