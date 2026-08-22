# @ascii-fx/react-three

React Three Fiber bindings (kept separate from `@ascii-fx/react` so plain React apps never pull Three). Requires an R3F v9 `<Canvas>` running `THREE.WebGPURenderer`.

```tsx
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { AsciiEffect } from '@ascii-fx/react-three'

;<Canvas
  gl={async (props) => {
    const renderer = new THREE.WebGPURenderer(props as never)
    await renderer.init()
    return renderer
  }}
>
  <mesh>{/* your scene */}</mesh>
  <AsciiEffect profile={profileRef} columns={180} interaction="reveal" />
</Canvas>
```

`<AsciiEffect>` takes over the render loop while mounted (AsciiPass under the hood), auto-wires the R3F pointer, and resizes with the canvas. `useAsciiEffect(options)` returns the pass for imperative control (`captureFrame`, `set`).

`<AsciiGlyphs profile={profile} columns={80} rows={45} frame={frame} />` renders the instanced 3D glyph field from a matched frame.
