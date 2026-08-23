# @ascii-fx/react

Drop-in ASCII rendering for React: `<AsciiImage>`, `<AsciiVideo>`, `<AsciiCanvas>`, and the hooks underneath them.

```sh
pnpm add @ascii-fx/react
```

```tsx
import { AsciiImage } from '@ascii-fx/react'

;<AsciiImage src="/cat.jpg" alt="Cat" />
```

No profile, no config, no setup. It compiles a monospace profile at runtime, renders on the GPU where there is one, and falls back to the exact CPU matcher where there isn't. Precompiled profiles via [`@ascii-fx/vite`](../vite) are faster and deterministic, but they're an optimisation, not a prerequisite.

## What renders before the canvas does

The server renders the **real `<img>` or `<video>`** — correct `alt`, correct dimensions, no wrapper hacks — and the client fades the canvas in over it once matching succeeds. The fallback element stays in the layout and in the accessibility tree the whole time, so:

- no-JS gets the actual image
- no-WebGPU gets the CPU matcher, and if that fails too, still the actual image
- a slow load or a hard failure degrades to the actual image
- there's no layout shift and no flash, because nothing is ever absent

`alt` is required by the type on `<AsciiImage>`. Use `alt=""` for decorative images, deliberately.

## When it fails

A renderer that can't be built is invisible by design — the fallback is already on screen and simply stays there. `onError` is how your app finds out:

```tsx
<AsciiVideo src="/clip.mp4" onError={(e) => reportToSentry(e)} autoPlay muted loop />
```

It fires once per distinct failure, for a failed init and for a GPU device loss that couldn't be recovered from.

## Motion and cost

`prefers-reduced-motion` disables autoplay and interactions while keeping a static frame. Rendering pauses when the component scrolls offscreen or the tab is hidden. Both are on by default; `respectReducedMotion` and `pauseWhenOffscreen` turn them off.

## Hooks

```tsx
const { renderer, profile, error, canvasKey } = useAscii(canvasRef, { profile, columns: 120 })
```

`canvasKey` is the important one: put it on your `<canvas key={canvasKey}>`. It changes when the canvas has to be thrown away and remade — a backend switch, or a device loss the renderer couldn't recover from — because a canvas is bound to its first context type for good, so one that ran WebGPU can never fall back to 2D.

Also `useAsciiProfile`, `useAsciiSupport`, and `usePrefersReducedMotion`.

## RSC and Next

Every file ships the `'use client'` directive, so the components work in the App Router without a wrapper. The package is side-effect free and ESM-only.

## License

[MIT](../../LICENSE)
