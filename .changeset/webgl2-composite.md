---
'@ascii-fx/gpu': minor
---

Paint the CPU fallback with WebGL2 instead of Canvas2D.

This is the other half of spec §12's fallback ("CPU/Worker structural matcher →
compact glyph field → WebGL2 fullscreen composite"). The glyph field goes to a
uint texture and one fullscreen draw samples it against the atlas, rather than
`compositeFrame` building a full-resolution RGBA buffer on the CPU and
`putImageData` blitting it.

The shader is `COMPOSITE_WGSL` ported to GLSL ES 3.00 — the same compositor the
WebGPU backend runs — so the pointer interactions come with it as the real
shader, where the Canvas2D path approximated them at cell granularity.

At 160×42 on an M3 Pro the fallback goes from 31.9 ms/frame to **2.8**, which is
what the WebGPU backend posts and 0.1 ms off the scene-only floor. With the
worker matcher, that is 42.0 → 2.8 for the whole no-GPU path.

The canvas takes a `webgl2` context where it can, so `getContext('2d')` on it
returns null; `compositor: 'canvas2d'` opts out and is unchanged. Canvas2D is
still the automatic path wherever WebGL2 is unavailable, and the two are not
pixel-identical — Canvas2D builds the grid at native cell size and scales down,
WebGL2 samples a mipped atlas the way WebGPU does, so `auto` is also the closer
match to the GPU output.
