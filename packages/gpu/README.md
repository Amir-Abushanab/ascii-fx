# @ascii-fx/gpu

The realtime renderer: exact `structural-v1` matching as WebGPU compute (bit-for-bit agreement with the CPU reference, enforced by a browser conformance suite), a one-draw fullscreen atlas compositor, composite-stage interactions, and an exact CPU fallback behind the same API. `auto` never downgrades to an approximate matcher (spec §11).

```ts
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { loadProfile } from '@ascii-fx/core'

const ascii = await createAsciiRenderer({
  canvas,
  profile: await loadProfile('/default.asciip'),
  backend: 'auto', // webgpu → exact cpu fallback
  columns: 160,
  color: 'full',
})

ascii.setSource(video)
ascii.start() // requestVideoFrameCallback for videos, rAF otherwise

ascii.setInteraction({ type: 'reveal', radius: 0.18, feather: 0.08 })
canvas.addEventListener('pointermove', (e) => ascii.pointer.set(x01, y01))

const frame = await ascii.captureFrame() // the only GPU→CPU readback path
ascii.destroy()
```

## Guarantees (warm render loop)

- zero GPU→CPU readback; zero per-cell JS allocations; buffers/textures reused, reallocated only when the grid changes
- pointer/interaction/time updates are composite-only — the matcher never re-dispatches (verified by tests)
- matching and presentation submit separately, so presentation failures can't drop match work

## Beyond the basics

- `interaction` types: `reveal · displace · wave · push · color · glyph-scale · glyph-rotate · original-mix · resolution` — all of them on both backends. The CPU backend runs the shader's own formulas at the composite stage: masked layers (reveal/color/original-mix), row strips (wave), and a cell-granular warp engine for the rest — each affected cell is redrawn from its warped source position (or with its glyph-local scale/rotation), so the geometry matches WebGPU up to cell quantization. Time-based effects self-drive a composite-only loop on static sources; the matcher never re-runs for any of it.
- `temporal: true` — exact per-cell reuse for video (spec §21): unchanged cells skip matching via byte-identical sample comparison; costs one buffer copy + the previous-frame buffer
- `ascii.invalidate({ x, y, width, height })` — dirty-region rematch (spec §22): full source re-upload, sub-rect dispatch
- `adaptiveResolution: true` — steps columns down under sustained frame pressure with hysteresis; explicit resolution stays the upper bound; `grid()` reports the actual grid (spec §46)
- `AsciiEngine` / `AsciiStream` — the device-agnostic core used by `@ascii-fx/three` to run matching on Three's own `GPUDevice`

## Limits

- ≤ 2048 glyphs on the GPU path (workgroup memory); larger charsets use the CPU backend
- per-sample reduction blocks are bounded to keep u32 accumulation exact — pre-scale gigantic sources or raise columns (clear error otherwise)

## Deliberately deferred (benchmark-gated, spec §38–39)

Workgroup-shape tuning, subgroup ops, and fused-pass variants need profiling across real device classes; large-glyph clustering needs >2048-glyph use cases. The conformance suite is in place to keep any of them exact when they land.
