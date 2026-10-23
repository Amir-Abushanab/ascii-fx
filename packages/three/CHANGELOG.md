# @ascii-fx/three

## 0.9.0

### Minor Changes

- [#29](https://github.com/Amir-Abushanab/ascii-fx/pull/29) [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - **Breaking:** `createAsciiRenderer` now loads only the backend it builds, and the backend classes moved to subpaths.

  ```diff
  - import { WebGpuAsciiRenderer, AsciiEngine, AsciiStream, CpuAsciiRenderer } from '@ascii-fx/gpu'
  + import { WebGpuAsciiRenderer, AsciiEngine, AsciiStream } from '@ascii-fx/gpu/webgpu'
  + import { CpuAsciiRenderer } from '@ascii-fx/gpu/cpu'
  ```

  Each backend is a separate chunk behind a dynamic `import()`, so a machine with WebGPU never downloads the CPU matcher, worker pool and WebGL2 compositor, and one without WebGPU never downloads the WGSL. Under Rollup or Vite, an app that imports only `createAsciiRenderer` ships a 0.3 KB entry plus about 18 KB gzipped on the WebGPU path or 19 KB on the CPU path, where both backends together were 35 KB. A fallback to the CPU backend costs one extra chunk request before its first frame. Under `'auto'`, the WebGPU chunk is skipped entirely when `navigator.gpu` is absent.

  The classes had to leave the main entry for this to work: any static import of a backend makes bundlers keep it in the eager bundle. `createAsciiRenderer`, `getAsciiSupport`, `MAX_GPU_GLYPHS`, the tilt helpers and every type stay where they were. `@ascii-fx/three` now imports from `@ascii-fx/gpu/webgpu`.

  `@ascii-fx/core` is now published as one file per module rather than a single bundle. Bundlers split chunks at file granularity, so against a single-file core both backend chunks shared the union of everything either used from it. Per-module output alone takes the WebGPU path from 23.9 KB to 18.3 KB.

- [#29](https://github.com/Amir-Abushanab/ascii-fx/pull/29) [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add palettes, post effects, two glyph sets and SVG export.

  `palette: { colors, dither?, spread? }` snaps each cell's fitted colours to a list of up to 256 through an optional ordered Bayer dither. It is `palette-v1`, specified in `ALGORITHM.md §22` and integer throughout, so the WebGPU compute pass agrees bit for bit with the new `quantizeFrame()` in `@ascii-fx/core`, which the CPU backend runs. It sits between matching and the composite: changing it never rematches, and `captureFrame()` returns the snapped colours. Error diffusion is deliberately absent, since it cannot run in parallel and stay exact.

  `post: { scanlines, vignette, curvature, aberration, grain, bloom }` adds screen-space effects to the composite on both shader compositors. Bloom comes from a per-cell glow field built from each glyph's coverage and colour, so it costs a pass over the grid rather than the canvas. The palette and glow compute pipelines are built the first time a palette or bloom is set, so a renderer that uses neither compiles nothing extra at startup. The Canvas2D fallback draws scanlines, vignette and bloom. With everything on, a 1080p WebGPU frame takes about 0.3 ms longer.

  New built-in charsets: `blocks` (the Block Elements range) and `braille` (all 256 patterns). `frameToSVG(frame)` exports a frame as vector text with every glyph pinned to its column.

  Runtime profiles (`createAsciiProfile`) now size the cell to the widest glyph instead of to `M`. Full-width glyphs such as kanji were being clipped to their left half. Monospace Latin sets are unaffected.

  The WebGL2 compositor no longer samples the motion field in place of the RGBA atlas when an emoji profile is combined with `interaction: { source: 'motion' }`.

  Shader comments and indentation are now stripped at build time. With these features added, the `@ascii-fx/gpu` bundle is 35.3 KB gzipped, up from 33.6 KB.

### Patch Changes

- Updated dependencies [[`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c), [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c), [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c), [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c), [`1441091`](https://github.com/Amir-Abushanab/ascii-fx/commit/1441091888b36e5ea99b3c6fc85fe7295493e05c)]:
  - @ascii-fx/core@0.9.0
  - @ascii-fx/gpu@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`11b0332`](https://github.com/Amir-Abushanab/ascii-fx/commit/11b0332eab378d53e6664cd633f848cbd70bd014)]:
  - @ascii-fx/core@0.8.0
  - @ascii-fx/gpu@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`c95c9f7`](https://github.com/Amir-Abushanab/ascii-fx/commit/c95c9f78373d4b3a2b44527fe64d21d5c3357c55), [`580b9bf`](https://github.com/Amir-Abushanab/ascii-fx/commit/580b9bf1bf93613ee03f1c907af99b409c1a0290)]:
  - @ascii-fx/core@0.7.0
  - @ascii-fx/gpu@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`364b51e`](https://github.com/Amir-Abushanab/ascii-fx/commit/364b51e262b3c72bc85337f780b8533b8fedb1cc)]:
  - @ascii-fx/gpu@0.6.0
  - @ascii-fx/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`e3cf88e`](https://github.com/Amir-Abushanab/ascii-fx/commit/e3cf88ed80ddab106894fc7b3e70309ae85e14a3)]:
  - @ascii-fx/core@0.5.0
  - @ascii-fx/gpu@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`f6861a5`](https://github.com/Amir-Abushanab/ascii-fx/commit/f6861a583f9434717e7f826980ff0a57c4d06fb1), [`f6861a5`](https://github.com/Amir-Abushanab/ascii-fx/commit/f6861a583f9434717e7f826980ff0a57c4d06fb1)]:
  - @ascii-fx/gpu@0.4.0
  - @ascii-fx/core@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`9299da6`](https://github.com/Amir-Abushanab/ascii-fx/commit/9299da6259d8f0b20ad56360212aba4cd05b7722)]:
  - @ascii-fx/gpu@0.3.1
  - @ascii-fx/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [[`79dda82`](https://github.com/Amir-Abushanab/ascii-fx/commit/79dda828e89d69d8e7b0f11527507fb9087f8096), [`79dda82`](https://github.com/Amir-Abushanab/ascii-fx/commit/79dda828e89d69d8e7b0f11527507fb9087f8096)]:
  - @ascii-fx/core@0.3.0
  - @ascii-fx/gpu@0.3.0

## 0.2.0

### Patch Changes

- [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Pre-publish audit fixes, mechanical batch:

  - `@ascii-fx/compiler` ships its fontkit type shim in `dist/` and references it from the types entry, so consumers with `skipLibCheck: false` no longer hit TS2307 on the published declarations. New `COMPILER_PACKAGE_VERSION` export: the installed package version, read from the manifest at runtime.
  - `@ascii-fx/vite` salts both build-cache keys with `COMPILER_PACKAGE_VERSION`, so caches in `node_modules/.ascii-fx` never outlive the compiler that wrote them.
  - `@ascii-fx/react-three` declares the `react` peer it can actually satisfy (`^19`, required by `@react-three/fiber` v9) and includes `matcher`/`hysteresis` in the option-change key, so changing only those no longer silently no-ops.
  - `@ascii-fx/gpu` destroys the RGBA atlas texture in `AsciiEngine.destroy()`, closing a per-rebuild leak on shared-device hosts.
  - `@ascii-fx/three` disposes the `InstancedMesh` in `AsciiGlyphs.dispose()`, releasing its instanced attributes deterministically.
  - `@ascii-fx/react` drops a needless `<AsciiCanvas>` source-effect re-run on `renderMode` changes.

- Updated dependencies [[`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb), [`88d73f6`](https://github.com/Amir-Abushanab/ascii-fx/commit/88d73f62a990e9a1fa0cc03a740d81d5bbf774fb), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2), [`7a97a32`](https://github.com/Amir-Abushanab/ascii-fx/commit/7a97a3262271b58d211897aece93ffdd69ce4ee0), [`6a9cf29`](https://github.com/Amir-Abushanab/ascii-fx/commit/6a9cf2924e69b8591e69213c7ac90662401e1d96), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2), [`f471dd9`](https://github.com/Amir-Abushanab/ascii-fx/commit/f471dd98f2485e5b2c06c2924da5a8b6ba6f29a2)]:
  - @ascii-fx/core@0.2.0
  - @ascii-fx/gpu@0.2.0
