import { expect, it } from 'vitest'
import { COMPOSITE_WGSL, FEATURES_WGSL, MAX_GPU_GLYPHS, MIPGEN_WGSL, REDUCE_WGSL, matchWgsl } from '../src/shaders.js'

it('all shader modules compile cleanly', async () => {
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return
  const device = await adapter.requestDevice()
  const shaders: Record<string, string> = {
    reduce: REDUCE_WGSL,
    features: FEATURES_WGSL,
    match: matchWgsl(MAX_GPU_GLYPHS),
    composite: COMPOSITE_WGSL,
    mipgen: MIPGEN_WGSL,
  }
  const errors: string[] = []
  for (const [name, code] of Object.entries(shaders)) {
    const mod = device.createShaderModule({ code })
    const info = await mod.getCompilationInfo()
    for (const m of info.messages) {
      const line = code.split('\n')[m.lineNum - 1] ?? ''
      const text = `[${name}] ${m.type} ${m.lineNum}:${m.linePos} ${m.message}\n    ${line.trim()}`
      // eslint-disable-next-line no-console
      console.log(text)
      if (m.type === 'error') errors.push(text)
    }
  }
  device.destroy()
  expect(errors).toEqual([])
})
