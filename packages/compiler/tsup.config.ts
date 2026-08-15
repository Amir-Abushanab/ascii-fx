import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
})
