import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['three', 'three/webgpu', 'three/tsl', '@react-three/fiber', 'react'],
  banner: {
    js: "'use client';",
  },
})
