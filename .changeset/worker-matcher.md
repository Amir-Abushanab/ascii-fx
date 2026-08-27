---
'@ascii-fx/core': minor
'@ascii-fx/gpu': minor
---

Move the CPU fallback's matcher off the main thread: 39.1 → 29.3 ms/frame at
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
