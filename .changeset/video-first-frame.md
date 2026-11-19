---
'@ascii-fx/gpu': patch
---

WebGPU: a video that has just loaded no longer fails its first render. A `<video>` reports `loadeddata` a moment before the browser has a decoded frame it can hand to the GPU, and the copy throws in that window. `<AsciiVideo>` renders at exactly that moment, so on an unlucky load the ASCII render never appeared (and since 0.10.0, `onError` reported it). The renderer now waits for the frame and renders when it arrives.

Found by a new suite that puts a real video in front of both backends: playing, paused, hovered while paused, resized, seeked and resumed. Until now every test fed the renderer stills and canvases.
