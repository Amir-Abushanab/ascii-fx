# Emoji matching — measurement results

> **Status: shipped.** Every finding below is implemented as `chromatic-v1` —
> normative spec in [`ALGORITHM.md §C`](./ALGORITHM.md), CPU oracle in
> `@ascii-fx/core`, profile builder in `@ascii-fx/compiler`, WebGPU backend held
> to the oracle bit-for-bit. Flip **Emoji mode** in the playground to drive it.
>
> This document is the record of *why* it looks the way it does. The measurement
> harness that produced the numbers was removed once its conclusions shipped —
> it reimplemented pieces of the pipeline in order to compare them, and leaving
> a second copy of the matcher around to rot is worse than the git history it
> now lives in.

Numbers below were produced by that harness; see the note above on where it went.

Two glyph sources × two corpora, 400 glyphs each, 20 columns:

- **system** — your platform's emoji, built in-browser through one `getImageData`
  per glyph. Not reproducible across machines, by construction.
- **noto** — Noto Color Emoji PNGs decoded **in Node** by `prepEmoji.mjs`. Never
  touches a canvas, so no fingerprinting noise and byte-identical everywhere.
- **procedural** — 7 synthetic images, heavily saturated and smooth.
- **photos** — 6 images from the Kodak True Color suite, the standard corpus for
  colour-imaging work (chosen so the selection is not mine to bias).

Judge is **CIEDE2000**, deliberately not one of the four candidates, and it
self-checks against the Sharma conformance pairs on every run. Every result is
scored on all 64 samples of the chosen emoji, including the mean-colour rows.

## Result 1 — Oklab loses in every condition

Mean ΔE00 per sample, structural descriptor (lower is better):

| condition | RGB L2 | Luma-weighted | Redmean | Oklab | spread | Oklab rank |
| --- | ---: | ---: | ---: | ---: | ---: | :-: |
| system / procedural | 23.90 | **23.67** | 23.69 | 23.91 | 1.0% | 4th |
| system / photos | 22.64 | 22.67 | **22.64** | 23.19 | 2.4% | 4th |
| noto / procedural | 20.20 | 20.08 | **20.00** | 20.84 | 4.2% | 4th |
| noto / photos | **17.33** | 17.35 | 17.37 | 17.71 | 2.2% | 4th |

**Oklab places last in all four**, and the winner is inconsistent
(luma-weighted, redmean, redmean, RGB L2) with a spread of only 1.0–4.2%. The
first three metrics are interchangeable within noise; Oklab is reliably, if
mildly, worse. This is not a corpus artefact and not a system-emoji artefact.

The control: RGB L2 and Oklab agree on only 66–77% of cells, so the metrics
genuinely diverge — they just arrive at equally mediocre reconstructions.

**Do not spec `oklab-fx1`.** It costs a normative LUT section and is net
negative on every measurement taken.

## Result 2 — structure matters more on real photographs

Structural (64 samples) vs mean colour (1 sample), the thing every shipping
emoji-mosaic tool does:

| condition | structural gain |
| --- | ---: |
| system / procedural | 10.7% |
| noto / procedural | 15.5% |
| system / photos | 16.0% |
| **noto / photos** | **28.3%** |

Photographic content benefits **more** than the synthetic corpus, not less — the
opposite of the usual worry that a synthetic corpus flatters a method. On the
best configuration the structural descriptor is worth 28%. This is 7–28× the
metric effect, and it is where the effort belongs.

## Result 3 — Noto beats system emoji, using fewer glyphs

Same 400 code points, same matcher, same corpus; only the artwork differs.

| photo | Noto ΔE (distinct) | system ΔE (distinct) |
| --- | ---: | ---: |
| kodim04 | **15.24** (13) | 22.61 (23) |
| kodim05 | **17.16** (17) | 19.96 (31) |
| kodim08 | **17.71** (16) | 23.03 (19) |
| kodim15 | **16.98** (25) | 22.89 (28) |
| kodim21 | **15.77** (13) | 21.30 (19) |
| kodim23 | **21.11** (16) | 26.02 (19) |

Noto wins **every** photo — 23.4% better overall on photos, 15.5% on procedural
— while reaching for *fewer* distinct emoji (16.7 vs 23.2 on average). Noto's
flatter, more uniform artwork survives reduction to 8×8 better than Apple's
detailed, glossy renderings, which carry highlights and gradients that muddy the
descriptor.

**This cuts against defaulting to system emoji.** System emoji is the better UX
("it looks like *your* emoji") and dodges the font-licensing problem, but it is
measurably worse output. Worth surfacing as a deliberate choice rather than a
default.

## Result 4 — curation beats size by more than an order of magnitude

Every result above was palette-limited, so: does *which* glyphs you bundle
matter more than *how many*? Held-out mean ΔE00 on the Noto pool of 1301, trained
on the procedural corpus and scored on photos it never saw:

| strategy | 50 | 100 | 200 | 400 | 800 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Code-point order (baseline) | 24.13 | 23.64 | 18.62 | 17.33 | 16.83 |
| Random (control) | 23.85 | 21.60 | 20.83 | 18.86 | 17.38 |
| Farthest-point, mean colour | 20.88 | 19.99 | 19.77 | 19.05 | 17.03 |
| Farthest-point, 64 samples | 21.51 | 21.36 | 19.89 | 19.14 | 18.02 |
| k-means medoids | 19.87 | 19.77 | 17.57 | 18.83 | 17.01 |
| **Usage frequency (trained)** | **16.78** | **16.39** | **16.37** | **16.34** | **16.27** |
| *full pool (1301)* | | | | | *16.26* |

**A usage-curated 50 glyphs (16.78) beats code-point order at 800 (16.83), and
100 glyphs land within 0.8% of the entire 1301-glyph pool.** That is a 13–26×
reduction in palette size for equal quality.

It holds in all four splits, both directions and within-domain:

| split | ceiling (1301) | usage @50 | usage @100 | code-point @400 |
| --- | ---: | ---: | ---: | ---: |
| procedural → photos | 16.26 | 16.78 | 16.39 | 17.33 |
| photos → procedural | 18.61 | 19.57 | 19.47 | 20.20 |
| photos A → photos B | 16.64 | 16.88 | 16.85 | 17.95 |
| photos B → photos A | 15.87 | **15.91** | 15.89 | 16.71 |

`usage@50` beats `codepoint@400` in every split. On the last one it lands within
**0.25%** of the full pool — 50 glyphs matching 1301.

### Coverage-maximising selection is actively harmful

Farthest-point and k-means beat the baseline at tiny budgets but are **worse
than doing nothing** at 400–800, losing to plain code-point order in 3 of 4
splits. k-center maximises spread, which spends the budget on extreme colours
that images almost never call for. What matters is *density*, not coverage —
and usage frequency is a direct empirical density estimate.

### Why the effect is so large

Matching the 7-image procedural corpus against all 1301 glyphs uses **44 of
them**. The pool is not slightly redundant, it is 96% dead weight.

The 40 most-used glyphs are dominated by textured mid-tones and, notably, the
standalone skin-tone modifiers (🏻🏼🏽🏾🏿), which render as flat colour swatches.
The most useful "emoji" for reconstruction are the ones that are barely emoji —
plain colour patches and low-contrast textures. Farthest-point, by contrast,
reaches for 🧙🌫🔂☪️🔹 — vivid and useless.

### What this does to the bundle-size problem

The atlas budget was the original argument against bundling. At 100 glyphs and a
32px reference cell it is roughly 640 KB, and at 50 glyphs ~320 KB — small
enough that bundling a curated palette is simply not a constraint any more.

## Result 5 — it does not flicker; emoji are *more* temporally stable than ASCII

Everything above is single-frame, but this is a video renderer, and the obvious
risk was that a cell whose two best candidates are near-tied flips every frame.
`structural-v1` gets away with that because `%` and `&` read as texture; 🌑 ↔ 🕶
would read as a strobe.

40 frames per scene at 1/30s, curated 100-glyph Noto palette, with
`structural-v1` matching the identical frames as the calibration.
**Excess churn** is how far the output moved beyond what the input moved, in
ΔE00 — a flip is legitimate when the source changed, so only the excess is
visible as flicker.

| scene | emoji flips/frame | ascii flips/frame | emoji churn | ascii churn |
| --- | ---: | ---: | ---: | ---: |
| Animated orbs | **2.6%** | 4.8% | 0.50 | **0.32** |
| Plasma | **5.5%** | 15.2% | **1.22** | 1.26 |
| Starfield | **0.9%** | 15.3% | **0.06** | 0.07 |

**Emoji flip less often than ASCII in every scene** — dramatically so on plasma
(5.5% vs 15.2%) and starfield (0.9% vs 15.3%). Excess churn is at or below the
ASCII reference on two of three scenes, and the absolute numbers are tiny: a
just-noticeable difference is ΔE ≈ 1, and two of three scenes sit well under it.

The reason is a pleasant inversion of the palette limitation. `structural-v1` in
`full` colour mode fits foreground and background per cell, so a small colour
shift changes the optimal glyph-plus-colour combination and the choice is very
sensitive. Emoji colours are baked, so matching is a coarser quantisation and
small input changes usually do not cross a Voronoi boundary in the palette.
**The same palette coarseness that costs fidelity buys temporal stability.**

### Hysteresis is cheap insurance

Keeping the incumbent unless a challenger beats it by a margin:

| scene | churn at h=0 | churn at h=0.1 | churn reduction | quality cost |
| --- | ---: | ---: | ---: | ---: |
| Animated orbs | 0.50 | 0.34 | 33% | 0.68% |
| Plasma | 1.22 | 1.06 | 13% | 0.49% |
| Starfield | 0.06 | 0.00 | 96% | −0.37% |

`h = 0.1` is a reasonable default: it removes a third of the excess churn on the
worst scene for well under 1% quality, and eliminates it entirely on the
easiest. It costs one extra full candidate evaluation per cell (the incumbent
may have been early-exited out of the search), which is negligible.

Orbs is the only scene where emoji churn exceeds ASCII (1.57×) — smooth
gradients make near-ties most likely — and `h = 0.1` brings it to 0.34, level
with ASCII's 0.32.

## Result 6 — no prefilter needed; brute force costs what structural-v1 costs

`structural-v1` shortlists 95 glyphs by Hamming popcount to K=8 before its exact
rerank, and the plan was to mirror that with a binary-quantised descriptor. The
curation result made that question worth re-asking at ~100 glyphs.

1280×720 photograph, RGB L2, structural descriptor, median of 5. Emoji cells are
square and text cells are not, so **ns/cell** is the comparable column:

| matcher | palette | 60 cols, ns/cell | 100 cols, ns/cell | ΔE (100 cols) |
| --- | ---: | ---: | ---: | ---: |
| brute force | 50 | 10,882 | 8,768 | 15.35 |
| **brute force** | **100** | **15,539** | **13,357** | **15.34** |
| brute force | 200 | 25,735 | 23,196 | 15.31 |
| brute force | 400 | 47,696 | 43,429 | 15.23 |
| brute force | 1301 | 154,118 | 144,929 | 15.12 |
| *ascii `structural-v1`* | *95* | *15,833* | *12,038* | *—* |

**A 100-glyph emoji brute force costs 0.98–1.11× what `structural-v1`'s
prefilter-plus-rerank costs per cell.** Since `structural-v1` reaches 2.7 ms/frame
on WebGPU, the chromatic matcher should land in the same regime on the same
one-workgroup-per-cell pass. No prefilter, no binary quantisation, no extra
profile section.

### And every prefilter is a bad trade at that size

| prefilter | ns/cell @100 palette | ΔE | vs brute |
| --- | ---: | ---: | --- |
| K=8 | 7,941 | 16.95 | 2× faster, **5.4% worse quality** |
| K=32 | 14,216 | 16.09 | 9% faster, quality-neutral |
| none (brute) | 15,539 | 16.08 | — |

K=8 damages quality badly (and worse as the palette grows: 21% at 400 glyphs) —
a mean-colour shortlist throws away candidates that match structurally but sit
elsewhere in colour. K=32 is quality-neutral but only 9% faster, which does not
justify a spec section. **Brute force wins on simplicity and quality.**

### Palette size confirms the curation result on a fresh source

50 → 1301 glyphs moves ΔE from 15.35 to 15.12: **26× the palette for 1.5%**,
at 16× the per-cell cost. Independent replication of Result 4.

### Caveat on frame cost

The comparison is per cell. Emoji cells are square, so at a fixed canvas and
column count you get roughly twice as many of them as text cells — a like-for-like
*frame* is about 2× the work. In practice emoji mode wants far fewer columns,
since a legible emoji needs more pixels than a legible character. The GPU figure
above is an extrapolation from matched per-cell cost, not a measurement; both
paths are integer-ALU-bound over a storage-buffer glyph table, but it should be
confirmed once the shader exists.

### Methodology note

The first run of this sweep used a synthetic gradient as the source and produced
*byte-identical* output for every palette from 50 to 1301 — only 13 glyphs ever
won, so nothing above the top 13 was ever reachable. Timing stayed valid but the
quality column was meaningless. The numbers above use a photograph. Any future
perf work here needs a representative source for the same reason.

## Fixed-point Oklab is sound regardless

Should the metric question ever be reopened, the implementation is verified:

- vs float Oklab over 2.1M colours: **mean error 1.2e-4, max 3.0e-3** Oklab
  units, worst at `rgb(0,0,4)` — the cbrt singularity, as expected.
- Two-tier cbrt LUT is exact at the tier boundary and by direct lookup below
  linear 1/64, which is where a single uniform table with lerp goes wrong.
- Stored a/b range at Q=4096 is **−1276..1131**, so **i16 storage fits**.

## Caveats

- ΔE00's `SC`/`SH` terms discount chroma error at high chroma, so the referee is
  somewhat aligned with "luminance matters most". That may partly explain why
  the luminance-weighted metrics edge ahead — but it does not rescue Oklab,
  which would need to *win* to justify its cost.
- ΔE00 of 15–24 remains enormous (a JND is ~1). Even the best configuration is
  perceptually far from the source. The `distinct` column shows why: 13–25 emoji
  out of 400 carry each image. **The palette is still the binding constraint.**
- Usage-frequency curation is fitted on a corpus. It generalised across every
  split tried here, but all the training material is either synthetic or Kodak
  photographs — a genuinely different domain (screenshots, line art, anime) may
  want a different palette. The strategy is cheap to re-run per domain.
- `distinct` counts stay low even at the ceiling, so a residual palette limit
  remains; it is just no longer addressable by adding more glyphs.

## Where to go next

1. **Drop `oklab-fx1`.** Keep RGB L2 — it is already `structural-v1`'s objective,
   it won the best configuration outright, and it costs nothing new.
2. **Bundle a usage-curated palette of ~100 Noto glyphs.** It matches the full
   1301-glyph pool to within 1%, fits in well under a megabyte, and removes the
   atlas-budget objection to bundling entirely.
3. **Do not curate for colour coverage.** It is worse than doing nothing at
   realistic budgets. Curate for usage density.
4. **Bundle Noto; offer system emoji as the opt-in.** The reverse of the earlier
   recommendation, and the data is not close.
5. Ship the curated palette as a compiled artefact, so `chromatic-v1` needs no
   selection logic at runtime — this is all tier-1 work.
6. **Ship hysteresis, but default it off.** It is not needed to make emoji video
   viable — that turned out fine unaided (Result 5) — so it is insurance rather
   than a fix. `h = 0.1` is the value to reach for when a specific source does
   strobe; making it the default would charge every source for a problem most
   do not have.
7. **No prefilter.** Brute force over the curated palette, which is what
   `structural-v1` already costs per cell. Drops the binary-quantisation plan and
   the reserved profile sections it would have needed.
