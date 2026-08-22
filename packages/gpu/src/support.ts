import type { AsciiSupport } from '@ascii-fx/core'

let cached: Promise<AsciiSupport> | undefined

/**
 * Capability probe (spec §50). A present `navigator.gpu` proves nothing —
 * this actually acquires an adapter and device before reporting webgpu: true.
 * The probe is cached for the session.
 */
export function getAsciiSupport(): Promise<AsciiSupport> {
  cached ??= probe()
  return cached
}

async function probe(): Promise<AsciiSupport> {
  const limitations: string[] = []
  let webgpu = false
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        const device = await adapter.requestDevice()
        device.destroy()
        webgpu = true
      } else {
        limitations.push('WebGPU is present but no adapter is available.')
      }
    } catch (err) {
      limitations.push(
        `WebGPU device acquisition failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } else {
    limitations.push('navigator.gpu is not available.')
  }

  let webgl2 = false
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      webgl2 = new OffscreenCanvas(1, 1).getContext('webgl2') !== null
    } else if (typeof document !== 'undefined') {
      webgl2 = document.createElement('canvas').getContext('webgl2') !== null
    }
  } catch {
    // leave false
  }

  const worker = typeof Worker !== 'undefined'
  const offscreenCanvas = typeof OffscreenCanvas !== 'undefined'
  if (!webgpu) {
    limitations.push(
      'Worker matcher backend is not yet implemented; CPU matching runs on the main thread.',
    )
  }

  return {
    webgpu,
    webgl2,
    worker,
    offscreenCanvas,
    recommendedBackend: webgpu ? 'webgpu' : 'cpu',
    limitations,
  }
}
