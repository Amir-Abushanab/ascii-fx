---
'@ascii-fx/gpu': patch
---

A `clearColor` with alpha < 1 now drops the background plane inside the grid for `mono` and chromatic frames, on both backends — the grid itself presents transparent, not just the letterbox.

0.3.0 keyed the canvas's alphaMode on whether the output can be transparent, but the base composite still keyed the frame's ground on `color === 'foreground'`: mono cells kept an opaque background plane the clear could not touch, so a mono overlay still presented as a slab over the page. The two decisions now share one predicate — `color: 'foreground'`, or an explicit `clearColor` with alpha below 1 — so the canvas and the frame can no longer disagree about transparency.

Under a see-through ground `mono` keeps its meaning: a fixed foreground where brightness picks the glyph and the ramp does the work, now over nothing instead of over `background`. `color: 'full'` deliberately keeps its per-cell sampled background — that plane is content, not a backdrop — so its transparency still comes from `alpha: 'mask'` cells and the letterbox. Chromatic frames follow the same rule: a transparent `clearColor` now emits glyphs with their own alpha, exactly like `color: 'foreground'` already did, including on the CPU backend, which previously drew them over an opaque backdrop.
