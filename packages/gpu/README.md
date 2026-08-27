# @ascii-fx/gpu

The realtime renderer: the exact structural matcher running as **WebGPU compute**, and an exact CPU implementation behind the identical API for everywhere else.

```sh
pnpm add @ascii-fx/gpu
```

```ts
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { loadProfile } from '@ascii-fx/core'

const ascii = await createAsciiRenderer({
  canvas,
  profile: await loadProfile('/fonts/default.asciip'),
  columns: 160,
  color: 'full',
})

ascii.setSource(video)
ascii.start()
```

~2.6 ms/frame on an M3 Pro at 160×42 — indistinguishable from drawing the source alone, because matching and compositing overlap on the GPU.

## The fallback is not a downgrade

`backend: 'auto'` picks WebGPU when there's an adapter and the CPU matcher when there isn't, and **both produce identical output** — same glyph ids, same colours, same flags, enforced by a browser conformance suite across colour modes, palettes, alpha modes, uneven reductions, temporal reuse, and dirty-region rematches.

What it will never do is quietly swap in a cheaper, worse matcher to hold a frame rate. Approximate matchers exist in `@ascii-fx/core`, and you get one only by naming it. A slow frame is a slow frame; it isn't silently a different picture.

## What runs without a GPU

Spec §12's fallback, both halves of it. **Matching** goes to a pool of workers — one per core less one, capped at 8 — each running core's `reduceBand`/`matchBand` over a slice of cell rows. That is the same code a whole-frame `matchFrame` runs, so the assembled cells are byte-identical and the pool is a scheduling change, not an algorithm. **Painting** goes to a WebGL2 fullscreen draw of the glyph field against the atlas — the compositor shader from the WebGPU backend, ported to GLSL ES 3.00 — instead of building a full-resolution RGBA buffer on the CPU and blitting it. Pointer interactions come along with it, as the real shader rather than the Canvas2D path's cell-granular approximation.

```ts
await createAsciiRenderer({ canvas, profile, backend: 'cpu', workers: false }) // match on the main thread
await createAsciiRenderer({ canvas, profile, backend: 'cpu', workers: 4 }) // pin the pool size
await createAsciiRenderer({ canvas, profile, backend: 'cpu', compositor: 'canvas2d' }) // paint on Canvas2D
```

At 160×42 on an M3 Pro, taking those one at a time: 42.0 ms/frame on the main thread with Canvas2D, 31.9 with the worker pool, **2.8 with the WebGL2 composite as well** — the same number the WebGPU backend posts, and the scene-only floor is 2.7.

A live source pays one frame of latency for the matcher: the renderer presents a frame while the next one matches. The first frame, static sources, and `captureFrame()` are matched inline and pay none. `chromatic` carries frame-to-frame hysteresis and stays on the main thread, though it is painted by the same WebGL2 composite.

## Device loss

A GPU device can vanish — driver reset, tab backgrounded too long, laptop switching GPUs. The renderer rebuilds on a fresh device by itself. For the case it can't recover from, `onDeviceLost` fires and you remount the canvas: a canvas is bound to its first context type for good, so one that has held a `'webgpu'` context can never be given a 2D one, and starting over needs a _new element_. `@ascii-fx/react` does this for you via `canvasKey`.

## Interactions

Pointer-driven effects run in the composite stage, after matching, so they cost nothing extra per glyph:

```ts
ascii.setInteraction({ type: 'reveal', radius: 0.2, feather: 0.08, intensity: 1 })
ascii.pointer.set(0.5, 0.5)
```

`reveal`, `displace`, `wave`, `push`, `color`, `glyph-scale`, `glyph-rotate`, `original-mix`, and `resolution`.

## Capability probe

```ts
import { getAsciiSupport } from '@ascii-fx/gpu'

const { webgpu, recommendedBackend, limitations } = await getAsciiSupport()
```

Safe to call anywhere, including Node during SSR — it reports rather than throws.

## License

[MIT](../../LICENSE)
