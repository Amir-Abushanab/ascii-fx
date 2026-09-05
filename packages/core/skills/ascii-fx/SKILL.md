---
name: ascii-fx
description: >
  Render images, video, canvases or a three.js scene as ASCII art — or as colour emoji — in the
  browser, with WebGPU compute matching and a bit-identical worker + WebGL2 fallback. Load this when a user
  wants an @ascii-fx package — @ascii-fx/react (<AsciiImage> <AsciiVideo> <AsciiCanvas>),
  @ascii-fx/gpu (createAsciiRenderer), @ascii-fx/core (matchFrame), @ascii-fx/three (AsciiPass),
  @ascii-fx/react-three (<AsciiEffect>) or @ascii-fx/vite (build-time profiles) — or asks for an
  ASCII-art hero/video filter, shape-aware (not brightness-ramp) ASCII, an emoji mosaic or emoji
  video, a terminal-style text export of an image, or how to compile a font into a glyph profile.
metadata:
  type: core
  library: '@ascii-fx/core'
  library_version: '0.5.0'
sources:
  - 'ascii-fx:README.md'
  - 'ascii-fx:ALGORITHM.md'
  - 'ascii-fx:CHROMATIC-FINDINGS.md'
  - 'ascii-fx:packages/core/src/types.ts'
  - 'ascii-fx:packages/gpu/src/renderer.ts'
  - 'ascii-fx:packages/react/src/components.tsx'
---

# @ascii-fx — structural ASCII (and emoji) rendering for the web

Reconstructs an image out of glyphs by **shape**, not brightness. Each cell's 8×8 sample block is
matched against every glyph's real rasterised mask, then reranked on exact reconstruction error with
fitted colours. The whole pipeline runs as WebGPU compute, and without a GPU it runs as a
bit-identical CPU matcher on worker threads painted by a WebGL2 fullscreen draw — same output, and
on a 2023 laptop the same frame time.

## When to use

- An ASCII-art hero, background, avatar, or live video/webcam filter.
- ASCII that reads as _drawing_ rather than a halftone dither — this is the shape-aware kind.
- An **emoji mosaic** or emoji video (see "Emoji mode" — a separate matcher, not a charset swap).
- Turning an image into text for a terminal, a `<pre>`, or a copy-paste (`toText`/`toAnsi`/`toHTML`).

## Install

```sh
pnpm add @ascii-fx/react @ascii-fx/gpu @ascii-fx/core   # React
pnpm add @ascii-fx/gpu @ascii-fx/core                   # any framework / vanilla
pnpm add @ascii-fx/three @ascii-fx/gpu @ascii-fx/core   # three.js post-pass
pnpm add -D @ascii-fx/vite                              # build-time profiles as virtual modules
pnpm add -D @ascii-fx/compiler                          # compile profiles yourself (Node)
```

ESM-only, Node ≥ 22 for the compiler. `@ascii-fx/core` has no dependencies on the other packages —
it is the matcher and the codecs.

## Choosing an entry

| Need                         | Use                                                                     |
| ---------------------------- | ----------------------------------------------------------------------- |
| React image / video / canvas | `import { AsciiImage, AsciiVideo, AsciiCanvas } from '@ascii-fx/react'` |
| Any framework, own canvas    | `import { createAsciiRenderer } from '@ascii-fx/gpu'`                   |
| No DOM — match to data       | `import { matchFrame } from '@ascii-fx/core'`                           |
| three.js post-processing     | `import { AsciiPass } from '@ascii-fx/three'` (WebGPURenderer only)     |
| React Three Fiber            | `import { AsciiEffect, AsciiGlyphs } from '@ascii-fx/react-three'`      |
| Profiles at build time       | `import { ascii } from '@ascii-fx/vite'`                                |
| Compile a profile in Node    | `import { buildProfile } from '@ascii-fx/compiler'`                     |

## Quick starts

**React** — the component handles SSR, lazy upgrade, and pausing offscreen.

```tsx
import { AsciiImage } from '@ascii-fx/react'

;<AsciiImage
  src="/portrait.jpg"
  alt="Portrait"
  profile={{ url: '/default.asciip' }}
  columns={160}
  color="full"
/>
```

`alt` is required and the original media stays in the accessibility tree. `<AsciiVideo>` and
`<AsciiCanvas>` take the same options.

**Vanilla**

```ts
import { loadProfile } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'

const profile = await loadProfile('/default.asciip')
const ascii = await createAsciiRenderer({ canvas, profile, columns: 160, color: 'full' })
ascii.setSource(videoOrImageOrCanvas)
ascii.start() // rVFC for video, rAF otherwise
// ascii.setOptions({ columns: 200 }) · ascii.setInteraction({ type: 'push' }) · ascii.destroy()
```

**No canvas at all**

```ts
import { matchFrame } from '@ascii-fx/core'
const frame = matchFrame(rawImage, { profile, columns: 120, color: 'mono' })
frame.toText() // also toAnsi() and toHTML()
```

## Profiles — the glyph set

A **profile** is a compiled font: every glyph's 8×8 mask, its coverage, and an atlas tile. Matching
needs one. Three ways to get one, in order of preference:

```ts
// 1. Compiled ahead of time — deterministic, ~13 KB, identical on every machine.
const profile = await loadProfile('/default.asciip')

// 2. Vite virtual module (compiles at build time, hot-reloads in dev).
import profile from 'virtual:ascii-fx/profile/default'

// 3. Rasterised in the browser from an installed font — convenient, NOT deterministic.
import { createAsciiProfile } from '@ascii-fx/core'
const profile = await createAsciiProfile({ fontFamily: 'monospace', charset: 'ascii-blocks' })
```

Built-in charsets: `ascii` (95 printable) and `ascii-blocks` (adds ▀▄█▌▐░▒▓ and quadrants). Pass
`characters` for a custom set. **Narrow an existing profile with `subsetProfile(profile, chars)`** —
compiled profiles can only narrow; runtime profiles can rasterise anything the browser font draws.

The font must be monospace. Braille (`⠏⣠⣿`) is a classic trick: each glyph is a 2×4 dot grid, which
hands the matcher 256 distinct shapes.

## Options that matter

| Option               | Effect                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `columns`            | Characters per row; rows follow from the source aspect and the cell aspect.                                                                                                |
| `color`              | `mono` (one ink colour) · `foreground` (fitted colour per glyph) · `full` (fitted glyph **and** background per cell — closest to the original).                            |
| `alpha`              | `mask` (transparent cells stay transparent) or `ignore`.                                                                                                                   |
| `clearColor`         | Letterbox/ground colour (rgba 0..1). Alpha < 1 turns the render into an overlay: the page shows through the letterbox and — in `mono` and chromatic — through glyph gaps.  |
| `flatThreshold`      | Cells with less contrast than this render as one tone instead of a shape.                                                                                                  |
| `backend`            | `auto` (default) takes WebGPU and falls back to the exact CPU matcher. Chosen once, at construction — see the device-loss gotcha for what happens when the GPU dies later. |
| `workers`            | CPU-backend matcher threads; default one per core less one, `false` pins it to the main thread. Costs one frame of latency on live sources, never a different cell.        |
| `compositor`         | How the CPU backend paints: `auto` (WebGL2 where available) or `canvas2d`. Escape hatch only.                                                                              |
| `temporal`           | Skip re-matching cells whose pixels did not change. Exact, great for video, WebGPU only.                                                                                   |
| `adaptiveResolution` | Lower `columns` under frame pressure and recover. **WebGPU only** — so two backends can land on different grids.                                                           |
| `interaction`        | Pointer/time effects composited on top (`reveal`, `displace`, `wave`, `push`…). Never re-runs matching.                                                                    |
| `tilt`               | React only: drive the pointer from the device's orientation sensor, so `interaction` works on a phone. `true`, or `{ range, smoothing, invertX, invertY }`.                |

`matcher: 'shape6' | 'ramp'` are cheaper, visibly approximate matchers. They are explicit opt-ins,
never automatic fallbacks — `auto` backend selection never silently degrades quality.

### Tilt: the pointer a phone doesn't have

Every `interaction` type is driven by the pointer, so on a phone the effect you tuned on a desktop
does nothing at all. `tilt` fills that in from the orientation sensor: readings are normalized to
canvas coordinates the way a ball would roll on the screen, rotated by the screen angle so "right"
stays right in landscape, and centred on whatever pose the reader was already holding — a phone at
the usual 50° starts in the middle of the canvas, not pinned to a corner. The pointer eases toward
each new pose on a frame loop that parks itself once it arrives, so a phone lying still costs
nothing.

**iOS gets no tilt, on purpose.** Safari gates the sensor behind a modal permission dialog, and
nothing in this library opens one — the pointer stays where it was and the component looks exactly
as it does without `tilt`. Treat tilt as an enhancement some phones don't get, the way you would a
hover state; don't build a fallback for it and don't build a permission button for it. Elsewhere
tilt starts as soon as the renderer exists, and reduced motion suppresses it like autoplay unless
`respectReducedMotion={false}`.

If a page genuinely warrants asking — an interactive piece a reader came to play with, not a
background — `handle.enableTilt()` is the explicit opt-in: call it from a tap, directly, without
awaiting anything first or the gesture is spent. `handle.tiltStatus()` reports `'unsupported'` (no
sensor), `'prompt'` (gated, inert unless you ask), `'denied'`, `'listening'` or `'live'`;
`handle.recenterTilt()` re-takes the neutral pose after a change of grip.

Outside React, the same two pieces wire by hand — from the `/tilt` subpath, which is also what the
components fetch, so the sensor is a chunk rather than dead weight in a bundle that never tilts:

```ts
import { TiltSource, forwardTiltToPointer } from '@ascii-fx/gpu/tilt'
const tilt = new TiltSource({ range: 20 })
const stop = forwardTiltToPointer(tilt, renderer.pointer)
button.onclick = () => void tilt.enable() // iOS: must be the gesture itself
```

## Authoring the source

Everything above is about the renderer. This is about what you feed it, and it is where a correct
drawing most often arrives as an empty panel.

**The cell is the pixel.** One cell samples `sourceWidth / columns` pixels across (and the cell
aspect again down), and `mono`/`foreground` fit **one** colour to the whole block. So a feature
narrower than a cell does not render thinly — it renders as its own share of that average.

Worked, because the arithmetic is the whole point. A 960px-wide source at `columns: 164` gives a
cell about 6px across. A 3px orbit line crossing one fills 31% of it, so `#66779c` (luma 118)
composites at luma ~37: the panel's own colour, invisible, however opaque it was.

**Raising the colour cannot fix low coverage.** At 31% you would need a luma above 255 to land
mid-grey. Only coverage fixes coverage:

- **Bead a path instead of stroking it.** A row of dots, each filling the one cell it lands in,
  reads where a hairline of the same ink does not — and the gaps cost nothing, since an empty cell
  was always going to be empty.
- **Draw discs, not pixels.** A 1.5px star is a quarter of a cell and comes out as panel.
- **Or raise `columns`** so the cell shrinks around the feature you already have. Watch the other
  end of that trade: past roughly 4 CSS px per glyph the output stops reading as type and starts
  reading as a dot field, which is usually not why anyone reached for this.

Design the source for the grid you are matching into, not for the screen it will be shown on. It is
the opposite instinct to normal canvas work, and it is the difference between a picture and a panel
with nothing on it.

**Effects go on the source too, not in the renderer.** There is no `noise:` or `contrast:` option
and there will not be: matching is exact about the pixels it is given, and `interaction` runs
_downstream_ of it, so it can only move glyphs that were already chosen. An effect painted in
before matching changes **which glyph wins** — a jittered cell lands on a different character
rather than a tinted version of the same one. That is the difference between ASCII noise and a
tinted picture, and it is only available upstream.

The same cell rule governs the effect. Noise finer than a cell averages into the block and reads as
a faint haze; paint it one block per cell — `width / columns` across — and it reads as glyph churn.

With `<AsciiCanvas>` or the renderer directly you already own the source, so paint it and call
`render()`. `<AsciiImage>` has `draw` for it:

```tsx
<AsciiImage src="/portrait.jpg" alt="A portrait" columns={120} draw={drawGrain} animate fps={10} />
```

`draw(ctx, { image, width, height }, timeMs)` gets a buffer the image's natural size; `animate`
re-runs it on a loop capped at `fps` (default 12 — every frame is a full re-match, and churn above
~15fps reads as noise in the text rather than movement in the picture). Without `animate` an image
is matched once and left.

## Emoji mode (`chromatic-v1`)

Colour emoji need a **different algorithm**, not a bigger charset. `structural-v1` matches a 1-bit
mask and _fits_ colour to it — free foreground and background are exactly what make its rerank
exact. An emoji's colour is baked, so there is nothing to fit:

```ts
import { buildChromaticProfile } from '@ascii-fx/compiler' // Node, from decoded PNGs
const { binary } = buildChromaticProfile({ glyphs: [{ char: '🌊', image } /* … */] })

const frame = matchFrame(source, { profile, matcher: 'chromatic', background: [11, 11, 15] })
frame.colorMode // 'glyph' — no colour planes, the colour is in the glyph
```

Also works through `createAsciiRenderer({ matcher: 'chromatic' })` on both backends.

Things worth knowing, all of them measured:

- **Curate the palette to ~100 glyphs.** A usage-curated 100 matches a full 1301-glyph pool to
  within 1% at a thirteenth of the per-cell cost. Curate for **usage density**, not colour coverage
  — farthest-point/k-means selection is _worse than doing nothing_ at realistic budgets.
- **Flat swatches win constantly.** A solid tile is the best possible reconstruction of a flat cell,
  and emoji sets are full of them (skin-tone modifiers render as plain squares). Dropping them
  trades reconstruction error for recognisable emoji — a deliberate choice, not a bug.
- **No prefilter.** Over a curated palette an exhaustive search costs about what `structural-v1`'s
  shortlist-plus-rerank costs per cell, and every shortlist tested lost more quality than it saved.
- **`hysteresis` (0–1) defaults off.** It keeps the previous glyph unless a challenger beats it by
  that margin. Emoji actually flip _less_ than ASCII unaided, so reach for ~0.1 only if a specific
  source strobes. Never feed `previous` glyph ids from a different source — it is biased toward the
  incumbent and will ghost the old image in.
- `background` is part of the objective: glyphs are matched as composited over the backdrop they
  will be drawn on, so changing it changes the winners.

Emoji cells are **square**, unlike text cells, so the same `columns` yields more rows.

## three.js

```ts
import { AsciiPass } from '@ascii-fx/three'
const pass = new AsciiPass({ profile, renderer, columns: 160, color: 'full' })
await pass.init()
pass.render(scene, camera) // per frame, instead of renderer.render()
```

Matching runs on three's own device, so nothing is read back. **WebGL is unsupported on purpose** —
exact matching there would need a GPU→CPU copy every frame. `AsciiGlyphs` renders instanced glyphs
as scene geometry instead of as a post-pass.

## Gotchas

- **`foreground` is `mono` only.** In `color: 'foreground'` the glyph colour is fitted per cell from
  the source and the option is ignored — passing it looks like pinning an ink and does nothing. (In
  that mode the `background` option is the backdrop.) A one-colour source is what makes `foreground`
  output _look_ like a fixed ink; feed it a colour photo and the colour comes through.
- **`alpha: 'mask'` gates on opacity, not on colour.** A cell that is not opaque is dropped before it
  is ever matched, so anything structural has to be drawn opaque — faintness belongs in the colour,
  not the alpha. Gradients laid ON TOP of an already-opaque fill are fine: they composite before the
  mask looks.
- **When the output is sparse, look at the source before touching the renderer.** `toDataURL` the
  canvas you are feeding in and open it. It separates "drew it wrong" from "drew it too small for
  the grid", which look identical from the output side and have nothing to do with each other.
- **A canvas is bound to its first context type.** Switching backend needs a fresh `<canvas>`
  element, not just a new renderer. Note the CPU backend takes a **`webgl2`** context by default, so
  `getContext('2d')` on its canvas returns null — read it back with `drawImage` onto your own 2D
  canvas, or pass `compositor: 'canvas2d'`.
- **`backend` says `cpu` for several different pipelines.** The matcher (workers vs main thread) and
  the compositor (WebGL2 vs Canvas2D) degrade independently, and a machine on the slow path looks
  like a fast one. `renderer.pipeline` reports which it actually landed on; `getAsciiSupport()`
  reports what the machine can do before you build one.
- **WebGPU fails silently.** Buffers, textures, bind groups and dispatches validate without throwing,
  so a browser with different limits can accept setup and render nothing. `auto` detects this at
  construction and falls back to the CPU matcher; `onError` reports what went wrong later.
- **The GPU device can vanish** — memory pressure, a GPU process crash, a driver reset. Submits
  against a lost device are dropped without throwing, so this looks like a healthy renderer painting
  a frozen frame. `createAsciiRenderer` rebuilds on a new device by itself; pass `onDeviceLost` to
  handle the case where it cannot, by rebuilding on a fresh `<canvas>` (which is what lets `auto`
  land on the CPU matcher). The React components do this for you; if you drive `useAscii` yourself,
  put the `canvasKey` it returns on your `<canvas key={…}>`.
- **`adaptiveResolution` is WebGPU-only**, so a WebGPU and a CPU renderer can be on different grids
  and produce visibly different output. The matchers themselves are bit-identical — held to that by
  a conformance suite — so if two backends disagree, compare the grid first.
- **Frames reference profiles by fingerprint.** A frame can never decode against the wrong font.
- Emoji are double-width in terminals; `toText()`/`toAnsi()` on a chromatic frame will not align in
  a terminal grid. Canvas/GPU output is the reliable path there.
- The compiler is build-time only and must never reach browser runtime packages.

## Reference

`ALGORITHM.md` in the repo is **normative** — every constant, bit layout, and tie-break of
`structural-v1` (§1–§19) and `chromatic-v1` (§C). `CHROMATIC-FINDINGS.md` records the measurements
behind every emoji-mode choice above, including the ones that came out against the obvious guess.
