---
'@ascii-fx/compiler': minor
'@ascii-fx/core': minor
'@ascii-fx/gpu': minor
'@ascii-fx/react': patch
---

Add `chromatic-v1`: matching for glyph sets whose colour is baked into the glyph, such as colour emoji.

`structural-v1` matches a 1-bit mask and fits colour to it — with foreground and background free, the best colours for a mask are the means of its two sample sets, which is what makes its rerank exact. A colour glyph leaves nothing to fit, so `chromatic-v1` compares a cell's 64 reduced samples against the glyph's own, composited over the backdrop it will be drawn on. It is a separate algorithm rather than an approximation: no flat path, no polarity, and no candidate prefilter. `ALGORITHM.md §C` is normative.

- `@ascii-fx/core` — `matchFrameChromatic`, `matcher: 'chromatic'`, the `'glyph'` colour mode (frames carry no colour planes), optional hysteresis for video, `chromatic` profile data, and compositing for glyph-coloured frames.
- `@ascii-fx/compiler` — `buildChromaticProfile` builds a profile from decoded colour images rather than a font, carrying an RGBA atlas alongside the coverage plane so the profile still works with the mask-fitting matchers.
- `@ascii-fx/gpu` — a WebGPU matcher parallel over glyphs rather than samples, an RGBA atlas with its own mip chain, and a compositor branch. Held to the CPU oracle bit-for-bit by the conformance suite.
- `@ascii-fx/react` — `matcher` and `hysteresis` reach the memo key, so changing either re-runs matching.

`ColorMode` gains `'glyph'`; it is an output mode, and passing it to a mask-fitting matcher is an error rather than a silent fallback.
