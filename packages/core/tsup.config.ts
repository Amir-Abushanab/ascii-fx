import { defineConfig } from 'tsup'

// Declarations are emitted by `tsc -p tsconfig.build.json`, not here: tsup's
// dts step runs rollup-plugin-dts, which reaches into TypeScript internals
// that TS 7 moved and crashes on `useCaseSensitiveFileNames`.
export default defineConfig({
  // One output file per source module rather than one bundle. Consumers' bundlers split code at
  // file granularity: against a single-file core, two lazily loaded chunks that each use a little
  // of it (the gpu package's two backends) share one chunk holding the union of both. Per-module
  // output lets each chunk take only the modules it uses.
  entry: ['src/**/*.ts'],
  bundle: false,
  format: ['esm'],
  target: 'es2022',
  clean: true,
  sourcemap: true,
})
