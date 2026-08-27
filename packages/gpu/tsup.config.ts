import { defineConfig } from 'tsup'

// Declarations are emitted by `tsc -p tsconfig.build.json`, not here: tsup's
// dts step runs rollup-plugin-dts, which reaches into TypeScript internals
// that TS 7 moved and crashes on `useCaseSensitiveFileNames`.
const shared = {
  format: ['esm'] as const,
  target: 'es2022',
  sourcemap: true,
}

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts'],
    clean: true,
  },
  {
    // The matcher worker is its own entry so `new Worker(new URL(
    // './matchWorker.js', import.meta.url))` resolves to a real file — the form
    // Vite/webpack/rspack detect and bundle (spec §13).
    //
    // @ascii-fx/core is bundled *into* it rather than left as a bare import: a
    // module worker gets its own module map and does not inherit the document's
    // import map, so a bare specifier that resolves fine on the page fails to
    // resolve in the worker. Without a bundler that is a worker which dies on
    // load and a pool that silently never reports ready.
    ...shared,
    entry: ['src/matchWorker.ts'],
    noExternal: ['@ascii-fx/core'],
    clean: false,
  },
])
