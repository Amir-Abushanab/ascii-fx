---
'@ascii-fx/gpu': patch
---

- **`adaptiveResolution` tells a slow GPU from a slow display.** It judged pressure from frame intervals alone, so a display throttled to 30 Hz read as sustained pressure: the grid stepped down to a third of what was asked for and never came back, since a smaller grid cannot make the display faster. It now also times the GPU's work, and steps down only when that is what is late. It paces video too, which it never did.
- **A see-through `clearColor` presents at the strength it was given.** The shader compositors passed it through unpremultiplied, so `[0.5, 0, 0, 0.5]` came out as full red at half alpha. Canvas2D was already right; all three agree now.
- **`captureFrame()` calls can overlap** on WebGPU. They shared one staging buffer, so a second capture started before the first had been read back was rejected.
- **A pointer move uploads nothing** on the CPU backend's WebGL2 compositor. Every present repacked all the cells, and with `reveal` or `original-mix` pushed the whole source image to the GPU again, on every move.
- **`setInteraction({ source: 'motion' })` on a still** takes effect on WebGPU; set after the first frame it stayed pointer-driven.
