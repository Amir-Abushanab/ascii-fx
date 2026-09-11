---
'@ascii-fx/core': minor
'@ascii-fx/gpu': minor
---

Add `motion-v1`, a per-cell motion field, and `interaction: { source: 'motion' }` to drive an effect from it.

Every interaction has been driven by the pointer — a circle of influence following the cursor. `source: 'motion'` swaps that for the source's own movement: each cell's mean luma is compared against the previous frame's, thresholded to ignore drift, square-root-lifted so subtle movement still reads, and left to decay into a wake. A moving hand lights up hand-shaped and trails behind itself, rather than a circle sitting wherever the cursor is.

A field rather than a point, which is what makes it hold up on real footage — a centroid of "two people talking" sits in the empty space between them, and a centroid of a camera pan sits motionless in the middle of the frame.

`motionField()` in `@ascii-fx/core` is the reference, specified as `ALGORITHM.md §21`. It is derived from reduce-v1 samples rather than from the matcher, so `structural-v1` and §17 conformance are untouched, and it is integer end to end — fixed-point smoothstep, and a square root corrected by adjustment rather than trusted — so the WGSL and CPU implementations agree bit-for-bit rather than approximately. `pnpm test:gpu` holds them to that across a sequence, trail decay included.

Available on both backends and all three composite paths. `wave`, `push` and `resolution` reject it at construction: wave ignores the mask entirely, and the other two need a single origin to push away from or magnify about, which a field does not have.
