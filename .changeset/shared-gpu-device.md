---
'@ascii-fx/gpu': minor
---

Every WebGPU renderer on a page shares one `GPUDevice`, and renderers with the same profile share one engine on it. Each renderer used to request a device of its own and build the same four compute pipelines and the same glyph atlas again: a gallery of thirty `<AsciiImage>` was thirty devices, and browsers budget devices and can refuse the next one. Now the pipelines and atlas are built once and each renderer adds only the buffers for its own canvas.

Nothing changes in what a renderer produces, and there is nothing to configure. The device is destroyed with the last renderer on it. A lost device is replaced once and every renderer moves to the replacement, where each used to request its own.

**Breaking: `onError` reports for the page, not for the renderer.** A GPU error that nothing caught is raised on the device, and a shared device cannot say whose work failed. Each such error is now reported once for the page: to each distinct `onError` handler, and once to the console if any renderer has none. So an `onError` can be told about an error another renderer caused, and renderers that share one `onError` function get one call between them rather than one each. Pass every renderer the same function to hear about each error exactly once. (`onError` on the React components is a different thing — it reports the render failing to appear — and is not affected.)

`AsciiEngine` and `AsciiStream` from `@ascii-fx/gpu/webgpu` are unchanged for code that drives them on a device of its own, as `@ascii-fx/three` does.
