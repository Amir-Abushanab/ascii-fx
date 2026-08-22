// Access to WebGPURenderer backend internals. Three does not yet expose the
// GPUDevice / canvas context / texture handles publicly; these accessors are
// the supported-in-practice interop points, verified against r170–r185.
import type { Texture } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

interface BackendLike {
  device?: GPUDevice
  context?: GPUCanvasContext
  get?: (object: unknown) => { texture?: GPUTexture } | undefined
}

const backendOf = (renderer: WebGPURenderer): BackendLike | undefined =>
  (renderer as unknown as { backend?: BackendLike }).backend

export function getDevice(renderer: WebGPURenderer): GPUDevice {
  const device = backendOf(renderer)?.device
  if (!device) {
    throw new Error(
      'AsciiPass requires an initialized THREE.WebGPURenderer — `await renderer.init()` first. ' +
        'WebGL renderers are unsupported: exact matching would require per-frame GPU→CPU readback (spec §30).',
    )
  }
  return device
}

export function getCanvasContext(renderer: WebGPURenderer): GPUCanvasContext {
  const context = backendOf(renderer)?.context
  if (!context) {
    throw new Error(
      'Could not access the WebGPU canvas context via renderer.backend (supported: three r170–r185).',
    )
  }
  return context
}

export function getGpuTexture(renderer: WebGPURenderer, texture: Texture): GPUTexture {
  const data = backendOf(renderer)?.get?.(texture)
  const gpuTexture = data?.texture
  if (!gpuTexture) {
    throw new Error(
      'Could not access the render target GPU texture via renderer.backend — render to the target once first ' +
        '(supported: three r170–r185).',
    )
  }
  return gpuTexture
}
