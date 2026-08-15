import { CpuAsciiRenderer } from './cpuBackend.js'
import { WebGpuAsciiRenderer } from './renderer.js'
import type { AsciiRenderer, AsciiRendererOptions } from './types.js'

export { getAsciiSupport } from './support.js'
export { MAX_GPU_GLYPHS } from './shaders.js'
export { CpuAsciiRenderer } from './cpuBackend.js'
export { WebGpuAsciiRenderer } from './renderer.js'
export {
  AsciiEngine,
  AsciiStream,
  type StreamFxState,
  type StreamMatchOptions,
  type StreamViewOptions,
} from './engine.js'
export type {
  AsciiPointer,
  AsciiRenderer,
  AsciiRendererOptions,
  AsciiRendererRuntimeOptions,
  BackendChoice,
  FitMode,
  InteractionOptions,
  InteractionType,
  RenderSource,
} from './types.js'

/**
 * Create a renderer (spec §2). 'auto' prefers exact WebGPU matching and falls
 * back to the exact CPU matcher — never to an approximate matcher (spec §11).
 */
export async function createAsciiRenderer(options: AsciiRendererOptions): Promise<AsciiRenderer> {
  const backend = options.backend ?? 'auto'
  if (backend !== 'cpu') {
    try {
      return await WebGpuAsciiRenderer.create(options)
    } catch (err) {
      if (backend === 'webgpu') throw err
      // 'auto': fall through to the exact CPU backend (§49: visible via renderer.backend).
    }
  }
  return new CpuAsciiRenderer(options)
}
