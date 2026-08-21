---
"@ascii-fx/core": patch
---

`subsetProfile`'s string form is now segmented by greedy longest match against the profile's own glyph strings, so the multi-code-point emoji glyphs chromatic palettes contain (VS16, ZWJ sequences) can be selected with a plain string — previously the string was split per code point and threw on the invisible selector halves. The array form is unchanged. Subset fingerprints now hash every code point of every glyph (with a separator) instead of only each glyph's first code point, so distinct subsets can no longer collide (e.g. skin-tone variants); subset fingerprints from earlier unpublished builds change.
