import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const alias = {
  '@ascii-fx/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
  '@ascii-fx/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
  '@ascii-fx/gpu': fileURLToPath(new URL('./packages/gpu/src/index.ts', import.meta.url)),
  '@ascii-fx/three': fileURLToPath(new URL('./packages/three/src/index.ts', import.meta.url)),
}

// The browser suite is split in two because a GitHub runner cannot honestly run all of
// it. Chromium there reports a *software* adapter — so an availability check passes —
// and that adapter then dies partway through the conformance workload ("Instance dropped
// in popErrorScope"). Proving a GPU matcher bit-exact against a rasterizer that falls
// over is not proof, so those suites run only where an adapter is real, and CI runs the
// half that needs no GPU.
const CPU_BROWSER_TESTS = [
  'packages/gpu/test-browser/cpu-fx.test.ts',
  'packages/three/test-browser/asciiGlyphs.test.ts',
  'packages/react/test-browser/on-error.test.tsx',
]

const browser = () =>
  ({
    enabled: true,
    headless: true,
    provider: playwright({
      launchOptions: {
        // Full Chromium new headless: headless shell lacks a presentation path for
        // WebGPU canvas contexts.
        channel: 'chromium',
        args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU'],
      },
    }),
    screenshotFailures: false,
    instances: [{ browser: 'chromium' as const }],
  }) as const

export default defineConfig({
  test: {
    // Measured over the `node` project only, so it covers exactly the packages whose
    // tests run there: core, compiler, vite. @ascii-fx/{gpu,react,three,react-three} are
    // tested by the browser projects instead — separate vitest runs that report no
    // coverage here — so including them would read as ~2% and mean nothing. `pnpm
    // test:browser` and `pnpm test:gpu` hold those to account; this number is about the
    // CPU matcher, the compiler, and the codecs.
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
          name: 'browser-cpu',
          // Real Chromium, no GPU required: the CPU fallback path, the instanced glyph
          // renderer, and the React error surface. This is the browser coverage every
          // machine can honestly provide, so CI runs it unconditionally.
          include: CPU_BROWSER_TESTS,
          testTimeout: 60_000,
          browser: browser(),
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'gpu-conformance',
          // Everything else under test-browser/ — the suites that need a working adapter.
          // Catch-all rather than a list, so a new GPU test is picked up here by default
          // instead of being silently unrun.
          include: [
            'packages/*/test-browser/**/*.test.ts',
            'packages/*/test-browser/**/*.test.tsx',
          ],
          exclude: CPU_BROWSER_TESTS,
          testTimeout: 60_000,
          browser: browser(),
        },
      },
    ],
  },
})
