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
          include: ['packages/*/test-browser/**/*.test.ts', 'packages/*/test-browser/**/*.test.tsx'],
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
