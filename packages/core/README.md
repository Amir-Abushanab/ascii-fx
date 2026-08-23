# @ascii-fx/core

The matcher every other `@ascii-fx` package is measured against.

This is the exact CPU implementation of `structural-v1` and `chromatic-v1` — the algorithms that pick a glyph by **shape** rather than brightness — plus the binary codecs, charsets, and text/ANSI/HTML exports. It has no DOM and no renderer, touches browser APIs only at call time, and is safe to import on a server.

```sh
pnpm add @ascii-fx/core
```

## Render something

```ts
import { loadProfile, renderAscii } from '@ascii-fx/core'

const profile = await loadProfile('/fonts/default.asciip')
const frame = await renderAscii(image, { profile, columns: 120 })

frame.toText() // plain text
frame.toAnsi() // 24-bit colour for a terminal
frame.toHTML() // spans, one per run of like-coloured cells
```

For a canvas rather than a string, `@ascii-fx/gpu` is the renderer you want — it runs this same algorithm as WebGPU compute and falls back to this package when there's no adapter.

## Why it's the oracle

Every backend has to agree with this code **bit-for-bit** — same glyph ids, same colours, same flags — and the browser conformance suite exists to prove it. That's only a meaningful contract because the algorithm is exact rather than heuristic: with foreground and background free, the best colours for a given mask are the means of its two sample sets, so the reconstruction error has a closed form and the winning glyph is the true minimum, not the best guess.

That's also why `matchFrame` never silently swaps in something cheaper. `shape6` and `ramp` exist and are much faster, but they're **explicit opt-ins** branded as effects, never fallbacks:

```ts
matchFrame(source, { profile, columns: 120 }) // exact
matchFrame(source, { profile, columns: 120, matcher: 'shape6' }) // 3.3× faster, approximate
```

`shape6` also needs a profile compiled for it — `buildProfile({ font, shape6: { lut: true } })`, or `ascii-fx profile build --shape6-lut`. Asking for it against a plain profile throws rather than quietly falling back to the exact matcher, because a silent fallback would turn a performance opt-in into a no-op you never notice.

## Colour glyphs

`chromatic-v1` is a separate algorithm for glyph sets whose colour is baked in — colour emoji. There's nothing to fit, so it compares a cell's 64 samples against the glyph's own, composited over the backdrop it will be drawn on, and emits `colorMode: 'glyph'` with no colour planes.

```ts
const frame = matchFrame(source, { profile, matcher: 'chromatic', background: [11, 11, 15] })
```

`'glyph'` is an output mode only — passing it to a mask-fitting matcher is an error rather than a silent fallback.

## Also here

- **Codecs** — `encodeProfile`/`decodeProfile` (`.asciip`) and `encodeFrame`/`decodeFrame` (`.asciif`). A frame records the fingerprint of the profile it was built against and refuses to decode against a different one, so a stale `.asciif` fails loudly instead of rendering garbage.
- **Charsets** — `BUILTIN_CHARSETS`, `resolveCharset`, and `subsetProfile` for narrowing a compiled profile to the glyphs you actually want. The string form is segmented by greedy longest match against the profile's own glyphs, so multi-code-point emoji (VS16, ZWJ sequences) select correctly.
- **Exports** — `AsciiFrame` renders to plain text, 24-bit ANSI, or HTML.
- **`@ascii-fx/core/canvas2d`** — a tiny 2D-canvas painter, separate so nothing DOM-shaped is in the main entry.

Side-effect free and ESM-only: importing one export pulls one export. `luma8` alone bundles to **289 bytes** against 37 KB for the whole module.

[`ALGORITHM.md`](../../ALGORITHM.md) is the normative spec — every constant, bit layout, and tie-break.

## License

[MIT](../../LICENSE)
