# @ascii-fx/three

Render a Three.js scene as ASCII, without ever leaving the GPU.

```sh
pnpm add @ascii-fx/three three
```

```ts
import * as THREE from 'three/webgpu'
import { AsciiPass } from '@ascii-fx/three'

const renderer = new THREE.WebGPURenderer()
const pass = new AsciiPass({ renderer, profile, columns: 160 })
await pass.init() // compiles the pipelines, and initializes the renderer if you haven't

renderer.setAnimationLoop(() => pass.render(scene, camera))
```

`pass.render()` replaces `renderer.render()`. The scene goes through three's own output pass first, so the renderer's `toneMapping`, `outputColorSpace` and antialiasing all apply and the glyphs are matched against the picture the canvas would have shown. The render target follows the renderer's drawing buffer, so `renderer.setSize()` on a window resize is all a resize takes; pass `width`/`height`, or call `pass.setSize()`, to pin it instead.

## Why WebGPURenderer only

The pass runs the matcher **on Three's own `GPUDevice`** — the scene's render target is matched and composited in place, with no readback. That's what keeps it cheap enough to run every frame.

A WebGL renderer can't do that. Matching a WebGL-rendered scene exactly would mean pulling every frame back to the CPU, matching there, and pushing the result up again — a GPU→CPU→GPU round trip per frame, which is slow enough to defeat the point. Rather than ship a "supported" path that's quietly 20× slower, this package requires `THREE.WebGPURenderer` and says so. It reaches the renderer's `GPUDevice` through `renderer.backend`, which three does not document; the test suite runs against r187.

If you're on WebGL and want ASCII, render your scene to a canvas and feed that canvas to [`@ascii-fx/gpu`](../gpu) as a source — you'll pay the readback, but explicitly.

## Glyphs as geometry

`AsciiGlyphs` is the other direction: an instanced mesh of glyph quads you can place in the scene and move with the camera, rather than a full-frame post effect. It displays a frame you matched elsewhere — `matchFrame()` from `@ascii-fx/core`, or a renderer's `captureFrame()` — and is unlit: each glyph is drawn in its frame colours.

```ts
import { matchFrame } from '@ascii-fx/core'
import { AsciiGlyphs } from '@ascii-fx/three'

const glyphs = new AsciiGlyphs({ profile, columns: 120, rows: 40 })
scene.add(glyphs.mesh)
glyphs.updateFromFrame(matchFrame(image, { profile, columns: 120, rows: 40, color: 'full' }))
```

One draw call for the whole grid.

`three` is a peer dependency (`>=0.170.0`); add `@types/three` for TypeScript. For React Three Fiber, use [`@ascii-fx/react-three`](../react-three).

## License

[MIT](../../LICENSE)
