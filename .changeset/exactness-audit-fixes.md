---
"@ascii-fx/core": patch
"@ascii-fx/gpu": patch
---

Pre-publish audit fixes, exactness batch:

- `encodeProfile` now emits sections in ascending type order as ALGORITHM.md §14 requires (chromatic profiles previously wrote `[…, 11, 10, 9]`); the chromatic profile fixture is regenerated and a codec test pins the invariant.
- The WGSL chromatic hysteresis compare is exact at all error magnitudes: the §C5 products need 44 bits, so the shader now compares 16-bit-split (hi, lo) pairs instead of a wrapping u32 multiply. A conformance test drives errors past the 32-bit ceiling and fails against the old compare.
- Chromatic rendering draws the backdrop it matched against: the §C3 `background` uniforms are now written (previously hardcoded to 0, compositing over black), the letterbox clears to the backdrop, and `color: 'foreground'` selects a transparent canvas for chromatic exactly as the CPU backend already did. Pixel-truth tests cover both modes.
