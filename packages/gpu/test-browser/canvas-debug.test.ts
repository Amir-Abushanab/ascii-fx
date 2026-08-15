import { expect, it } from 'vitest'

it('offscreen canvas webgpu configure + present probe', async () => {
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return
  const device = await adapter.requestDevice()
  const canvas = new OffscreenCanvas(64, 64)
  const ctx = canvas.getContext('webgpu')
  // eslint-disable-next-line no-console
  console.log('[cvs] context acquired:', !!ctx, 'preferred:', navigator.gpu.getPreferredCanvasFormat())
  if (!ctx) throw new Error('no webgpu context')

  device.pushErrorScope('validation')
  ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })
  const cfgErr = await device.popErrorScope()
  // eslint-disable-next-line no-console
  console.log('[cvs] configure error:', cfgErr?.message ?? 'none')

  device.pushErrorScope('validation')
  const tex = ctx.getCurrentTexture()
  const texErr = await device.popErrorScope()
  // eslint-disable-next-line no-console
  console.log('[cvs] getCurrentTexture error:', texErr?.message?.slice(0, 300) ?? 'none')

  device.pushErrorScope('validation')
  const enc = device.createCommandEncoder()
  const pass = enc.beginRenderPass({
    colorAttachments: [{ view: tex.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }],
  })
  pass.end()
  device.queue.submit([enc.finish()])
  const rpErr = await device.popErrorScope()
  // eslint-disable-next-line no-console
  console.log('[cvs] clear pass error:', rpErr?.message?.slice(0, 300) ?? 'none')

  device.destroy()
  expect(cfgErr ?? texErr ?? rpErr).toBeNull()
})
