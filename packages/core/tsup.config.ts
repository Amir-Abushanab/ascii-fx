import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/canvas2d.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: true,
  sourcemap: true,
})
