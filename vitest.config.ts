import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const alias = {
  '@ascii-fx/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
  '@ascii-fx/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
  '@ascii-fx/gpu': fileURLToPath(new URL('./packages/gpu/src/index.ts', import.meta.url)),
  '@ascii-fx/three': fileURLToPath(new URL('./packages/three/src/index.ts', import.meta.url)),
}

export default defineConfig({
  test: {
    // Measured over the `node` project only, so it covers exactly the packages whose
    // tests run there: core, compiler, vite. @ascii-fx/{gpu,react,three,react-three} are
    // tested by the `gpu-browser` project instead — a separate vitest run that reports no
    // coverage here — so including them would read as ~2% and mean nothing. `pnpm
    // test:gpu` is what holds those to account; this number is about the CPU matcher,
    // the compiler, and the codecs.
    coverage: {
      provider: 'v8',
      include: ['packages/{core,compiler,vite}/src/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
      // A floor, not a target: set just under where the suite actually sits so it catches
      // coverage falling off a cliff, not so it has to be chased upward on every PR.
      thresholds: { statements: 80, lines: 80, functions: 75, branches: 65 },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'gpu-browser',
          include: [
            'packages/*/test-browser/**/*.test.ts',
            'packages/*/test-browser/**/*.test.tsx',
          ],
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                // Full Chromium new headless: headless shell lacks a
                // presentation path for WebGPU canvas contexts.
                channel: 'chromium',
                args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU'],
              },
            }),
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
