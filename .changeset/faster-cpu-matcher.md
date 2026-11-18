---
'@ascii-fx/core': patch
---

The exact CPU matcher is about twice as fast, with byte-identical output. The rerank summed the reconstruction error over all 64 samples of every candidate, after a first pass over the same 64 to fit the colours. The error has a closed form in the sums the colour fit already needs (Σ(s−c)² = Σs² − 2c·Σs + n·c², an integer identity), so one pass over the smaller side of each glyph's mask now does both.

`matchBand` on a 320×84 grid goes from 114 ms to 47 ms in `full`, 117 ms to 40 ms in `foreground` and 71 ms to 44 ms in `mono`; at 160×42 `full` it is 29 ms to 13 ms. This is the matcher behind the no-WebGPU fallback's workers, `matchFrame`, and build-time frames. The golden files and the GPU conformance suite pass unchanged.
