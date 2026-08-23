# @ascii-fx/react-three

[`@ascii-fx/three`](../three) as React Three Fiber components.

```sh
pnpm add @ascii-fx/react-three three @react-three/fiber
```

```tsx
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { AsciiEffect } from '@ascii-fx/react-three'

;<Canvas gl={(canvas) => new THREE.WebGPURenderer({ canvas })}>
  <mesh>
    <torusKnotGeometry />
    <meshNormalMaterial />
  </mesh>
  <AsciiEffect profile={profile} columns={160} />
</Canvas>
```

Drop `<AsciiEffect>` inside a `<Canvas>` and everything rendered before it comes out as ASCII.

## Why it's a separate package

This is the only entry point in the project that pulls in `three` _and_ `@react-three/fiber`. Folding it into [`@ascii-fx/react`](../react) would put both in the dependency graph of every plain React app that just wanted `<AsciiImage>` — so it lives here, and you install it only if you're already in R3F.

## Components

- **`<AsciiEffect>`** — post-processes the scene through the exact matcher on the renderer's own device, no readback.
- **`<AsciiGlyphs>`** — an instanced glyph mesh you can place, light, and move within the scene.
- **`useAsciiEffect`** — the hook underneath, when you want the pass without the component.

Requires an R3F v9 `<Canvas>` running `THREE.WebGPURenderer`; see [`@ascii-fx/three`](../three) for why WebGL isn't supported.

## License

[MIT](../../LICENSE)
