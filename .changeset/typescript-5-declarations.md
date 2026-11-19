---
'@ascii-fx/gpu': patch
---

The package's types compile on TypeScript 5 without `@webgpu/types`. The main entry's declarations named WebGPU's global types (`GPUDevice`, `GPUDeviceLostInfo`, …), which TypeScript only ships in its own DOM library from 6.0. A project on 5.x with `skipLibCheck: false` got 25 errors from inside `@ascii-fx/gpu` unless it had installed `@webgpu/types`, even if it never touched the GPU types; with `skipLibCheck` on, the same types quietly became `any`.

`onDeviceLost` and `onError` are now typed with two exported aliases, `DeviceLostInfo` and `GpuError`: the WebGPU types where they exist, their shape where they do not. `@ascii-fx/gpu/webgpu`, which is written in terms of a `GPUDevice` you pass it, still needs the WebGPU types, as before.
