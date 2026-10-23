import type { AsciiRenderer, AsciiRendererOptions } from './types.js'

export { getAsciiSupport } from './support.js'
export { forwardTiltToPointer, TiltSource, type TiltOptions, type TiltStatus } from './tilt.js'
export { MAX_GPU_GLYPHS } from './limits.js'
// Types only: erased at build, so they cost the main entry nothing. The classes behind them
// live on `./webgpu` and `./cpu`, which createAsciiRenderer loads lazily.
export type { StreamFxState, StreamMatchOptions, StreamViewOptions } from './engine.js'
export type {
  AsciiPipeline,
  AsciiPointer,
  AsciiRenderer,
  AsciiRendererOptions,
  AsciiRendererRuntimeOptions,
  BackendChoice,
  FitMode,
  InteractionOptions,
  InteractionType,
  PostOptions,
  RenderSource,
} from './types.js'

/**
 * Create a renderer (spec §2). 'auto' prefers exact WebGPU matching and falls
 * back to the exact CPU matcher — never to an approximate matcher (spec §11).
 */
export async function createAsciiRenderer(options: AsciiRendererOptions): Promise<AsciiRenderer> {
  // Each backend is its own chunk, fetched only when it is the one being built: the two are
  // about the same size, and a page never runs both. A machine with WebGPU never downloads the
  // CPU matcher, worker pool and WebGL2 compositor, and one without it never downloads the WGSL.
  const backend = options.backend ?? 'auto'
  // 'auto' skips the WebGPU chunk outright where there is no WebGPU to build on. An explicit
  // 'webgpu' still loads it, so the failure carries the backend's own message.
  const tryGpu =
    backend === 'webgpu' ||
    (backend === 'auto' && typeof navigator !== 'undefined' && Boolean(navigator.gpu))
  if (tryGpu) {
    try {
      const { WebGpuAsciiRenderer } = await import('./renderer.js')
      return await WebGpuAsciiRenderer.create(options)
    } catch (err) {
      if (backend === 'webgpu') throw err
      // 'auto': fall through to the exact CPU backend (§49: visible via renderer.backend).
    }
  }
  const { CpuAsciiRenderer } = await import('./cpuBackend.js')
  return new CpuAsciiRenderer(options)
}
