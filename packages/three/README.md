# @ascii-fx/three

Three.js adapter. `AsciiPass` post-processes a scene through the exact matcher **on Three's own GPUDevice** — zero readback — and composites straight to the canvas. Requires `THREE.WebGPURenderer` (r170–r185 verified): exactly matching a WebGL renderer would need per-frame GPU→CPU readback, so it is not supported (spec §30).

```ts
import * as THREE from 'three/webgpu'
import { AsciiPass } from '@ascii-fx/three'

const renderer = new THREE.WebGPURenderer({ canvas })
await renderer.init()

const pass = new AsciiPass({ profile, renderer, columns: 160, color: 'full' })
await pass.init()

function frame() {
  pass.render(scene, camera)      // instead of renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
pass.set({ columns: 180 })
pass.pointer.set(x01, y01)
pass.setInteraction({ type: 'wave' })
```

Color handling (spec §28): render targets hold linear-light values, so the pass sRGB-encodes before quantization. With pure 0/1 scene colors this is exact (the conformance test uses that); midtones can differ ±1 byte across GPUs in the encode — a source-side conversion, not matcher variance. Tone mapping is not applied to render targets; treat the RT as the match source.

`AsciiGlyphs` (experimental): instanced plane-per-cell renderer with a TSL node material sampling the profile atlas — glyph ids/colors as instanced attributes via `updateFromFrame(frame)` (CPU hop in v1; a zero-readback bridge from the GPU cell buffer is planned), transforms in the standard `instanceMatrix` for effects.
