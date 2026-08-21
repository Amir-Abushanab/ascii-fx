---
"@ascii-fx/gpu": patch
---

WebGPU availability guards check `navigator.gpu` truthiness instead of `'gpu' in navigator`, so environments where the property exists but is undefined (privacy modes, test shims) get the clear "WebGPU is unavailable" error instead of a raw TypeError.
