import { defineConfig } from 'tsup'

// Declarations are emitted by `tsc -p tsconfig.build.json`, not here: tsup's
// dts step runs rollup-plugin-dts, which reaches into TypeScript internals
// that TS 7 moved and crashes on `useCaseSensitiveFileNames`.
export default defineConfig({
  entry: ['src/index.ts', 'src/canvas2d.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  sourcemap: true,
})
