# ASCII FX — ALGORITHM.md

**Normative.** This document pins every constant, formula, bit layout, and tie-break of the exact pipeline. Where the product spec (`ascii-fx-spec.md`) is ambiguous, this document wins. Implementations (CPU reference, WebGPU, WASM, …) must agree **bit-for-bit** with what is written here.

Versioned identifiers defined by this document:

```text
structural-v1   matcher semantics
chromatic-v1    matcher semantics for glyphs whose colour is baked (§C)
reduce-v1       source reduction
grid-v1         grid derivation
raster-v1       compiler rasterization
asciip/1        profile binary format
asciif/1        frame binary format
```

Changing any behavior below requires a new version identifier (spec §29).

---

## 0. Arithmetic conventions

All algorithm arithmetic is **exact integer arithmetic**. No floats anywhere in the match or raster path. JavaScript doubles are exact for integers with |n| ≤ 2^53; all quantities below stay far under that bound. `Math.floor(n / d)` on integers is exact for |n| ≤ 2^52, 0 < |d| ≤ 2^32 (proof: an exactly-integer ratio is represented exactly; a non-integer ratio is ≥ 1/d away from any integer, which exceeds the float error).

```text
idiv(n, d) = floor(n / d)                    d > 0, n ≥ 0        (truncating division)
fdiv(n, d) = floor(n / d)                    d ≠ 0, n any sign   (floor division, toward −∞)
rdiv(n, d) = floor((2n + d) / (2d))          d > 0, n any sign   (round half up, toward +∞)
```

Examples: `rdiv(3, 2) = 2`, `rdiv(-3, 2) = -1`, `rdiv(-1, 2) = 0`.

All multi-byte binary values are **little-endian**.

## 1. Constants

```text
CELL              8          samples per cell axis (8×8 = 64)
K                 8          rerank candidate count
FLAT_THRESHOLD    15         default; integer luma units (≈ 0.06 × 255)
ALPHA_THRESHOLD   128        cell mean alpha below this ⇒ transparent cell (alpha: 'mask')
DEFAULT_COLUMNS   120
DEFAULT_FG        (255, 255, 255)
DEFAULT_BG        (0, 0, 0)

REF_GLYPH_HEIGHT  64         raster-v1 reference cell height, px
SUPERSAMPLE       4          raster-v1 subsamples per pixel axis (16/px)
ATLAS_PADDING     4          px of empty border inside each atlas tile
QUAD_SEGMENTS     16         quadratic Bézier flattening segments
CUBIC_SEGMENTS    24         cubic Bézier flattening segments
```

## 2. Luminance

```text
luma(r, g, b) = (77·r + 150·g + 29·b + 128) >> 8        r, g, b, result ∈ 0..255
```

(77 + 150 + 29 = 256, so luma(255,255,255) = 255.)

## 3. Grid derivation (grid-v1)

Inputs: source width `W`, height `H` (the crop rect; adapters apply `fit` before this), profile cell size `cw × ch` (reference px), user options.

```text
given columns C:   R = max(1, rdiv(H · C · cw, W · ch))
given rows R:      C = max(1, rdiv(W · R · ch, H · cw))
given both:        use both (stretch)
given neither:     C = DEFAULT_COLUMNS, derive R
```

`C` and `R` are also clamped to ≥ 1. The crop rect for direct `renderAscii` is the full source.

## 4. Source reduction (reduce-v1)

Reduce the source to exactly `SW × SH` RGBA samples, `SW = 8C`, `SH = 8R`. For target sample `(tx, ty)`:

```text
x0 = idiv(tx · W, SW)        x1 = max(x0 + 1, idiv((tx+1) · W, SW))
y0 = idiv(ty · H, SH)        y1 = max(y0 + 1, idiv((ty+1) · H, SH))
```

Over the source rect `[x0, x1) × [y0, y1)` accumulate with **alpha weighting** (`a = 255` for every pixel when `alpha: 'ignore'`):

```text
sr = Σ r·a     sg = Σ g·a     sb = Σ b·a     sa = Σ a     n = pixel count

sa = 0:  sample = (0, 0, 0, 0)
sa > 0:  sample = (rdiv(sr, sa), rdiv(sg, sa), rdiv(sb, sa), rdiv(sa, n))
```

Hardware texture filtering is never a valid implementation of this step.

## 5. Cell features

Cell `(cx, cy)` reads its 64 samples at reduced coordinates `(cx·8 + i, cy·8 + j)`, sample index `k = j·8 + i` (row-major, `k = 0` is top-left). Per cell compute:

```text
luma[k]                       per sample
minLuma, minIdx               strictly-less scan ⇒ lowest index wins ties
maxLuma, maxIdx               strictly-greater scan ⇒ lowest index wins ties
sumR, sumG, sumB, sumLuma     over all 64 samples
cellAlpha = rdiv(Σ alpha[k], 64)
meanR = rdiv(sumR, 64)   (same G, B)
meanLuma = rdiv(sumLuma, 64)
```

**Transparent cell** (`alpha: 'mask'` and `cellAlpha < ALPHA_THRESHOLD`): emit the blank glyph (§6), zero colors, flag `TRANSPARENT`. Skip everything else.

## 6. Flat path

If `maxLuma − minLuma < flatThreshold` the cell is flat. Let the **blank glyph** be the glyph `' '` (U+0020) if present, else the glyph with minimum `coverage16` (ties → lowest glyph id).

Per color mode:

```text
full:        glyph = blank glyph; fg = bg = (meanR, meanG, meanB); flag FLAT
             (with both colors free every glyph reconstructs identically — pin the stable choice)

mono:        target = rdiv((inkLight ? meanLuma : 255 − meanLuma) · covMax, 255)  (inkLight per §8)
             covMax = max coverage16 over the profile's glyphs (0 ⇒ 1)
             glyph = argmin |coverage16(g) − target|, ties → lowest id; flag FLAT

foreground:  glyph as mono; fg = (meanR, meanG, meanB); flag FLAT
             (deliberate aesthetic pin: density tracks luminance, not pure reconstruction,
              which would degenerate to the max-coverage glyph in flat regions)
```

(`covMax` is the densest glyph the profile actually has, so the ramp spans the range the charset can express.)

The target is normalized into the charset's own coverage range. It previously was not — it
mapped luma onto the full 0..65535 as `luma · 257` — on the rationale that the structural
rerank saturates at the densest glyph for bright cells in the same way, so leaving the flat
target unnormalized kept flat and structural neighbors consistent.

That rationale does not survive measurement. Structural cells do **not** saturate at the
densest glyph: their rerank minimizes reconstruction error against fixed colors, so a
half-bright cell lands on a half-inked glyph. Measured on Geist Mono / `ascii`, a
high-contrast cell plateaus at `w` (coverage 11656) while the old flat target reached `@`
(16906) for every cell above ~26% luma. The two paths were never consistent; the
unnormalized target simply sat _above_ the structural plateau instead of below it.

What it cost was the whole upper range: with `@` at 16906/65535, a fixed 65535 ceiling put
every flat cell brighter than ~26% luma past what any glyph could reach, collapsing roughly
two thirds of the luma range onto one glyph. A linear gradient rendered as six glyphs of
ramp followed by eighteen cells of solid `@`.

Normalizing makes flat regions span the range the charset can express. It does not make
flat and structural agree — nothing can, since the structural plateau depends on the cell's
shape and not only on its mean — but it makes each correct on its own terms.

## 7. Binary source mask

Non-flat cells only.

```text
dark  = (r, g, b) of sample minIdx
light = (r, g, b) of sample maxIdx

for each k:  dd = (r−dark.r)² + (g−dark.g)² + (b−dark.b)²
             dl = (r−light.r)² + (g−light.g)² + (b−light.b)²
             bit k = 1  ⇔  dd ≤ dl          (tie ⇒ dark side)
```

Bit `k` set means the sample belongs to the **dark** side. Layout: `maskLo` holds bits 0–31 (rows 0–3), `maskHi` bits 32–63 (rows 4–7); bit `k` is `1 << (k mod 32)`.

## 8. Polarity

Glyph masks use **bit 1 = ink**. Polarity — which side of the source mask corresponds to ink — is **derived from the reconstruction objective**, never a free flag. (A free flag would let the prefilter shortlist shapes that the rerank objective then rejects; the rerank against fixed colors always decides polarity from those colors, so the shortlist must agree with them.)

```text
mono:        inkLight = luma(foreground) ≥ luma(background)      (tie ⇒ true)
foreground:  inkLight = luma(background) < 128                   (ink contrasts the fixed backdrop)
full:        no polarity — orientation is absorbed by color fitting (§10)

matchMask = inkLight ? ~sourceMask : sourceMask                  (mono / foreground)
```

There is no `invert` matcher option in structural-v1: swapping the fixed colors flips polarity coherently across prefilter, flat path, and rerank. structural-v1 emits **no inverted flag** — the frame flag bit is reserved but always 0.

## 9. Candidate prefilter

For glyph `g` with mask `(gLo, gHi)`:

```text
d = popcount(mLo XOR gLo) + popcount(mHi XOR gHi)

mono / foreground:  score(g) = d           using matchMask (§8)
full:               score(g) = min(d, 64 − d)     using sourceMask directly
```

Keep the **first K = 8 glyphs in (score asc, glyph id asc) order**: iterate glyphs in id order, insert into a sorted best-8 list positioned after equal scores, replace the worst only on strictly smaller score. One candidate per glyph (no separate inverted candidates — in `full`, `min(d, 64−d)` already accounts for orientation and rerank error is orientation-independent).

## 10. Exact rerank

Evaluate candidates **in their prefilter order**. For candidate glyph `g`, partition the 64 samples by g's own mask: ink set `I` (bit 1), background set `B` (bit 0). Candidate colors:

```text
full:        fg = mean over I, bg = mean over B, each channel rdiv(sum, count)
             empty side ⇒ that color copies the other side's mean
mono:        fg = options.foreground (DEFAULT_FG), bg = options.background (DEFAULT_BG)
foreground:  fg = mean over I (I empty ⇒ fg = options.background), bg = options.background
```

Reconstruction error, u32-exact (max 64 · 3 · 255² = 12,484,800):

```text
err(g) = Σ over k:  c = (bit k of g) ? fg : bg
                    (r[k]−c.r)² + (g[k]−c.g)² + (b[k]−c.b)²
```

Early exit (`err ≥ best ⇒ break`) is permitted; it cannot change the winner. **Winner: strictly smaller error replaces; ties keep the earlier candidate** (i.e. lowest (score, id) order). Output fitted colors are the winner's u8-rounded means — they are part of the algorithm, not a rendering detail.

## 11. Output packing

```text
glyphIds:    Uint16Array, one per cell, row-major
foreground:  Uint32Array, packed r | g<<8 | b<<16 | a<<24   (LE bytes: r,g,b,a)   full + foreground modes
background:  Uint32Array, same packing                       full mode only
flags:       Uint16Array   bit0 FLAT, bit1 TRANSPARENT, bit2 reserved (INVERTED, always 0 in structural-v1)
```

Alpha is 255 except transparent cells (all fields 0, flags bit1 set).

## 12. Character sets

Normalization is by Unicode code point (`Array.from`). Duplicate code points are an error. Space is never removed.

```text
'ascii'         U+0020 .. U+007E in code-point order (95 glyphs)
'ascii-blocks'  'ascii' followed by:
                U+2580 ▀  U+2584 ▄  U+2588 █  U+258C ▌  U+2590 ▐
                U+2591 ░  U+2592 ▒  U+2593 ▓
                U+2596 ▖  U+2597 ▗  U+2598 ▘  U+2599 ▙  U+259A ▚
                U+259B ▛  U+259C ▜  U+259D ▝  U+259E ▞  U+259F ▟
                (113 glyphs)
```

The compiler errors on any charset entry the font has no glyph for — never silent tofu.

**Derived subsets.** `subsetProfile(profile, characters)` narrows a built profile to a character subset at runtime: glyph ids are remapped in the given character order, per-glyph data (mask, coverage, atlas tile, shape6 vector) is carried over byte-for-byte, and the atlas is repacked with the §13 layout rule. Because per-glyph data is charset-independent, matching against a subset is identical to matching against a profile compiled with that charset. A shape6 LUT is dropped (its entries are argmins over the parent charset). The subset gets a distinct content-derived fingerprint; duplicate or missing characters are errors, mirroring compiler charset rules.

## 13. Rasterization (raster-v1)

Deterministic in-house scanline rasterizer over font outline data. System rasterizers (Cairo, FreeType, CoreText, browser canvas) are forbidden in the compiler.

### Cell box and scale

```text
unitsCell = ascent − descent              (hhea; descent is negative; lineGap ignored in v1)
cellH     = REF_GLYPH_HEIGHT = 64
cellW     = rdiv(advance · 64, unitsCell)     advance of U+0020; font must be monospace (equal advances) or the build errors
baseline  = rdiv(ascent · 64, unitsCell)      px from cell top (informational)
```

### Coordinate mapping (26.6 fixed point, y-down)

```text
toFx(v)     = rdiv(v · 64 · 64, unitsCell)        font units → 26.6 px
baselineFx  = rdiv(ascent · 64 · 64, unitsCell)
px = toFx(X)          py = baselineFx − toFx(Y)
```

### Outline flattening

Path commands (moveTo / lineTo / quadraticCurveTo / bezierCurveTo / closePath) become line segments in 26.6 space. Quadratics flatten to 16 equal-`t` segments, cubics to 24, evaluated in exact integers, e.g. quadratic at `i` of `n = 16`:

```text
P = rdiv((n−i)²·P0 + 2i(n−i)·P1 + i²·P2, n²)      per axis
```

cubic at `i` of `n = 24`: weights `(n−i)³, 3i(n−i)², 3i²(n−i), i³`, denominator `n³`. An open contour is closed implicitly at `moveTo`/end. Horizontal segments are dropped.

### Coverage sampling

Subsample grid: `S = 4` per pixel axis. Subsample `(sx, sy)` has center `(sx·16 + 8, sy·16 + 8)` in 26.6 (16 = 64/S). For each subsample row `y`:

- A segment `(x0,y0)→(x1,y1)` crosses iff `min(y0,y1) ≤ y < max(y0,y1)` (half-open); direction `dir = +1` if `y1 > y0` else `−1`.
- Crossing x: `xAt = x0 + fdiv((x1−x0)·(y−y0), y1−y0)`.
- Sort crossings by `xAt` ascending (equal `xAt` order is irrelevant: all crossings with `xAt ≤ X` are summed before evaluating a sample).
- Sample at `X` is inside iff the winding sum of crossings with `xAt ≤ X` is nonzero (non-zero rule).

Glyphs are clipped to the cell box: only subsamples with `0 ≤ sx < cellW·S`, `0 ≤ sy < cellH·S` are evaluated.

### Derived data

```text
pixel alpha        a(px) = rdiv(hits(px) · 255, 16)                       hits ∈ 0..16
mask cell of (sx, sy):  col = idiv(sx · 8, cellW·S), row = idiv(sy · 8, cellH·S)
mask bit           1  ⇔  2 · maskHits ≥ maskTotal                          (tie ⇒ ink)
coverage16         rdiv(totalHits · 65535, cellW · cellH · 16)
```

Thin strokes (`_`, `-`, `.`, …) legitimately yield empty or sparse masks at the 0.5 threshold. This mirrors source-side classification — a thin dark line blends its 8×8 sample toward the light endpoint on both sides of the match — so such glyphs are selected by the flat path via coverage, not by structure. Changing the threshold is a versioned-algorithm experiment, not a tweak.

### Atlas layout

Regular grid, one glyph per tile, ink origin at `(ATLAS_PADDING, ATLAS_PADDING)`:

```text
pitchW = nextPow2(cellW + 2·ATLAS_PADDING)      pitchH = nextPow2(cellH + 2·ATLAS_PADDING)
atlasColumns = ceil(sqrt(glyphCount))            (integer loop)
atlasRows    = ceil(glyphCount / atlasColumns)
tile of glyph id:  col = id mod atlasColumns, row = idiv(id, atlasColumns)
```

R8, deterministic packing, power-of-two pitch so padding survives mip levels.

## 14. Profile binary (asciip/1)

Header (offset, type, meaning):

```text
0    u8×4   magic 'A','S','C','I'
4    u32    formatVersion = 1
8    u32    sectionCount
12   u32    glyphCount
16   u32    atlasWidth
20   u32    atlasHeight
24   u32    atlasPitchW
28   u32    atlasPitchH
32   u32    atlasCellW
36   u32    atlasCellH
40   u32    atlasPadding
44   u32    atlasColumns
48   u32    baselinePx
52   u32    referenceGlyphHeight
56   i32    unitsPerEm
60   i32    ascent
64   i32    descent
68   i32    lineGap
72   i32    advanceUnits
76   u8×32  charsetHash   (SHA-256)
108  u8×32  fontHash      (SHA-256)
140  u8×32  fingerprint   (SHA-256)
172  section table: sectionCount × { u32 type, u32 offset, u32 byteLength }
```

Sections start 4-byte aligned, in ascending type order. Unknown types must be skipped by decoders.

```text
1  glyphTable   u32 count, u32 offsets[count+1] into blob, utf8 blob
2  (reserved: per-glyph metrics)
3  masks        glyphCount × { u32 lo, u32 hi }
4  coverage     glyphCount × u16
5  (reserved: on-pixel CSR)
6  atlas        atlasWidth · atlasHeight × u8
7  (reserved: shape6 vectors)
8  (reserved: shape6 LUT)
9  metadata     utf8 JSON { id, charset, fontFamily?, fontWeight?, compilerVersion }  (small; key order as listed)
```

Hashes:

```text
charsetHash = SHA-256(utf8(glyphs joined by U+0000))
fontHash    = SHA-256(font bytes)
fingerprint = SHA-256(utf8("asciip/1|structural-v1|raster-v1|font:<fontHash hex>|charset:<charsetHash hex>|H:64|S:4|pad:4|quad:16|cubic:24"))
```

Profile output must be byte-for-byte reproducible from identical inputs.

## 15. Frame binary (asciif/1)

```text
0    u8×4   magic 'A','S','C','F'
4    u32    formatVersion = 1
8    u32    columns
12   u32    rows
16   u32    colorMode      0 mono, 1 foreground, 2 full
20   u32    sectionCount
24   u8×32  profileFingerprint
56   section table as in asciip/1
```

Sections (planar for compressibility; a section is omitted when its data is absent or all-zero):

```text
1  glyphIds  N × u16
2  fgR  N × u8      3  fgG      4  fgB
5  bgR  N × u8      6  bgG      7  bgB
8  flags     N × u16
9  metadata  utf8 JSON { profileId, algorithm: "structural-v1" }
10/11 (reserved: fgA / bgA planes)
```

The profile is referenced by fingerprint, never embedded. Decoders require the matching profile and must fail with a remediation message on mismatch.

## 16. Tie-break index

Every comparison in the pipeline, in one place:

```text
min/max luminance scan          strict compare ⇒ lowest sample index wins
mask classification tie         dd == dl ⇒ dark side (bit 1)
mono polarity tie               luma(fg) == luma(bg) ⇒ inkLight = true
prefilter equal score           lower glyph id first (iteration order + insert-after-equals)
full-mode d == 64−d             score is the min; orientation is irrelevant to rerank
rerank equal error              earlier candidate in (score, id) order wins
flat coverage tie               lowest glyph id
blank-glyph fallback tie        lowest glyph id
fitted mean rounding            rdiv (round half up)
```

## 17. Conformance

An implementation conforms iff, for identical `(profile bytes, source samples, options)`, it produces identical `glyphIds`, `foreground`, `background`, and `flags` arrays — bit-for-bit, no tolerance. The CPU implementation in `@ascii-fx/core` is the reference; golden fixtures live in `fixtures/golden`.

## 18. shape6-v1 (approximate matcher, explicit opt-in)

Harri-inspired 6D directional descriptor (spec §5). **Never a silent fallback** — selected only via `matcher: 'shape6'`, and quality versus exact is reported per spec §36 in `apps/benchmarks/RESULTS.md`.

### Source descriptor (integer)

Lumas are polarity-adjusted into ink-bright space first: `pl[k] = inkLight ? luma[k] : 255 − luma[k]` (inkLight per §8; `full` mode uses inkLight = true). Regions on the 8×8 sample grid: rows 0–3 / rows 4–7, cols 0–3 / cols 4–7, the four 4×4 quadrants, center = rows 2–5 × cols 2–5 (16 samples), ring = the other 48.

```text
v0 = rdiv(Σ pl, 64)                                mean            0..255
v1 = rdiv(Σtop, 32) − rdiv(Σbottom, 32)            vertical        −255..255
v2 = rdiv(Σleft, 32) − rdiv(Σright, 32)            horizontal      −255..255
v3 = rdiv(ΣTL + ΣBR − ΣTR − ΣBL, 32)               diagonal        −255..255
v4 = rdiv(Σcenter, 16) − rdiv(Σring, 48)           center          −255..255
v5 = rdiv(Σ |pl − v0|, 64)                         detail          0..128
```

### Glyph vectors (compile time)

Same formulas over the 8×8 mask-cell grid with per-cell luma = coverage · 255, coverage = maskHits/maskTotal (raster-v1 subsample counts), means in float64, stored as `Float32Array` (section 7). Deterministic for identical inputs.

### Matching

Distance = unweighted squared 6D distance (source ints vs glyph f32); argmin, ties → lowest glyph id. Flat and transparent cells take exactly the structural paths (§5–§6). Colors are fitted from the winning glyph's mask partition exactly as §10.

### 3-bit quantization and LUT (section 8)

```text
q0 = v0 >> 5
q1..q4 = clamp((v + 256) >> 6, 0, 7)
q5 = min(7, v5 >> 4)
index = q0 | q1<<3 | q2<<6 | q3<<9 | q4<<12 | q5<<15        (8⁶ = 262,144)

bucket centers: c0 = q·32 + 16;  c1..4 = q·64 − 224;  c5 = q·16 + 8
lut3[index] = argmin glyph distance to the bucket center (ties → lowest id), u16
```

Runtime uses `lut3` when present, else brute-force 6D. `lut3TopK` remains reserved (spec §6) pending measured need.

### 19. ramp-v1 (lowest-cost effect matcher)

`matcher: 'ramp'`: every non-transparent cell uses the flat-path coverage mapping (§6) on its mean luma — no structure at all. Colors are fitted from the winning glyph's mask partition exactly as §10 (same rule as shape6). Branded as an effect, not as quality (spec §5).

---

## C. chromatic-v1

`matcher: 'chromatic'`. A **separate algorithm**, not an approximation of structural-v1. It exists for glyph sets whose colour is part of the glyph — colour emoji — where structural-v1's central move is unavailable.

structural-v1 matches a 1-bit mask and _fits_ colour to it, which is exactly why its rerank is exact: with foreground and background free, the best colours for a given mask are the means of the two sample sets. A colour glyph's colour is baked, so there is nothing to fit, and the objective collapses to direct squared error against the glyph's own samples.

Requires a profile carrying `chromatic` glyph data. Emits `colorMode: 'glyph'` and **no colour planes**; the colour lives in the glyph. `color: 'glyph'` is an output mode only — passing it to any other matcher is an error.

### C1. What carries over unchanged

`grid-v1` (§3), `reduce-v1` (§4), the transparent-cell rule (§5), and output packing (§11) apply exactly as written. Cell aspect comes from the profile, so a square-celled emoji profile derives different rows from a text profile at the same column count; that is §3 doing its job, not a new rule.

### C2. What does not apply

- **§6 flat path** — there is no coverage ramp to fall back to, and no fitted colour that would make flat cells degenerate.
- **§8 polarity** — nothing is fitted, so there is no orientation to derive.
- **§9 candidate prefilter** — the search is exhaustive. Over a curated palette a mean-colour shortlist costs more reconstruction quality than it saves time, and a shortlist that agreed with the objective would have to evaluate the objective.

### C3. Glyph descriptor and backdrop composite

Each glyph carries **64 straight-alpha RGBA samples**, row-major, sample index `k = j·8 + i` — the same layout and the same `reduce-v1` rule the source goes through. Straight rather than premultiplied so the composite below stays exact in integers.

A glyph is matched as it will be drawn, so it is composited over the backdrop first. With backdrop `bd` = `options.background` (default `DEFAULT_BG`):

```text
recon[g][k].r = rdiv(sample[g][k].r · sample[g][k].a + bd.r · (255 − sample[g][k].a), 255)      (same for G, B)
```

This depends only on the glyph table and the backdrop, never on the source, so it is computed once per backdrop rather than once per cell or once per candidate. Implementations may hoist it as far as they like; the values are fixed by the formula above.

### C4. Objective

For every non-transparent cell, over all 64 samples and all `G` glyphs:

```text
err(g) = Σ over k:  (r[k] − recon[g][k].r)² + (g[k] − recon[g][k].g)² + (b[k] − recon[g][k].b)²
```

u32-exact; the maximum is 64 · 3 · 255² = 12,484,800, as in §10. Early exit (`err ≥ best ⇒ break`) is permitted and cannot change the winner. **Winner: strictly smaller error replaces, so ties keep the lowest glyph id.**

### C5. Hysteresis

Optional, default off. Given `options.previous` (the previous frame's glyph ids on the same grid) and `options.hysteresis` = `h`, let `inc = previous[cell]`:

```text
keep inc  ⇔  inc ≠ winner  ∧  inc < G  ∧  1000 · err(winner) ≥ err(inc) · (1000 − round(h · 1000))
```

`err(inc)` is evaluated **in full** — the incumbent may have been early-exited out of the search, and a partial sum would compare unequal quantities. The `1000 ·` scaling keeps the comparison in integers; `h` is quantised to a thousandth.

A `previous` whose length does not match the derived grid is an error, not a silently ignored argument.

**Hysteresis must not cross a discontinuity.** It is biased toward the incumbent by construction, so unlike exact temporal reuse it does not self-correct: feeding it glyph ids from a different source leaves that source ghosted into wherever the new one is ambiguous, and at `h = 0.1` a cell keeps its incumbent whenever the challenger is less than ~11% better, which in flat regions is most of them. Callers pass `previous` explicitly and so own this; the WebGPU backend, which keeps the previous frame in its own cells buffer, suppresses hysteresis for one frame after any source, grid, or option change.

Emoji differ far more from one another than text glyphs do, so a near-tie that flips frame to frame reads as a strobe rather than as texture. Measured against structural-v1 on identical animated frames, chromatic-v1 flips **less** often unaided — baked colour is a coarser quantisation than fitted colour, so small input changes cross a palette boundary less readily — and `h = 0.1` removes roughly a third of the residual excess churn for under 1% reconstruction error.
