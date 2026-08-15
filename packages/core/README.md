# @ascii-fx/core

Framework-, DOM-, and renderer-agnostic heart of ASCII FX: the exact `structural-v1` CPU matcher (the correctness oracle for every backend), profile/frame binary codecs, character sets, and text/ANSI/HTML export. SSR-safe to import; browser APIs are touched only at call time.

```ts
import { renderAscii, loadProfile } from '@ascii-fx/core'

const profile = await loadProfile('/fonts/default.asciip')
const frame = await renderAscii(image, { profile, columns: 120 })

console.log(frame.toText())
document.body.innerHTML = frame.toHTML()
```

No compiled profile at hand? Generate one from a browser font at runtime (slower startup, browser-dependent rasterization):

```ts
import { createAsciiProfile } from '@ascii-fx/core'
const profile = await createAsciiProfile({ fontFamily: 'monospace' })
```

## API surface

- `renderAscii(source, options)` — easiest path; accepts elements, `ImageData`, or raw `{ width, height, data }` RGBA (the only forms usable in Node).
- `matchFrame(raw, options)` — synchronous exact matcher over raw pixels.
  - `options.matcher`: `'structural'` (exact, default) | `'shape6'` | `'ramp'` — the approximate matchers are explicit opt-ins, never fallbacks; quality numbers live in `apps/benchmarks/RESULTS.md`.
  - `options.color`: `'mono' | 'foreground' | 'full'`; polarity derives from the fixed palette (there is no `invert` flag — swap the colors).
- `AsciiFrame` — `toText() / toAnsi() / toHTML() / getCell(x, y)`, packed typed arrays inside.
- `encodeProfile / decodeProfile` (`.asciip`), `encodeFrame / decodeFrame / peekFrame` (`.asciif`), `loadProfile / loadFrame` fetch helpers.
- `compositeFrame(frame)` — reference CPU compositor (pure); `@ascii-fx/core/canvas2d` adds a canvas helper.
- `subsetProfile(profile, characters)` — restrict any built profile (compiled or runtime) to a character subset, e.g. `subsetProfile(profile, '01')` for binary rain. Raster data is carried over exactly, so matching equals a profile compiled with that charset; the shape6 LUT (if any) is dropped. Duplicate or unknown characters are errors. The subset is a distinct profile (own fingerprint) — frames don't decode across it and its parent.
- `resolveCharset`, `deriveGrid`, `reduceSource`, `getCell` utilities; `AsciiSupport` types.

Normative algorithm definition: [`ALGORITHM.md`](../../ALGORITHM.md) — every constant, bit layout, and tie-break. Conformance is bit-exact by construction (all-integer arithmetic).
