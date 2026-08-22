import { expect, it } from 'vitest'
import { matchFrame } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeCell, makeProfile } from '../../core/test/synthetic.js'

async function readBuffer(device: GPUDevice, buf: GPUBuffer, bytes: number): Promise<Uint32Array> {
  const staging = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  const enc = device.createCommandEncoder()
  enc.copyBufferToBuffer(buf, 0, staging, 0, bytes)
  device.queue.submit([enc.finish()])
  await staging.mapAsync(GPUMapMode.READ)
  const out = new Uint32Array(staging.getMappedRange().slice(0))
  staging.unmap()
  staging.destroy()
  return out
}

it('renderer stages: reduce → features → cells on a single cell', async () => {
  if (!('gpu' in navigator) || !(await navigator.gpu.requestAdapter())) return
  const profile = makeProfile(STANDARD_SIX)
  const img = makeCell((_, j) => (j < 4 ? [10, 10, 10] : [240, 240, 240]))
  const renderer = await createAsciiRenderer({
    canvas: new OffscreenCanvas(64, 64),
    profile,
    backend: 'webgpu',
  })
  const errors: string[] = []
  ;(renderer as unknown as { device: GPUDevice }).device.onuncapturederror = (e) => {
    errors.push(e.error.message)
    console.log('[uncaptured]', e.error.message.slice(0, 500))
  }
  try {
    renderer.setOptions({ columns: 1, rows: 1, color: 'full', alpha: 'ignore' })
    renderer.setSource(img)
    const gpuFrame = await renderer.captureFrame()
    const cpuFrame = matchFrame(img, {
      profile,
      columns: 1,
      rows: 1,
      color: 'full',
      alpha: 'ignore',
    })

    const internals = renderer as unknown as {
      device: GPUDevice
      stream: { reducedBuf: GPUBuffer; featuresBuf: GPUBuffer; cellsBuf: GPUBuffer }
    }
    const reduced = await readBuffer(internals.device, internals.stream.reducedBuf, 64 * 4)
    const features = await readBuffer(internals.device, internals.stream.featuresBuf, 16)
    const cells = await readBuffer(internals.device, internals.stream.cellsBuf, 16)
    console.log(
      `[dbg] reduced[0..3]=${Array.from(reduced.slice(0, 4))
        .map((w) => w.toString(16))
        .join(',')} reduced[32]=${reduced[32].toString(16)}\n` +
        `[dbg] features=${Array.from(features)
          .map((w) => w.toString(16))
          .join(',')}\n` +
        `[dbg] cells=${Array.from(cells)
          .map((w) => w.toString(16))
          .join(',')}\n` +
        `[dbg] gpu glyph=${gpuFrame.glyphIds[0]} cpu glyph=${cpuFrame.glyphIds[0]}`,
    )
    expect(gpuFrame.glyphIds).toEqual(cpuFrame.glyphIds)
    expect(gpuFrame.foreground).toEqual(cpuFrame.foreground)
    expect(gpuFrame.background).toEqual(cpuFrame.background)
  } finally {
    renderer.destroy()
  }
})
