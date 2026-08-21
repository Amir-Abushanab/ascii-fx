import { defineConfig } from 'tsup'

// Declarations are emitted by `tsc -p tsconfig.build.json`, not here: tsup's
// dts step runs rollup-plugin-dts, which reaches into TypeScript internals
// that TS 7 moved and crashes on `useCaseSensitiveFileNames`.
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
})
