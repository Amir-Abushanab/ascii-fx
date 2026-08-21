---
'@ascii-fx/gpu': patch
'@ascii-fx/react': patch
---

Recover from GPU device loss instead of silently rendering nothing.

A `GPUDevice` can be taken away at any point — a browser reclaims it under memory pressure, the GPU process crashes, a driver resets. Nothing throws when it happens: submits against a lost device are validly dropped. The renderer kept its loop running, kept reporting a grid and a frame rate, and left whatever was last presented sitting on the canvas, so the failure looked like a healthy renderer with a frozen picture.

The WebGPU renderer now watches `device.lost` and rebuilds in place on a fresh device, reconfiguring the same canvas context. `captureFrame()` waits out a rebuild rather than reading back through the dead device. When a replacement cannot be acquired the new `onDeviceLost` option fires, so the caller can swap in a fresh `<canvas>` and continue on the CPU matcher — recovery cannot cross backends by itself, since an element is bound to its first context type for good.

Also fixes `backend: 'auto'` failing outright when WebGPU initialisation got far enough to acquire the canvas context and then failed — on a browser with a partial implementation, that bound the canvas to `'webgpu'` and left the CPU fallback with no context to take. The context is now acquired last, after everything that can fail.

`@ascii-fx/react` handles the whole path on its own: `useAscii` now returns a `canvasKey` that changes when the canvas has to be replaced, and `<AsciiImage>`/`<AsciiVideo>`/`<AsciiCanvas>` apply it. A device loss the renderer cannot recover from remounts the canvas, which lets `backend: 'auto'` run again and land on the CPU matcher — previously `auto` chose once at construction and a GPU that died later left the component on a dead renderer. Three unrecovered losses in a row stop the cycle and surface an error instead.

Also surfaces WebGPU failures that are not device loss. WebGPU validates `createBuffer`, `createTexture`, `createBindGroup` and every dispatch silently — errors go to an error scope or `uncapturederror`, never to a throw — so a browser whose limits or WGSL support differ could accept the whole of setup and then render nothing, while the renderer reported backend `webgpu` at a healthy frame rate. Setup now runs inside validation and internal error scopes and throws if either reports, which lets `backend: 'auto'` fall back to the exact CPU matcher; run-time errors reach the new `onError` option, which logs by default instead of vanishing.
