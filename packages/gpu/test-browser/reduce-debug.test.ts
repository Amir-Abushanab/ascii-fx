import { expect, it } from 'vitest'
import { REDUCE_WGSL } from '../src/shaders.js'

it('reduce pass roundtrips an 8×8 identity source', async () => {
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return
  const device = await adapter.requestDevice()

  const tex = device.createTexture({
    size: [8, 8],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const data = new Uint8Array(8 * 8 * 4)
  for (let i = 0; i < 64; i++) {
    data[i * 4] = i
    data[i * 4 + 1] = 255 - i
    data[i * 4 + 2] = (i * 3) & 0xff
    data[i * 4 + 3] = 255
  }
  device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: 32 }, [8, 8])

  const params = new Uint32Array(16)
  params[0] = 8 // srcW
  params[1] = 8 // srcH
  params[2] = 1 // cols
  params[3] = 1 // rows
  params[8] = 0 // alphaMask off
  const paramsBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(paramsBuf, 0, params)

  const reduced = device.createBuffer({
    size: 64 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const staging = device.createBuffer({ size: 64 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })

  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: REDUCE_WGSL }), entryPoint: 'main' },
  })
  const bg = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: tex.createView() },
      { binding: 2, resource: { buffer: reduced } },
    ],
  })
  const enc = device.createCommandEncoder()
  const pass = enc.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bg)
  pass.dispatchWorkgroups(1, 1)
  pass.end()
  enc.copyBufferToBuffer(reduced, 0, staging, 0, 64 * 4)
  device.queue.submit([enc.finish()])
  await staging.mapAsync(GPUMapMode.READ)
  const words = new Uint32Array(staging.getMappedRange().slice(0))
  staging.unmap()
  device.destroy()

  const got: number[] = []
  const want: number[] = []
  for (let i = 0; i < 64; i++) {
    got.push(words[i])
    want.push((data[i * 4] | (data[i * 4 + 1] << 8) | (data[i * 4 + 2] << 16) | (255 << 24)) >>> 0)
  }
  expect(got).toEqual(want)
})
