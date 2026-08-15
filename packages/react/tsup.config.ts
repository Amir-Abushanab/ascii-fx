import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: {
    // RSC/Next App Router consumers need the directive preserved (spec §18).
    js: "'use client';",
  },
})
