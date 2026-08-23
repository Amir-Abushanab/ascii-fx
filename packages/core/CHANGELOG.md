# @ascii-fx/core

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
