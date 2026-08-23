# @ascii-fx/three

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
