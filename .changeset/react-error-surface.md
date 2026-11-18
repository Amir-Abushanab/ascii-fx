---
'@ascii-fx/react': minor
---

`onError` hears about every way the ASCII render can fail to appear, and none of them takes the tree down:

- **A source the renderer cannot read.** An image or video from another origin, loaded without CORS, makes the first render throw. From an effect that unmounted the component tree; from a `load` listener it went to the console and `onError` never fired. It is now reported, and the `<img>`/`<video>` fallback stays on screen.
- **`<AsciiVideo>` takes `crossOrigin`.** Without it a video from a CDN could not work at all.
- **A profile that fails to load**, which was only logged, and **an option the renderer refuses** (a chromatic matcher on a profile without chromatic data, `jitter` out of range), which threw from an effect.

`<AsciiVideo>` and `<AsciiCanvas>` can be named and driven:

- **`aria-label` / `aria-labelledby`.** A `<video>` has no `alt`, so `<AsciiVideo>` had no accessible name, and an `<AsciiCanvas>` without children exposed nothing at all, since the canvas is hidden from assistive technology. The label goes on the video, or makes the canvas wrapper an image by that name.
- **`autoPlay={false}` is usable.** The render loop only ran when `autoPlay` was on, so a video you started yourself played underneath an ASCII render stuck on its first frame. `videoRef` hands you the `<video>`; call `play()`, pause or seek on it and the render follows.

Also: changing `columns`, `palette` or any other option on a still `<AsciiImage>` repaints it straight away rather than on the next pointer move or resize, and switching `compositor`, or a profile swap that moves `backend: 'auto'` from WebGPU to the CPU matcher, gets a fresh canvas instead of failing on one bound to the other context type.
