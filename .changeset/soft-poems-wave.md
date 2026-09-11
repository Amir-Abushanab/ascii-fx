---
'@ascii-fx/core': minor
---

Add `jitter`, an opt-in effect that varies a cell's glyph among the rerank candidates that reconstruct it nearly as well as the winner does.

`structural-v1` takes the argmin, so a cell whose top candidates score almost identically always resolves to the same one. On Geist Mono the shortlist is a near-tie plateau — best 27, eighth-best 29 at p50 — so wide regions of similar content lock to a single glyph and read as banding. `jitter: 1..255` widens that to a weighted draw over the candidates within a tolerance of the winner, emitting the colours fitted to whichever one it picks.

The draw is a hash of the cell's position rather than `Math.random`, so §17 conformance still applies, and the weighting is linear rather than a softmax because `exp` is implementation-defined and could not be specified bit-for-bit. `jitterSeed` shifts the pattern — hold it constant for a stable dither, pass a frame counter for one that moves. `jitter: 0` remains the default and bypasses the path entirely.

Also adds `rowOffset`, which a band must pass so its cells hash against frame rows rather than band-local ones; it is inert unless `jitter` is set. Specified as jitter-v1 in `ALGORITHM.md §20`. `@ascii-fx/core` only — no GPU backend implements it yet.
