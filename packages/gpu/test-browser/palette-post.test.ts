// palette-v1 on the GPU against core's quantizeFrame, bit for bit, and the post stage as a
// smoke test: every effect has to compile, run without a GPU error, and change the picture.
import { describe, expect, it } from 'vitest'
import type { ColorMode, DitherKind, RGB } from '@ascii-fx/core'
import { decodeProfile, matchFrame, quantizeFrame } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import type { AsciiRenderer, PostOptions } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeProfile, randomImage } from '../../core/test/synthetic.js'
import profileUrl from '../../../fixtures/profiles/default.asciip?url'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

const PICO8: RGB[] = [
  [0, 0, 0],
  [29, 43, 83],
  [126, 37, 83],
  [0, 135, 81],
  [171, 82, 54],
  [95, 87, 79],
  [194, 195, 199],
  [255, 241, 232],
  [255, 0, 77],
  [255, 163, 0],
  [255, 236, 39],
  [0, 228, 54],
  [41, 173, 255],
  [131, 118, 156],
  [255, 119, 168],
  [255, 204, 170],
]

const deviceOf = (r: AsciiRenderer): GPUDevice => (r as unknown as { device: GPUDevice }).device

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('palette/post suite skipped — no adapter in this browser', () => {
    expect(gpuAvailable).toBe(false)
  })
})

describe.runIf(gpuAvailable)('palette-v1 on the GPU', () => {
  it('captureFrame matches core quantizeFrame for every mode and dither', async () => {
    const profile = decodeProfile(new Uint8Array(await (await fetch(profileUrl)).arrayBuffer()))
    const image = randomImage(331, 197, 11)
    const errors: GPUError[] = []
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(256, 160),
      profile,
      backend: 'webgpu',
      onError: (e) => errors.push(e),
    })
    try {
      renderer.setSource(image)
      const dithers: DitherKind[] = ['none', 'bayer2', 'bayer4', 'bayer8']
      for (const color of ['foreground', 'full'] as ColorMode[]) {
        for (const dither of dithers) {
          for (const colors of [PICO8, PICO8.slice(0, 2), [[200, 10, 10] as RGB]]) {
            const palette = { colors, dither, spread: 96 }
            renderer.setOptions({ columns: 37, color, alpha: 'ignore', palette })
            const gpu = await renderer.captureFrame()
            const cpu = quantizeFrame(
              matchFrame(image, { profile, columns: 37, color, alpha: 'ignore' }),
              palette,
            )
            const label = `${color} / ${dither} / ${colors.length} colours`
            expect(gpu.glyphIds, label).toEqual(cpu.glyphIds)
            expect(gpu.foreground, label).toEqual(cpu.foreground)
            expect(gpu.background, label).toEqual(cpu.background)
          }
        }
      }
      // Turning it off restores the matcher's own colours.
      renderer.setOptions({ palette: null })
      const plain = await renderer.captureFrame()
      expect(plain.foreground).toEqual(
        matchFrame(image, { profile, columns: 37, color: 'full', alpha: 'ignore' }).foreground,
      )
      expect(errors).toEqual([])
    } finally {
      renderer.destroy()
    }
  })

  it('every post effect runs clean and changes the picture', async () => {
    const image = randomImage(160, 96, 5)
    const read = async (post: PostOptions | null, color: ColorMode): Promise<Uint8ClampedArray> => {
      const canvas = new OffscreenCanvas(320, 192)
      const errors: GPUError[] = []
      const renderer = await createAsciiRenderer({
        canvas,
        profile: makeProfile(STANDARD_SIX),
        backend: 'webgpu',
        columns: 20,
        color,
        post,
        onError: (e) => errors.push(e),
      })
      try {
        renderer.setSource(image)
        renderer.render()
        await deviceOf(renderer).queue.onSubmittedWorkDone()
        const probe = new OffscreenCanvas(320, 192)
        const ctx = probe.getContext('2d')!
        ctx.drawImage(canvas, 0, 0)
        expect(errors).toEqual([])
        return ctx.getImageData(0, 0, 320, 192).data
      } finally {
        renderer.destroy()
      }
    }
    for (const color of ['mono', 'full'] as ColorMode[]) {
      const base = await read(null, color)
      for (const effect of [
        'scanlines',
        'vignette',
        'curvature',
        'aberration',
        'bloom',
        'grain',
      ] as const) {
        const withFx = await read({ [effect]: 1 }, color)
        let diff = 0
        for (let i = 0; i < base.length; i++) diff += Math.abs(base[i] - withFx[i])
        expect(diff, `${color} / ${effect}`).toBeGreaterThan(0)
      }
    }
  })
})
