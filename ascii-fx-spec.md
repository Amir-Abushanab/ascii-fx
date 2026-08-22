# ASCII FX — Implementation Specification

> Canonical package scope: `@ascii-fx/*`.
>
> Goal: the highest-fidelity, highest-performance, most usable ASCII rendering library for the web. Static images should be trivial. Video, canvas, Three.js scenes, hover effects, interactive shaders, and 3D glyph effects should be first-class. Power must not make the common path complicated.
>
> Package identity: **ASCII FX**, published under the npm organization **`@ascii-fx`**. The name intentionally describes the broader category—high-fidelity ASCII rendering plus realtime visual effects—rather than only the masking/matching mechanism.

---

# 0. Product principles

1. **Shape, not brightness.**
   Default output must structurally reconstruct the source rather than map luminance to an ASCII ramp.

2. **Correctness before approximation.**
   The canonical matcher is an exact structural matcher based on Ditherlab's 8×8 algorithm:
   - 64 source samples/cell
   - structural binary mask
   - Hamming top-K prefilter
   - exact RGB reconstruction rerank
   - fitted foreground/background colors
   - inverted-mask candidates where applicable
   - flat-cell coverage fast path

3. **GPU-first, not GPU-only.**
   WebGPU is the flagship realtime path. CPU is the reference implementation and universal fallback.

4. **Nothing static happens per frame.**
   Font rasterization, glyph masks, glyph metrics, coverage, atlases, optional shape6 descriptors/LUTs, etc. must be precomputed whenever possible.

5. **Interaction should usually not trigger rematching.**
   Hover, reveal, displacement, waves, color shifts, distortion, transitions, etc. operate on the already-generated glyph field unless they actually change the source structure.

6. **Zero-config must remain good.**
   Users should be able to render ASCII with one component/function. Build tooling and advanced backends are progressive optimizations, never prerequisites.

7. **No hidden quality degradation.**
   `auto` may select a backend; it must not silently switch from exact matching to approximate matching.

8. **Performance work must be benchmark-backed.**
   LUTs, clustering, reduced sampling, fused passes, subgroup operations, WASM, etc. are accepted only when measurements justify them.

---

# 1. Monorepo/package topology

Use a workspace monorepo.

```text
packages/
  core/
  compiler/
  gpu/
  three/
  react/
  react-three/
  vite/

apps/
  docs/
  playground/
  benchmarks/

fixtures/
  fonts/
  images/
  videos/
  golden/
```

## `@ascii-fx/core`

Framework-, DOM-, renderer-, and bundler-agnostic.

Owns:

- public types
- `AsciiProfile`
- `AsciiFrame`
- CPU structural matcher
- shape6 matcher/reference implementation
- source-independent matching logic
- profile/frame decoding
- color math
- character sets
- serialization
- text/ANSI/HTML export
- quality/reference tests
- backend capability types

Must:

- have no top-level `window`, `document`, `navigator`, Canvas or WebGPU access
- touch browser APIs only behind call-time feature detection; Node callers pass raw pixel input, and element decoding may live in a `core/dom` subpath export
- be importable during SSR
- remain deterministic for identical profile + source samples + options
- contain the reference implementation against which GPU implementations are tested

## `@ascii-fx/compiler`

Node/build-time only.

Owns:

- font loading
- deterministic glyph rasterization
- glyph atlas creation
- profile generation
- static-image precomputation
- `.asciip` / `.asciif` binary generation
- CLI

```bash
ascii-fx profile build
ascii-fx frame build
ascii-fx inspect profile.asciip
```

Never imported by browser runtime packages.

## `@ascii-fx/gpu`

Raw high-performance renderer.

Owns:

- WebGPU capability detection
- WebGPU pipelines
- source sampling
- exact structural matching
- glyph-field generation
- fullscreen compositing
- generic `<canvas>` rendering
- GPU buffers/textures
- interaction uniforms
- optional CPU fallback orchestration

No React/Three dependency.

## `@ascii-fx/three`

Three.js-specific integration.

Owns:

- `AsciiPass`
- render-target integration
- scene/camera source integration
- TSL implementation/wrapping where necessary
- fullscreen postprocessing
- instanced 3D glyph renderer
- Three texture/render-target helpers

Do **not** make Three.js the canonical algorithm implementation. It must conform to `core`.

## `@ascii-fx/react`

Framework ergonomics.

Owns:

```tsx
<AsciiImage />
<AsciiVideo />
<AsciiCanvas />
```

plus:

```ts
useAscii()
useAsciiProfile()
useAsciiSupport()
```

Does not contain matching logic.

## `@ascii-fx/react-three`

React Three Fiber-specific bindings.

Owns:

```tsx
<AsciiEffect />
<AsciiGlyphs />
useAsciiEffect()
```

Keep separate from generic React so ordinary React users do not pull R3F/Three into their bundle.

## `@ascii-fx/vite`

Thin integration around `compiler`.

Owns:

- `ascii()` Vite plugin
- profile compilation
- profile virtual modules
- static frame compilation
- asset fingerprinting
- HMR
- caching

Do not put compilation logic here; call `@ascii-fx/compiler`.

---

# 2. Public API philosophy

The advanced architecture must collapse into simple APIs.

## Vanilla: easiest path

```ts
import { renderAscii } from '@ascii-fx/core'

const frame = await renderAscii(image, {
  profile,
  columns: 120,
})
```

CPU/reference path. Returns `AsciiFrame`.

## GPU canvas

```ts
import { createAsciiRenderer } from '@ascii-fx/gpu'

const ascii = await createAsciiRenderer({
  canvas,
  profile,
  backend: 'auto',
})

ascii.setSource(image)
ascii.render()
```

Animation:

```ts
ascii.setSource(video)
ascii.start()
```

Cleanup:

```ts
ascii.destroy()
```

## React

```tsx
<AsciiImage src="/hero.jpg" alt="Portrait" profile={profile} />
```

Interactive:

```tsx
<AsciiImage
  src="/hero.jpg"
  profile={profile}
  interaction={{
    type: 'reveal',
    radius: 0.18,
    feather: 0.08,
  }}
/>
```

Video:

```tsx
<AsciiVideo src="/video.mp4" profile={profile} />
```

## Three.js

```ts
const ascii = new AsciiPass({
  profile,
})

composer.addPass(ascii)
```

Dynamic controls:

```ts
ascii.set({
  columns: 180,
  edgeEnhancement: 1.5,
})

ascii.pointer.set(x, y)
```

## R3F

```tsx
<AsciiEffect profile={profile} columns={180} interaction="reveal" />
```

## Rule

A beginner should not need to understand:

- glyph atlases
- compute shaders
- storage textures
- candidate counts
- font profiles
- workgroups
- LUTs

to get excellent output.

---

# 3. Core data model

## `AsciiProfile`

Represents everything dependent on:

```text
font bytes
+ font face/index
+ font weight/style
+ charset
+ rasterization settings
+ matcher profile version
```

Conceptual shape:

```ts
interface AsciiProfile {
  version: number
  id: string
  fingerprint: string

  glyphs: readonly string[]
  glyphCount: number

  metrics: GlyphMetrics
  atlas: GlyphAtlas

  structural: StructuralGlyphData

  shape6?: Shape6GlyphData

  metadata: {
    fontFamily?: string
    fontWeight?: number
    charset: string
    compilerVersion: string
  }
}
```

## Structural data

Minimum:

```ts
interface StructuralGlyphData {
  masksLo: Uint32Array
  masksHi: Uint32Array

  coverage: Uint16Array // 0..65535 = coverage 1.0 (integer per §4.0)

  // Optional CPU accelerator:
  onOffsets?: Uint32Array
  onIndices?: Uint8Array
}
```

## shape6 data

Optional:

```ts
interface Shape6GlyphData {
  vectors6: Float32Array

  lut3?: Uint16Array
  lut3TopK?: Uint16Array
}
```

Used only by the explicit shape6 matcher.

## `AsciiFrame`

Renderer-independent result:

```ts
interface AsciiFrame {
  columns: number
  rows: number

  glyphIds: Uint16Array

  foreground?: Uint32Array
  background?: Uint32Array

  flags?: Uint16Array

  profile: AsciiProfile
}
```

Methods:

```ts
frame.toText()
frame.toAnsi()
frame.toHTML()
frame.getCell(x, y)
```

No giant nested object grid internally.

Use packed typed arrays.

---

# 4. Default matching algorithm: Structural Exact

Default:

```ts
matcher: 'structural'
```

The CPU implementation defines correctness.

`ALGORITHM.md` is the normative companion: it pins every constant, formula, bit layout, and tie-break with pseudocode and golden vectors. Ambiguity is resolved there, never by implementation accident.

## 4.0 Determinism ground rules

- **All matcher arithmetic is integer.** Integer luminance, integer thresholds, fitted means rounded to u8, reconstruction error as u32 sums of squared byte deltas (max 64 · 3 · 255² ≈ 12.5M). Integer addition is associative, so CPU and GPU agree bit-for-bit regardless of reduction order — and early exit (§7.6) can never change a winner.
- **Every comparison has a pinned total order.** Equal min/max luminance → lowest sample index. Equidistant pixel between endpoints → dark side. Equal Hamming distance or equal reconstruction error → lowest glyph ID, non-inverted before inverted. GPU reductions implement the same order.
- **Source reduction is part of the algorithm.** Before matching, area-average the source (integer box filter) to exactly `8·columns × 8·rows`; the 64 samples per cell are texel reads from that grid. Hardware bilinear/mip filtering is never part of exact semantics — it is not bit-exact across devices.

## 4.1 Source cell

Each ASCII cell corresponds to an **8×8 source sample block**.

```text
8 × 8 = 64 RGB samples
```

Store locally:

```text
RGB
luminance
minimum luminance/index
maximum luminance/index
RGB totals
luminance total
```

Luminance is integer — `(77·R + 150·G + 29·B + 128) >> 8` — and equal-luminance ties resolve to the lowest sample index.

## 4.2 Flat-cell path

If:

```text
maxLuma - minLuma < flatThreshold
```

default:

```ts
flatThreshold = 15 // integer luma units (≈ 0.06 × 255)
```

The flat path is defined per color mode:

- `mono` / `foreground`: choose the glyph whose measured coverage is closest to the polarity-mapped mean luminance (ties → lowest glyph ID); `foreground` fits the glyph color to the mean cell color.
- `full`: emit space with foreground = background = mean cell color — once both colors are free, every glyph reconstructs identically, so pin the stable choice.

Make threshold configurable but keep the reference default stable.

## 4.3 Binary source mask

For non-flat cells:

1. endpoints are the RGB values of the minimum- and maximum-luminance samples (luma ties → lowest index)
2. classify every source pixel by squared RGB distance to each endpoint; equidistant pixels go to the dark endpoint
3. produce a 64-bit mask — row-major, bit 0 = top-left, set bit = dark ("ink") side:

```text
maskLo: u32   // rows 0–3
maskHi: u32   // rows 4–7
```

Support inversion.

## 4.4 Candidate prefilter

For every glyph:

```text
distance =
  popcount(maskLo XOR glyphLo)
+ popcount(maskHi XOR glyphHi)
```

Keep best:

```ts
K = 8
```

Inversion exists only in `full` mode — the only mode that can render a complement, because orientation is absorbed by swapping which fitted color is foreground. There, score each glyph by `min(d, 64 − d)` and record orientation; a glyph and its inversion have identical reconstruction error, so dedupe per glyph and never spend two K slots on the same shape. `mono` and `foreground` use `d` directly.

## 4.5 Exact rerank

For each of top K:

1. divide the source pixels into glyph-ink vs glyph-background using the candidate's mask
2. compute fitted foreground RGB mean
3. compute fitted background RGB mean
4. reconstruct all 64 source samples
5. compute total squared RGB reconstruction error
6. early-exit once candidate error ≥ current best
7. select lowest-error candidate

## 4.6 Color modes

Public modes:

```ts
color: 'mono' | 'foreground' | 'full'
```

### `mono`

Fixed foreground/background.

### `foreground`

Glyph color fitted/sampled; background transparent/fixed.

### `full`

Fitted foreground + fitted background per cell.

`full` is the maximum-reconstruction-quality mode.

---

# 5. shape6 mode and directional edge enhancement

Do **not** replace the default structural matcher with Harri's 6D matcher.

Expose two separate concepts.

## Matcher

```ts
matcher: 'structural' | 'shape6' | 'ramp'
```

### `structural`

Default. Highest fidelity baseline.

### `shape6`

Harri-style six-dimensional matching.

Benefits:

- much less source information
- very fast lookup
- excellent candidate for dense LUT acceleration

Not allowed as an invisible fallback from structural mode.

### `ramp`

Brightness-based lowest-cost fallback/effect.

Not branded as equivalent quality.

## Edge preprocessing

Separate option:

```ts
edgeEnhancement:
  | false
  | {
      mode: 'directional'
      strength?: number
      exponent?: number
    }
```

This may be applied before structural matching.

Important:

```text
Structural matcher + directional edge preprocessing
```

is an experimental visual combination.

It must be A/B tested against unmodified structural matching before any nonzero default is chosen.

Default v1:

```ts
edgeEnhancement: false
```

---

# 6. shape6 LUT optimization

Only applies to `shape6`.

For a six-component descriptor quantized to 3 bits/component:

```text
8⁶ = 262,144 states
```

A single `u8/u16` winner LUT is tiny.

Optional top-K LUT:

```text
descriptor bucket
→ candidate glyph IDs
→ exact unquantized 6D rerank
```

Generate this **at compile time**.

Do not use k-d trees/HNSW for ordinary ASCII.

If 6D exactness matters, use:

```text
quantized LUT shortlist
+ unquantized rerank
```

---

# 7. WebGPU architecture

Primary objective:

```text
source texture
→ structural compute
→ compact glyph field
→ composite
```

Zero CPU readback during normal rendering.

## 7.1 Preferred pipeline

```text
SOURCE
  ↓
Compute A: cell feature extraction
  ↓
CellFeatures buffer
  ↓
Compute B: candidate search + exact rerank
  ↓
AsciiFrame GPU buffers/textures
  ↓
Fullscreen composite
```

Benchmark fused vs split pipeline before finalizing.

Do not assume fewer dispatches are automatically faster.

## 7.2 Compute A: source sampling

Natural workgroup:

```text
8 × 8 threads
```

One workgroup per ASCII cell.

Each invocation:

```text
loads one source sample
computes RGB/luma
writes workgroup-local values
```

Then cooperative reduction computes:

```text
min luminance + index
max luminance + index
RGB totals
luminance total
flat-cell status
binary mask
```

Use workgroup/shared memory.

Do not have one invocation perform 64 global texture loads unless benchmarks prove it faster.

## 7.3 Binary mask construction

Portable implementation first.

Possible implementations to benchmark:

```text
A. workgroup parallel reduction
B. two lanes each pack 32 bits
C. subgroup ballot when supported
```

Subgroups may optimize capable hardware but cannot be required for correctness.

## 7.4 Compute B: Hamming candidate search

ASCII printable set is ~95 glyphs.

For that size, exact all-glyph Hamming search is cheap enough that elaborate ANN should not be assumed necessary.

Parallelize across workgroup lanes.

Candidate state:

```text
glyph ID
Hamming score
inverted flag
```

Find exact top 8.

Benchmark:

```text
parallel partial reduction
vs
single-lane scan after cooperative feature extraction
```

Pick measured winner per backend/device class if useful.

## 7.5 Candidate reranking

Evaluate eight candidates using exact 64-sample RGB reconstruction objective.

Parallelization options:

```text
candidate-per-lane-group
candidate-per-subgroup
pixel-parallel reduction
serial candidate evaluation inside one lane
```

Do not choose from intuition.

Maintain exact output semantics.

## 7.6 Early exit

CPU reference uses early termination of reconstruction-error evaluation.

GPU implementation should benchmark whether branch divergence makes this beneficial.

Keep exact output either way.

## 7.7 Compact output

GPU frame representation should contain only what compositing/interactions need.

Candidate:

```text
glyphId:      u16
flags:        u16
foreground:   rgba8 / u32
background:   rgba8 / u32
```

Prefer aligned structures appropriate for storage buffers.

Avoid float colors unless a mode explicitly needs HDR.

## 7.8 No per-frame garbage

After initialization:

- no JS arrays in render loop
- no `Map` allocations
- no object-per-cell structures
- no `ImageData`
- no `getImageData`
- no `readPixels`
- no GPU→CPU synchronization
- reuse buffers/textures
- resize only when dimensions actually change

---

# 8. Final rendering

## Default: fullscreen renderer

Do **not** draw one quad per glyph.

Render one fullscreen triangle/quad.

Fragment logic:

```text
pixel position
→ ASCII cell
→ glyph ID
→ local glyph UV
→ atlas sample
→ foreground/background blend
```

One composite draw.

This is the default for:

- image rendering
- video
- scene postprocessing
- hover reveal
- local distortion
- waves
- chromatic effects
- transitions
- masks
- color animation

## 3D/geometry mode

Separate renderer:

```ts
renderMode: 'screen' | 'instances'
```

`instances` exists for effects that genuinely require independent geometry:

- glyph particles
- rotation
- falling characters
- depth displacement
- per-character scale
- explosions
- physics
- world-space text fields

Produce instance data from the same glyph field.

---

# 9. Interaction architecture

Matching and interaction are separate stages.

```text
source
→ matcher
→ glyph field
→ interaction/composite
```

Pointer movement should **not** rerun structural matching unless source sampling itself changes.

Built-in interaction primitives:

```ts
'reveal'
'resolution'
'displace'
'wave'
'push'
'color'
'glyph-scale'
'glyph-rotate'
'original-mix'
```

Example:

```ts
interaction: {
  type: 'reveal',
  radius: 0.15,
  feather: 0.06,
}
```

Advanced users may supply:

```ts
interaction: customNode
```

or backend-specific shader hooks.

Common uniforms:

```text
pointer.xy
pointer.velocity
time
radius
intensity
viewport
resolution
```

Keep these independent from matcher internals.

---

# 10. Source abstractions

Support:

```ts
type AsciiSource =
  | HTMLImageElement
  | ImageBitmap
  | HTMLVideoElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | VideoFrame
  | ImageData
  | GPUTextureSource
```

Adapters extend this.

Three:

```text
THREE.Texture
THREE.RenderTarget
Scene + Camera
postprocessing pass input
```

React accepts normal URLs and elements.

Never force users to manually copy source pixels into `ImageData` for GPU rendering.

Canvas sources reach the WebGPU backend via `copyExternalImageToTexture` — a GPU-side transfer. Only the CPU backend inherently needs `getImageData` for canvas sources; document that cost, it is not a bug.

---

# 11. Backend selection

Public:

```ts
backend: 'auto' | 'webgpu' | 'cpu'
```

Potential internal WebGL compositing is implementation detail.

## `auto`

Priority:

```text
WebGPU exact structural
↓
Worker/CPU exact structural + accelerated composite if available
↓
main-thread CPU exact structural
```

Do **not** silently downgrade to `shape6` or `ramp`.

If user explicitly prioritizes speed:

```ts
matcher: 'shape6'
```

or:

```ts
performanceMode: 'prefer-speed'
```

Approximation must be opt-in and visible.

---

# 12. WebGL2 fallback

WebGL2 does not get to redefine correctness.

Fallback options:

### Preferred

```text
CPU/Worker structural matcher
→ compact glyph field
→ WebGL2 fullscreen composite
```

### Very low-end

```text
CPU matcher
→ Canvas2D composite
```

Do not spend v1 engineering effort recreating complex pseudo-compute through many WebGL fragment passes unless benchmarks show it materially improves important devices.

---

# 13. CPU reference implementation

Purpose:

1. correctness oracle
2. SSR/build tools
3. fallback
4. testing
5. static rendering

Implementation rules:

- typed arrays
- reusable scratch buffers
- no per-cell object creation
- no nested arrays internally
- precomputed glyph data
- bounded reusable candidate buffers
- exact same defaults as GPU

Potential optimizations after correctness:

- worker execution
- SIMD-friendly loops
- WASM

Ship workers as `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` so Vite/webpack/rspack bundle them correctly.

Do **not** introduce WASM merely because it sounds faster. Add only after benchmark evidence.

---

# 14. Build-time profile compilation

This is a first-class feature, not an afterthought.

## Config

```ts
import { defineAsciiConfig } from '@ascii-fx/compiler'

export default defineAsciiConfig({
  profiles: {
    default: {
      font: './public/fonts/GeistMono-Regular.woff2',
      charset: 'ascii',
    },

    blocks: {
      font: './public/fonts/GeistMono-Regular.woff2',
      charset: 'ascii-blocks',
    },
  },
})
```

Charsets are chosen at profile build time (`charset` builtin or `characters` string). At runtime, `subsetProfile(profile, characters)` in `@ascii-fx/core` narrows any built profile — compiled or runtime — to a character subset without recompiling: per-glyph data carries over byte-for-byte, so matching a subset equals matching a profile compiled with that charset (see ALGORITHM.md §12).

## Compiler steps

```text
font bytes
↓
load exact font
↓
measure glyphs
↓
rasterize glyphs at fixed reference resolution
↓
build display atlas
↓
derive 8×8 structural masks
↓
derive mean coverage
↓
derive metrics
↓
optional CPU on-index lists
↓
optional shape6 6D vectors
↓
optional shape6 LUT(s)
↓
serialize profile
```

## Rasterization determinism

Byte-for-byte determinism forbids system rasterizers — node-canvas (Cairo/FreeType) varies across platforms and versions. Parse with fontkit (native WOFF2 support) and rasterize with an in-house fixed-point scanline rasterizer.

`ALGORITHM.md` pins: mask binarization (supersample → 8×8 coverage → threshold at 0.5, ties pinned), atlas anti-aliasing (supersampled box downsample), and the cell box (advance × ascent+descent) with its clipping policy for overflowing glyphs.

Block glyphs (▀ ▄ █) must stay flush to cell edges despite atlas padding.

## Font consistency

The same font bytes must produce:

```text
matching representation
AND
rendering atlas
```

Do not analyze one font rasterization and later render arbitrary browser text with another rasterizer.

The GPU should draw the generated atlas.

This eliminates browser/OS font differences between matching and display.

## Runtime fallback

Usability still wins.

If a user passes:

```ts
fontFamily: 'monospace'
```

without a compiled profile, generate a runtime profile automatically using Canvas.

Warn only in development:

```text
Runtime font profile generated.
For faster startup and deterministic rendering, precompile it.
```

Never make profile compilation mandatory.

---

# 15. Profile binary format

Use one versioned binary asset.

Extension:

```text
.asciip
```

Header:

```text
magic: ASCI
formatVersion
compilerVersion
flags
glyphCount
atlasWidth
atlasHeight
referenceGlyphHeight
charsetHash
fontHash
section offsets
```

Sections:

```text
UTF-8 glyph table
glyph offsets
metrics
structural masks
coverage
optional on-pixel CSR
atlas R8 bytes
optional shape6 vectors
optional shape6 LUT
metadata
```

Requirements:

- deterministic byte-for-byte output
- schema versioning
- endian explicitly defined
- fingerprints embedded
- unknown optional sections safely skippable
- decoder in `core`
- no JSON for large numeric arrays

Use `Uint16` glyph IDs universally unless benchmark evidence justifies a special `Uint8` profile.

---

# 16. Static-image build-time compilation

If these are known:

```text
source image
profile
columns/rows
matcher settings
```

the ASCII matching itself can happen at build time.

Generate:

```text
.asciif
```

containing an `AsciiFrame` that references its profile by id + fingerprint — never embedded; the loader validates the fingerprint.

Serialize SoA — glyph IDs, foreground, background, flags as separate sections (channel-planar where it helps compression), all-zero sections omitted. `.asciif` is also the golden-fixture format, so Phase 1 exercises the encoder/decoder from the start.

Frames are declared in the ascii-fx config and imported as named virtual modules — query-string imports cannot be typed (TS module wildcards allow a single `*`):

```ts
import hero from 'virtual:ascii-frame/hero'
```

Runtime:

```text
load frame
+ upload glyph IDs/colors
+ load atlas
+ composite
```

No matching required for first render.

Interactive post-FX still work normally.

Size reality (measured 2026-08-10, Geist Mono ascii profile): a 160×42 full-color frame is 66KB raw → 31KB gzip → **22KB brotli**; mono is a few KB; the .asciip profile itself is 802KB raw → **13KB brotli** (the R8 atlas compresses extremely well). Net byte win when the ASCII replaces the source image; added weight when the original ships anyway (reveal/original-mix). Per-asset choice — keep the measured table in docs current.

This is ideal for:

- hero artwork
- static backgrounds
- landing pages
- SSR-heavy sites

Do not perform magic AST scanning of arbitrary `<AsciiImage>` usages in v1. Static compilation must be explicit.

---

# 17. Vite integration

```ts
import { ascii } from '@ascii-fx/vite'

export default defineConfig({
  plugins: [
    ascii({
      config: './ascii-fx.config.ts',
    }),
  ],
})
```

Expose:

```ts
import profile from 'virtual:ascii-profile/default'
```

Features:

- compile on dev start
- fingerprint cache
- rebuild changed fonts
- HMR updated profiles
- emit hashed `.asciip`
- static `.asciif` handling
- no compiler code in client bundle

The same `compiler` API must work without Vite.

---

# 18. React + SSR

All React package imports must be SSR-safe.

No browser globals until effect/mount time.

Published files must preserve `'use client'` banners so RSC/Next App Router consumers work untouched.

## Default SSR output

For:

```tsx
<AsciiImage src="/hero.jpg" alt="..." />
```

server-render:

```text
layout-stable wrapper
+ accessible original/fallback image
```

Client:

```text
hydrate
→ initialize renderer
→ overlay/replace fallback
```

No blank flash.

No layout shift.

## Precompiled frame

If `.asciif` is available:

```text
SSR fallback
→ hydrate
→ upload frame
→ immediate ASCII composite
```

No matching startup cost.

## Optional text SSR

```tsx
<AsciiImage ssr="text" />
```

Only when a precomputed text frame exists.

Do not server-render thousands of colored `<span>` nodes by default.

## SSR performance reality

SSR does not make client WebGPU compute faster. Its wins are:

- startup presentation
- accessibility
- layout stability
- precomputed static frames
- removing browser-only build work

GPU device/pipeline creation still occurs client-side.

---

# 19. GPU startup/warmup

Cannot truly precompile device-specific WebGPU pipelines at npm/Vite build time.

At runtime:

1. create device/renderer early
2. create buffers/textures
3. upload profile
4. initialize atlas
5. asynchronously compile/warm pipelines
6. only then swap fallback → interactive renderer

Avoid first-hover shader compilation.

Compile all built-in interaction variants during idle/startup where reasonable.

---

# 20. Frame reuse and invalidation

Separate state into:

## Structural state

Changes require rematching:

```text
source frame
grid dimensions
profile
matcher
fixed palette colors (mono/foreground reconstruction constants)
structural preprocessing
color-fitting mode
```

There is no `invert` matcher option: polarity derives from the fixed colors (ALGORITHM.md §8), so swapping them flips it coherently. Inverted display of an already-matched frame is a composite-stage effect.

## Composite state

Does **not** require rematching:

```text
pointer
time
reveal radius
distortion
wave
glyph scale
glyph rotation in screen mode
post color
opacity
mask
transition
```

Implement explicit dirty flags:

```ts
SOURCE_DIRTY
MATCH_DIRTY
COMPOSITE_DIRTY
GEOMETRY_DIRTY
```

Never recompute based on broad "something changed" invalidation.

---

# 21. Temporal optimization

For video/dynamic scenes, retain previous cell state.

Potential exact-safe optimization:

```text
if source cell bytes/features exactly unchanged
→ reuse previous result
```

Potential approximate optimization:

```text
descriptor difference < threshold
→ retain prior glyph
```

The latter changes semantics and must remain opt-in.

Temporal hysteresis may be offered as a visual feature:

```ts
temporalStability: 0..1
```

Purpose:

- reduce glyph flicker
- stabilize near-ties

Not default in exact mode unless proven not to alter exact winner semantics.

---

# 22. Dirty-region optimization

Support source dirty rectangles where available.

Useful for:

- drawing applications
- local canvas updates
- UI-driven procedural sources

```ts
renderer.invalidate({
  x,
  y,
  width,
  height,
})
```

Translate source dirty region → affected ASCII cells.

Do not attempt dirty tracking for video/full Three scenes unless supplied by caller.

---

# 23. Large glyph sets

ASCII-sized sets:

```text
exact scan
```

Do not overengineer.

For hundreds/thousands of Unicode glyphs, provide future/experimental:

```ts
search: 'exact' | 'clustered'
```

Potential compiler-generated structure:

```text
glyph masks
→ Hamming clustering / medoids
→ cluster shortlist
→ exact scan inside selected clusters
```

Requirements before shipping approximate clustering:

- benchmark speedup
- candidate recall measurement
- reconstruction-error delta measurement
- explicit opt-in
- never become default merely because charset is large

No HNSW dependency for ordinary ASCII.

---

# 24. Glyph atlas

Compiler-generated atlas.

Requirements:

- R8/alpha where possible
- fixed padding around each glyph
- no neighboring-glyph bleeding under bilinear filtering
- metrics stored separately
- atlas UVs derivable cheaply from glyph ID
- deterministic packing
- mip chain for minification (runtime-generated is fine) — bilinear alone shimmers when cells render small
- power-of-two glyph pitch so padding survives every mip level

For normal ASCII sets, prefer simple regular-grid atlas over sophisticated packing: trivial UV math is more valuable than saving tiny amounts of texture memory.

Do not dynamically invoke `fillText()` in realtime GPU mode.

---

# 25. Resolution semantics

User-facing API should primarily expose:

```ts
columns
```

Rows derive from:

```text
source aspect ratio
× glyph cell aspect ratio
```

Also support:

```ts
rows
cellSize
resolution: {
  ;(columns, rows)
}
```

One dimension may be `auto`, but avoid ambiguous combinations.

Never assume glyph cells are square.

Profile stores actual cell aspect/advance.

Grid derivation — rows from columns, rounding, and the cover/contain crop rect — is pinned in `ALGORITHM.md`; it is an input to `.asciif` reproducibility.

---

# 26. Resize behavior

Default:

```ts
fit: 'cover' | 'contain' | 'stretch'
```

Use ResizeObserver in DOM adapters.

Debounce structural buffer reallocations to animation frame.

Only reallocate when:

```text
ASCII grid dimensions change
```

CSS pixel resize that does not change grid dimensions requires composite resize only.

Canvas backing stores are sized in device pixels. A devicePixelRatio change is a composite-only resize and never triggers rematching.

---

# 27. Transparency

Support alpha-aware sources.

Options:

```ts
alpha:
  | 'ignore'
  | 'mask'
  | 'premultiplied'
```

Default for images with transparency:

```text
transparent source areas → transparent output
```

Do not let transparent RGB garbage affect structural selection.

---

# 28. Color space

Define one canonical matching color space for v1.

Start with explicit sRGB byte semantics matching the reference structural implementation.

Do not accidentally mix:

```text
linear renderer textures
with
sRGB CPU reference bytes
```

Three adapter must explicitly normalize source texture color handling before matching.

Later experiments with perceptual color error are separate matcher versions, not silent changes.

---

# 29. Exactness/versioning

Matcher semantics are versioned.

Example:

```ts
algorithm: 'structural-v1'
```

Changing:

- threshold
- mask generation
- color fit
- error metric
- candidate semantics

requires either:

- proven byte/glyph equivalence, or
- new algorithm version

This keeps build-generated frames and runtime frames reproducible.

---

# 30. Three.js adapter

Expose three main primitives.

## `AsciiPass`

Post-process entire scene/render target.

```ts
new AsciiPass({
  profile,
  columns: 160,
})
```

v1 targets `WebGPURenderer` (TSL postprocessing) only. Exactly matching a `WebGLRenderer` target requires per-frame GPU→CPU readback — WebGPU cannot import WebGL textures — which violates the zero-readback rule. WebGL support, if ever added, is a separate documented-cost mode, never a silent fallback.

## `AsciiMaterial` / node helper

Optional future API for applying glyph treatment selectively to a material/mesh.

Do not force this into v1 if postprocessing covers the primary use case.

## `AsciiGlyphs`

Geometry/instancing mode.

```ts
new AsciiGlyphs({
  profile,
  source,
})
```

Expose instance transforms through GPU storage so effects can animate them without CPU loops.

---

# 31. React adapter behavior

`<AsciiImage>` should:

- own canvas lifecycle
- load source
- resolve profile
- choose backend
- preserve `alt`
- react to resize
- clean up resources
- avoid reinitializing renderer for ordinary prop updates
- expose ref

```ts
interface AsciiHandle {
  renderer: AsciiRenderer | null
  render(): void
  capture(): Promise<AsciiFrame>
  getSupport(): AsciiSupport
}
```

Prop changes should map to dirty-state categories.

Do not recreate renderer because pointer settings changed.

---

# 32. Accessibility

Canvas is visual output, not semantic replacement.

Image component:

- requires/supports `alt`
- accessible fallback image remains represented correctly
- decorative mode supports `alt=""`

Honor:

```text
prefers-reduced-motion
```

by disabling motion-heavy interaction presets while preserving static ASCII.

Do not use enormous hidden ASCII DOM for screen readers.

---

# 33. Exports

Core:

```ts
frame.toText()
frame.toAnsi()
frame.toHTML()
```

Renderer:

```ts
await renderer.captureFrame()
await renderer.toBlob()
```

GPU readback occurs **only when explicitly requested**.

Never read frame data back every animation frame just to support possible future export.

---

# 34. Debug mode

Development-only diagnostics:

```ts
debug: {
  timing: true
  cells: true
  masks: true
  candidates: true
  buffers: true
}
```

Expose timing split:

```text
source/sample
mask/features
candidate search
rerank
composite
total
```

Useful visual overlays:

- 8×8 source cell
- binary mask
- top-8 candidates + Hamming scores
- fitted FG/BG
- reconstruction error
- selected glyph

This will be critical for optimizing without breaking quality.

---

# 35. Benchmark suite

Create the benchmark harness in Phase 1 with CPU-only metrics; the full GPU suite lands with Phase 2.

## Inputs

Corpus must include:

- portrait
- landscape
- high-contrast geometry
- low-contrast photograph
- gradients
- line art
- typography
- noisy texture
- transparent PNG
- animated video
- Three.js scene

## Grid sizes

At minimum:

```text
80×45
120×68
160×90
240×135
320×180
```

## Glyph sets

```text
95 ASCII
ASCII + blocks
256 glyph synthetic
1K glyph stress test
```

## Modes

```text
mono
foreground
full
```

## Metrics

Record:

```text
initialization time
profile decode
GPU upload
pipeline warmup
CPU matcher ms
GPU feature ms
GPU candidate ms
GPU rerank ms
composite ms
total frame ms
p50
p95
memory
allocations/frame
```

## Interaction benchmark

Pointer-only frame update must prove matcher did not dispatch.

---

# 36. Quality benchmark

CPU structural reference = oracle.

For exact GPU mode require:

```text
glyph winner agreement: 100%
```

The all-integer formulation (§4.0) makes this bit-exact. There is no floating-point caveat to hide behind.

For colors:

```text
exact integer RGB agreement
(u8-rounded fitted means are part of the algorithm)
```

Every optimization PR must run golden corpus comparison.

## Approximate algorithms

Before an approximate matcher can be labeled production-ready, report:

```text
glyph recall vs exact
mean reconstruction error delta
p95 error delta
worst-case images
speedup
```

No "looks the same to me" optimization acceptance.

---

# 37. Performance goals

Goals, not unverified claims.

## Exact WebGPU structural mode

Primary target:

```text
160×90 cells
95 glyphs
full color
60 FPS
```

on representative modern laptop hardware.

Stretch:

```text
320×180 @ 60 FPS desktop
```

Mobile target:

```text
120×68 @ stable 60 FPS
```

where WebGPU/device capability permits.

## Interaction-only update

At 1080p composite:

```text
target ≤ 2ms desktop GPU
```

with no matcher dispatch.

## Warm runtime

Target:

```text
0 JS allocations/frame
0 GPU readbacks/frame
0 font rasterization
0 canvas text drawing
```

Performance regression budget should be CI-visible.

---

# 38. Optimization decision order

Optimize in this order:

```text
1. remove runtime font work
2. remove CPU↔GPU transfers
3. remove per-frame allocations
4. workgroup-local source sampling
5. exact parallel Hamming search
6. exact parallel rerank
7. reduce/fuse memory passes
8. exploit temporal/dirty reuse where exact
9. subgroup specialization
10. approximate search/LUTs only when justified
```

Do not begin with exotic ANN.

---

# 39. Experiments to benchmark explicitly

Agent should implement benchmark branches for:

### Sampling

```text
8×8 exact texel loads
vs
filtered/mipmap sampling approximations
```

Exact remains default unless approximation quality is measured.

### Pipeline

```text
feature + match fused
vs
two compute stages
```

### Workgroup

```text
8×8
16×4
64×1
```

### Candidate search

```text
parallel exact Hamming
vs
serial lane
vs
cached/hash approaches
```

### Rerank

```text
candidate-parallel
vs
pixel-parallel
vs
serial candidate
```

### Source preprocessing

```text
none
vs
directional (Harri-style) enhancement
```

### Shape6 fast matcher

```text
bruteforce
vs
3-bit dense LUT
vs
LUT top-K + exact 6D rerank
```

Keep benchmark results in repository.

---

# 40. What can happen at build time

## Always eligible

```text
font parsing
font metrics
glyph rasterization
glyph display atlas
8×8 structural masks
glyph coverage
popcounts
CPU on-pixel lists
shape6 6D descriptors
shape6 dense LUTs
charset normalization
profile serialization
```

## Eligible for static sources

```text
source resampling
cell extraction
structural matching
glyph IDs
fitted colors
complete AsciiFrame
text export
```

## Cannot meaningfully be finalized at build time

```text
WebGPU device creation
driver-specific shader pipeline compilation
video frame matching
dynamic canvas matching
Three scene matching
runtime viewport-dependent source data
pointer interactions
```

---

# 41. Dynamic font profiles

Runtime compilation remains supported:

```ts
const profile = await createAsciiProfile({
  fontFamily: 'IBM Plex Mono',
  charset: 'ascii',
})
```

Cache in memory by:

```text
resolved font signature + charset + settings
```

Potential future IndexedDB cache, but not required for v1.

Do not use localStorage.

---

# 42. Presets

Keep API simple through presets:

```ts
preset: 'structural' | 'terminal' | 'colored' | 'shape6'
```

But presets merely expand to explicit options.

Recommended default:

```ts
{
  matcher: 'structural',
  color: 'mono',
  backend: 'auto',
  edgeEnhancement: false,
}
```

Do not create dozens of visual-style presets in core.

Those belong in demos/docs.

---

# 43. Character sets

Built-ins:

```ts
'ascii'
'ascii-blocks'
```

`'ascii'` is exactly U+0020–U+007E — 95 glyphs including space. Built-in charset definitions are frozen: the charset hash feeds profile fingerprints.

Custom:

```ts
characters: string | string[]
```

Normalize Unicode by code point, not UTF-16 code unit.

Compiler stores UTF-8 glyph table + offsets.

Reject duplicates after normalization.

Do not silently remove space.

---

# 44. Very large Unicode profiles

Profile format should support up to `Uint16` glyph IDs.

Runtime exact structural matching may warn above configurable threshold:

```text
>512 glyphs: exact scan may become expensive
```

Still remain correct.

Experimental clustered mode can be offered separately.

---

# 45. Source-frame scheduling

Video rendering must avoid pointless work.

Use source-driven scheduling where available:

```text
requestVideoFrameCallback
```

rather than matching identical video frames at 120Hz because display refresh is 120Hz.

For arbitrary canvases/scenes, caller may choose:

```ts
renderMode: 'manual' | 'continuous'
```

Default by source type.

---

# 46. Resolution adaptation

Optional:

```ts
adaptiveResolution: true
```

May alter columns dynamically to maintain target frame budget.

But:

- explicit user resolution wins
- matcher remains exact
- report actual grid size
- use hysteresis so resolution does not oscillate

Do not enable silently in deterministic/static rendering.

---

# 47. Hover resolution effects

Changing visual glyph size near pointer does not necessarily require rematching.

Preferred implementation:

```text
existing glyph field
→ local composite distortion/scale/reveal
```

Only actual local increase in structural sample resolution requires a secondary higher-resolution glyph field.

Advanced mode:

```ts
interaction: {
  type: 'resolution',
  localRematch: true,
}
```

Then compute only affected cells/tiles.

---

# 48. Custom shaders/effects

Power users need extension points without forking library.

Expose semantic stages:

```text
preMatch
postMatch
glyphTransform
colorTransform
composite
```

Backend-specific hooks are allowed in adapter packages.

Do not expose internal buffer layouts as immutable public API unless intentionally versioned.

Prefer wrappers/accessors.

---

# 49. Error handling

Errors should identify remediation.

Bad:

```text
Failed to initialize renderer.
```

Good:

```text
WebGPU is unavailable. Falling back to the exact CPU matcher.
```

or:

```text
Profile was generated with schema v3; runtime supports v4-v5.
Rebuild the profile with @ascii-fx/compiler.
```

Fallbacks should be visible in debug/support API, not noisy in production console.

---

# 50. Capability API

```ts
const support = await getAsciiSupport()
```

Returns:

```ts
{
  webgpu: boolean
  webgl2: boolean
  worker: boolean
  offscreenCanvas: boolean

  recommendedBackend:
    | 'webgpu'
    | 'cpu-worker'
    | 'cpu'

  limitations: string[]
}
```

A present `navigator.gpu` proves nothing — report `webgpu` and `recommendedBackend` from an actual `requestAdapter()`/device probe, and cache the result.

React:

```ts
const support = useAsciiSupport()
```

Most users never need this.

---

# 51. Lifecycle

Renderer must support:

```ts
await renderer.init()
renderer.setSource()
renderer.setOptions()
renderer.render()
renderer.start()
renderer.stop()
renderer.resize()
renderer.captureFrame()
renderer.destroy()
```

`destroy()` releases:

- buffers
- textures
- pipelines/resources where applicable
- event listeners
- observers
- worker
- source callbacks

React unmount must call it.

---

# 52. Testing layers

## Unit

- masks
- popcount
- flat cells
- candidate ranking
- inversion
- fitted colors
- error calculation
- serialization
- profile hashing

## Golden

Known small images with exact expected:

```text
glyph IDs
foreground
background
```

## CPU ↔ GPU conformance

Randomized generated cells and fixture images.

## Browser

Playwright:

```text
Chromium
Firefox
WebKit
```

GPU tests gated by capability.

## SSR

Import every browser package from Node SSR environment.

No package import may throw because `window` is absent.

---

# 53. Documentation

Docs structure:

```text
Quick Start
React
Three.js
Vanilla
Vite/build-time optimization
Profiles/fonts
Video
Interactions
3D glyphs
SSR
Performance
Matcher internals
Custom effects
API reference
```

README first example must remain tiny.

Do not lead with architecture.

---

# 54. Demo/playground

Playground should compare:

```text
Original
Brightness ramp
shape6
Structural exact
Structural + directional edge enhancement
```

Live controls:

```text
font
charset
columns
matcher
color mode
edge enhancement
backend
interaction
```

Debug tab:

```text
frame timings
candidate view
binary mask
reconstruction error
GPU memory
```

This becomes both marketing and engineering tooling.

---

# 55. Attribution / implementation hygiene

The algorithm should be independently implemented from its documented behavior and tested against our own CPU reference.

Do not copy third-party source blindly.

Credit conceptual influences in docs:

- Alex Harri — shape-vector and directional contrast work
- Ditherlab / chafa-style structural reconstruction inspiration

---

# 56. Explicit non-goals for v1

Do not derail v1 with:

- terminal emulator
- arbitrary rich-text layout
- OCR
- SVG glyph rendering
- native mobile bindings
- WASM without benchmarks
- HNSW
- generalized vector database abstractions
- neural/ML glyph matching
- huge preset libraries
- custom shader DSL
- automatic build-tool AST scanning
- server-side WebGPU
- physical character simulation in the core renderer

Three.js glyph physics can be an adapter-level feature after the base instanced renderer exists.

---

# 57. Implementation phases

## Phase 1 — correctness

Ship:

```text
core
compiler
ALGORITHM.md — normative structural-v1 constants, pseudocode, golden vectors
CPU structural-v1
profile format
.asciif frame format + CLI (doubles as the golden-fixture format)
benchmark harness (CPU metrics)
golden tests
basic canvas output
```

Success:

```text
Ditherlab-style structural behavior independently reproduced
deterministic profiles
text/full-color output
```

## Phase 2 — WebGPU

Ship:

```text
gpu
exact structural compute
fullscreen atlas renderer
video
benchmark suite
```

Success:

```text
CPU/GPU golden agreement
zero render-loop readback
zero warm allocations
```

## Phase 3 — Three

Ship:

```text
AsciiPass (WebGPURenderer/TSL)
Three render targets
scene/camera support
pointer uniforms
```

## Phase 4 — React/Vite

Ship:

```text
AsciiImage
AsciiVideo
SSR-safe lifecycle
Vite profile compilation
virtual profile imports
static frame virtual modules (virtual:ascii-frame/<name>)
```

## Phase 5 — interactivity

Ship:

```text
reveal
wave
push
resolution effects
custom composite hook
instanced glyph output
R3F adapter
```

## Phase 6 — advanced optimization

Benchmark and selectively ship:

```text
workgroup tuning
subgroups
dirty tiles
temporal reuse
shape6 LUT
large-glyph clustering
adaptive resolution
```

Never implement Phase 6 optimizations before profiling Phase 2.

---

# 58. Acceptance criteria for v1

v1 is complete only when all are true:

### Quality

- `structural-v1` CPU reference implemented
- WebGPU output conforms to reference
- 8×8 structural matching
- top-8 Hamming prefilter
- exact RGB rerank
- flat-cell path
- mono/foreground/full color
- custom charset
- compiled fonts

### Performance

- no runtime glyph rasterization when compiled profile supplied
- no normal-frame GPU→CPU readback
- no per-cell JS allocations on optimized paths
- one fullscreen composite draw
- performance benchmark published

### Usability

This works:

```tsx
<AsciiImage src="/cat.jpg" alt="Cat" />
```

This works:

```ts
new AsciiPass({ profile })
```

This works:

```ts
const renderer = await createAsciiRenderer({
  canvas,
  profile,
})
```

No user must understand compiler internals.

### Ecosystem

- SSR-safe
- Vite integration
- React
- Three
- R3F
- vanilla canvas

### Engineering

- typed
- tree-shakeable
- ESM-first
- API docs
- golden tests
- benchmark suite
- browser test matrix

---

# 59. Architectural north star

The library should conceptually be:

```text
                         BUILD TIME
                             │
              font ──────────┤
                             ▼
                     ┌──────────────┐
                     │ AsciiProfile │
                     └──────┬───────┘
                            │
                            │
SOURCE                      │
image/video/canvas/three    │
        │                   │
        ▼                   ▼
┌───────────────────────────────────┐
│          EXACT MATCHER            │
│                                   │
│  8×8 source samples               │
│  ↓                                │
│  structural mask                  │
│  ↓                                │
│  Hamming top-8                    │
│  ↓                                │
│  RGB reconstruction rerank        │
└─────────────────┬─────────────────┘
                  │
                  ▼
             ASCII FIELD
       glyph IDs + FG/BG colors
                  │
          ┌───────┴────────┐
          │                │
          ▼                ▼
   fullscreen          instances
   renderer             / Three
          │                │
          └───────┬────────┘
                  │
                  ▼
          INTERACTION / FX
                  │
                  ▼
               OUTPUT
```

And from the user's perspective:

```tsx
<AsciiImage src="/image.jpg" />
```

Those two realities must coexist.

---

# 60. One-sentence implementation mandate

**Build the Ditherlab-class 8×8 structural matcher as a deterministic CPU oracle, move its exact semantics end-to-end onto WebGPU, precompute every font-dependent operation at build time, render the resulting glyph field with a one-draw atlas compositor, keep interactions downstream of matching, provide Harri's edge treatment and 6D/LUT approach as explicit optional modes, and hide all of that behind APIs simple enough that the default React usage remains one component.**

---

# 61. Toolchain (resolved 2026-08-10)

- pnpm workspace, `packageManager` pinned, build scripts allow-listed via `allowBuilds` in `pnpm-workspace.yaml`
- TypeScript strict, ESM-only, NodeNext resolution, Node ≥ 22
- tsup per-package builds (`'use client'` banner preserved in React packages)
- Vitest for unit/golden/conformance; Playwright for Chromium/Firefox/WebKit, GPU tests capability-gated
- Changesets for versioning
- `@webgpu/types` in core/gpu
- Fixtures: Geist Mono (OFL) + CC0 image/video corpus
- Claim the `@ascii-fx` npm org before the name spreads further
- Phase 1 build order: ALGORITHM.md → core types + profile decoder → compiler (masks/coverage/atlas) → CPU matcher + golden tests → Canvas2D composite demo
