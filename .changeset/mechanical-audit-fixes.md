---
"@ascii-fx/compiler": patch
"@ascii-fx/vite": patch
"@ascii-fx/gpu": patch
"@ascii-fx/three": patch
"@ascii-fx/react": patch
"@ascii-fx/react-three": patch
---

Pre-publish audit fixes, mechanical batch:

- `@ascii-fx/compiler` ships its fontkit type shim in `dist/` and references it from the types entry, so consumers with `skipLibCheck: false` no longer hit TS2307 on the published declarations. New `COMPILER_PACKAGE_VERSION` export: the installed package version, read from the manifest at runtime.
- `@ascii-fx/vite` salts both build-cache keys with `COMPILER_PACKAGE_VERSION`, so caches in `node_modules/.ascii-fx` never outlive the compiler that wrote them.
- `@ascii-fx/react-three` declares the `react` peer it can actually satisfy (`^19`, required by `@react-three/fiber` v9) and includes `matcher`/`hysteresis` in the option-change key, so changing only those no longer silently no-ops.
- `@ascii-fx/gpu` destroys the RGBA atlas texture in `AsciiEngine.destroy()`, closing a per-rebuild leak on shared-device hosts.
- `@ascii-fx/three` disposes the `InstancedMesh` in `AsciiGlyphs.dispose()`, releasing its instanced attributes deterministically.
- `@ascii-fx/react` drops a needless `<AsciiCanvas>` source-effect re-run on `renderMode` changes.
