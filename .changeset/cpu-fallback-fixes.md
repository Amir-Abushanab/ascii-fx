---
'@ascii-fx/gpu': patch
---

Three fixes to the CPU backend, the path taken when there is no WebGPU adapter:

- **A still source no longer goes stale.** With the worker pool up, `setOptions()` or `setSource()` followed by `render()` on an image presented the old cells, left the new ones in the pool for good, and kept a 60 Hz `requestAnimationFrame` loop running until `destroy()`. Static sources are now matched inline, as the docs always said, and a page of stills starts no workers at all. A live source rendered by hand, and a video that pauses or ends, now get their last frame without another `render()`.
- **Emoji draw in colour on the WebGL2 compositor.** A `matcher: 'chromatic'` frame was drawn in the `color` option's mode, which is ignored for that matcher and defaults to `mono`: every emoji came out as a white silhouette. The Canvas2D and WebGPU paths were already right.
- **`adaptiveResolution` only ever lowers the grid.** A grid under 40 columns was raised to 40 under frame pressure, and an explicit `rows` kept its value while `columns` shrank, which changed the picture's aspect. Both dimensions now scale from the grid the options resolve to. WebGPU backend.
