---
'@ascii-fx/gpu': minor
'@ascii-fx/three': minor
---

**Breaking:** `createAsciiRenderer` now loads only the backend it builds, and the backend classes moved to subpaths.

```diff
- import { WebGpuAsciiRenderer, AsciiEngine, AsciiStream, CpuAsciiRenderer } from '@ascii-fx/gpu'
+ import { WebGpuAsciiRenderer, AsciiEngine, AsciiStream } from '@ascii-fx/gpu/webgpu'
+ import { CpuAsciiRenderer } from '@ascii-fx/gpu/cpu'
```

Each backend is a separate chunk behind a dynamic `import()`, so a machine with WebGPU never downloads the CPU matcher, worker pool and WebGL2 compositor, and one without WebGPU never downloads the WGSL. Under Rollup or Vite, an app that imports only `createAsciiRenderer` ships a 0.3 KB entry plus about 18 KB gzipped on the WebGPU path or 19 KB on the CPU path, where both backends together were 35 KB. A fallback to the CPU backend costs one extra chunk request before its first frame. Under `'auto'`, the WebGPU chunk is skipped entirely when `navigator.gpu` is absent.

The classes had to leave the main entry for this to work: any static import of a backend makes bundlers keep it in the eager bundle. `createAsciiRenderer`, `getAsciiSupport`, `MAX_GPU_GLYPHS`, the tilt helpers and every type stay where they were. `@ascii-fx/three` now imports from `@ascii-fx/gpu/webgpu`.

`@ascii-fx/core` is now published as one file per module rather than a single bundle. Bundlers split chunks at file granularity, so against a single-file core both backend chunks shared the union of everything either used from it. Per-module output alone takes the WebGPU path from 23.9 KB to 18.3 KB.
