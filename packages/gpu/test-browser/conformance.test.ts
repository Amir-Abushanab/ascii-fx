// CPU ↔ GPU conformance (spec §36, §52): the GPU matcher must agree with the
// CPU reference on every cell — glyph ids, colors, and flags, bit-for-bit.
import { describe, expect, it } from 'vitest'
import type { AsciiFrame, ColorMode, RGB } from '@ascii-fx/core'
import { decodeProfile, matchFrame, subsetProfile } from '@ascii-fx/core'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import type { AsciiRenderer } from '@ascii-fx/gpu'
import { STANDARD_SIX, makeCell, makeProfile, randomImage, randomProfile } from '../../core/test/synthetic.js'
import profileUrl from '../../../fixtures/profiles/default.asciip?url'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator ? (await navigator.gpu.requestAdapter()) !== null : false

function expectFramesEqual(gpu: AsciiFrame, cpu: AsciiFrame, label: string): void {
  expect(gpu.columns, `${label} columns`).toBe(cpu.columns)
  expect(gpu.rows, `${label} rows`).toBe(cpu.rows)
  expect(gpu.colorMode, `${label} colorMode`).toBe(cpu.colorMode)
  expect(gpu.glyphIds, `${label} glyphIds`).toEqual(cpu.glyphIds)
  expect(gpu.flags, `${label} flags`).toEqual(cpu.flags)
  expect(gpu.foreground, `${label} foreground`).toEqual(cpu.foreground)
  expect(gpu.background, `${label} background`).toEqual(cpu.background)
}

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('conformance suite skipped — no adapter in this browser', () => {
    expect(gpuAvailable).toBe(false)
  })
})

describe.runIf(gpuAvailable)('GPU ↔ CPU conformance', () => {
  const MODES: Array<[string, ColorMode, RGB, RGB]> = [
    ['mono white-on-black', 'mono', [255, 255, 255], [0, 0, 0]],
    ['mono black-on-white', 'mono', [0, 0, 0], [255, 255, 255]],
    ['foreground dark backdrop', 'foreground', [255, 255, 255], [0, 0, 0]],
    ['foreground light backdrop', 'foreground', [255, 255, 255], [240, 240, 240]],
    ['full', 'full', [255, 255, 255], [0, 0, 0]],
  ]

  async function conform(
    renderer: AsciiRenderer,
    profile: Parameters<typeof matchFrame>[1]['profile'],
    image: Parameters<typeof matchFrame>[0],
    columns: number,
    label: string,
  ): Promise<void> {
    for (const [name, color, fg, bg] of MODES) {
      renderer.setOptions({ columns, color, foreground: fg, background: bg, alpha: 'ignore' })
      renderer.setSource(image)
      const gpuFrame = await renderer.captureFrame()
      const cpuFrame = matchFrame(image, {
        profile,
        columns,
        color,
        foreground: fg,
        background: bg,
        alpha: 'ignore',
      })
      expectFramesEqual(gpuFrame, cpuFrame, `${label} / ${name}`)
    }
  }

  it('agrees on the 6-glyph synthetic profile', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile,
      backend: 'webgpu',
    })
    expect(renderer.backend).toBe('webgpu')
    try {
      await conform(renderer, profile, randomImage(80, 48, 11), 10, 'six')
    } finally {
      renderer.destroy()
    }
  })

  it('agrees on a 40-glyph random profile', async () => {
    const profile = randomProfile(40, 7)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      await conform(renderer, profile, randomImage(80, 48, 12), 10, 'rand40')
    } finally {
      renderer.destroy()
    }
  })

  it('agrees on a 300-glyph random profile', async () => {
    const profile = randomProfile(300, 21)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      await conform(renderer, profile, randomImage(96, 56, 13), 12, 'rand300')
    } finally {
      renderer.destroy()
    }
  })

  it('agrees on a subset of the real fixture profile', async () => {
    const res = await fetch(profileUrl)
    const profile = subsetProfile(decodeProfile(new Uint8Array(await res.arrayBuffer())), ' .:-=+*#%@')
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      await conform(renderer, profile, randomImage(96, 56, 17), 12, 'subset10')
    } finally {
      renderer.destroy()
    }
  })

  it('agrees on the real Geist Mono fixture profile', async () => {
    const res = await fetch(profileUrl)
    const profile = decodeProfile(new Uint8Array(await res.arrayBuffer()))
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      await conform(renderer, profile, randomImage(192, 108, 14), 24, 'geist')
    } finally {
      renderer.destroy()
    }
  })

  it('agrees on non-divisible source dimensions (uneven reduction rects)', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      await conform(renderer, profile, randomImage(97, 61, 15), 13, 'uneven')
    } finally {
      renderer.destroy()
    }
  })

  it('agrees on flat regions and alpha masking', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      // Half flat gray, half transparent, quarter structural.
      const img = randomImage(64, 64, 16, true)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const p = (y * 64 + x) * 4
          if (x < 24) {
            img.data[p] = 128
            img.data[p + 1] = 128
            img.data[p + 2] = 128
            img.data[p + 3] = 255
          } else if (x < 40) {
            img.data[p + 3] = 0
          }
        }
      }
      for (const alpha of ['mask', 'ignore'] as const) {
        renderer.setOptions({ columns: 8, color: 'full', alpha })
        renderer.setSource(img)
        const gpuFrame = await renderer.captureFrame()
        const cpuFrame = matchFrame(img, { profile, columns: 8, color: 'full', alpha })
        expectFramesEqual(gpuFrame, cpuFrame, `alpha ${alpha}`)
      }
    } finally {
      renderer.destroy()
    }
  })

  it('is deterministic across repeated GPU runs', async () => {
    const profile = randomProfile(40, 3)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      const img = randomImage(80, 48, 17)
      renderer.setOptions({ columns: 10, color: 'full' })
      renderer.setSource(img)
      const a = await renderer.captureFrame()
      renderer.setSource(img)
      const b = await renderer.captureFrame()
      expectFramesEqual(b, a, 'determinism')
    } finally {
      renderer.destroy()
    }
  })

  it('resize is composite-only: captured frame unchanged', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const canvas = new OffscreenCanvas(64, 64)
    const renderer = await createAsciiRenderer({ canvas, profile, backend: 'webgpu' })
    try {
      renderer.setOptions({ columns: 10, color: 'full' })
      renderer.setSource(randomImage(80, 48, 18))
      const before = await renderer.captureFrame()
      renderer.resize(320, 200)
      renderer.render()
      const after = await renderer.captureFrame()
      expectFramesEqual(after, before, 'resize')
    } finally {
      renderer.destroy()
    }
  })

  it('interactions and pointer are composite-only: frame identical, no matcher dispatch', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      const img = randomImage(80, 48, 23)
      renderer.setOptions({ columns: 10, color: 'full' })
      renderer.setSource(img)
      const before = await renderer.captureFrame()
      renderer.setInteraction({ type: 'reveal', radius: 0.3, feather: 0.1 })
      renderer.pointer.set(0.4, 0.6)
      renderer.render()
      const internals = renderer as unknown as { matchDirty: boolean }
      expect(internals.matchDirty, 'pointer/interaction must not mark the matcher dirty').toBe(false)
      renderer.setInteraction({ type: 'wave', intensity: 1 })
      renderer.render()
      expect(internals.matchDirty).toBe(false)
      const after = await renderer.captureFrame()
      expectFramesEqual(after, before, 'interaction')
    } finally {
      renderer.destroy()
    }
  })

  it('temporal reuse is exact across changing sources and option flips', async () => {
    const profile = randomProfile(40, 13)
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile,
      backend: 'webgpu',
      temporal: true,
    })
    try {
      const a = randomImage(96, 56, 41)
      const b = randomImage(96, 56, 41)
      // b = a with one 16×16 block changed
      for (let y = 20; y < 36; y++) {
        for (let x = 40; x < 56; x++) {
          const p = (y * 96 + x) * 4
          b.data[p] = 255 - b.data[p]
          b.data[p + 1] = 7
        }
      }
      renderer.setOptions({ columns: 12, color: 'full' })
      for (const img of [a, b, a, b]) {
        renderer.setSource(img)
        const gpu = await renderer.captureFrame()
        const cpu = matchFrame(img, { profile, columns: 12, color: 'full' })
        expectFramesEqual(gpu, cpu, 'temporal sequence')
      }
      // option change must invalidate the temporal cache
      renderer.setOptions({ color: 'mono', foreground: [0, 0, 0], background: [255, 255, 255] })
      renderer.setSource(b)
      const gpu = await renderer.captureFrame()
      const cpu = matchFrame(b, {
        profile,
        columns: 12,
        color: 'mono',
        foreground: [0, 0, 0],
        background: [255, 255, 255],
      })
      expectFramesEqual(gpu, cpu, 'temporal after option flip')
    } finally {
      renderer.destroy()
    }
  })

  it('invalidate(rect) rematches only the region yet lands on the exact full result', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      const img = randomImage(96, 56, 51)
      renderer.setOptions({ columns: 12, color: 'full' })
      renderer.setSource(img)
      await renderer.captureFrame()
      // mutate a region in place, declare it dirty
      for (let y = 8; y < 24; y++) {
        for (let x = 16; x < 48; x++) {
          const p = (y * 96 + x) * 4
          img.data[p] = 250
          img.data[p + 1] = 20
          img.data[p + 2] = 20
        }
      }
      renderer.invalidate({ x: 16, y: 8, width: 32, height: 16 })
      const gpu = await renderer.captureFrame()
      const cpu = matchFrame(img, { profile, columns: 12, color: 'full' })
      expectFramesEqual(gpu, cpu, 'invalidate rect')
    } finally {
      renderer.destroy()
    }
  })

  it('adaptiveResolution leaves the grid at baseline without frame pressure', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const renderer = await createAsciiRenderer({
      canvas: new OffscreenCanvas(64, 64),
      profile,
      backend: 'webgpu',
      adaptiveResolution: true,
    })
    try {
      renderer.setOptions({ columns: 16, color: 'mono' })
      renderer.setSource(randomImage(128, 72, 61))
      for (let i = 0; i < 5; i++) renderer.render()
      expect(renderer.grid()).toEqual({ columns: 16, rows: 9 })
    } finally {
      renderer.destroy()
    }
  })

  it('runtime canvas profiles power zero-config rendering (spec §14/§41)', async () => {
    const { createAsciiProfile } = await import('@ascii-fx/core')
    const profile = await createAsciiProfile({ fontFamily: 'monospace' })
    expect(profile.glyphCount).toBe(95)
    expect(profile.glyphs[0]).toBe(' ')
    expect(profile.structural.coverage[0]).toBe(0)
    expect(profile.atlas.cellHeight).toBe(64)
    const again = await createAsciiProfile({ fontFamily: 'monospace' })
    expect(again).toBe(profile) // session cache (spec §41)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'webgpu' })
    try {
      renderer.setOptions({ columns: 12, color: 'full' })
      const img = randomImage(96, 56, 71)
      renderer.setSource(img)
      const gpu = await renderer.captureFrame()
      const cpu = matchFrame(img, { profile, columns: 12, color: 'full' })
      expectFramesEqual(gpu, cpu, 'runtime profile')
    } finally {
      renderer.destroy()
    }
  })

  it("'auto' falls back to the exact CPU backend when the GPU path refuses (spec §11)", async () => {
    // 2100 glyphs exceeds the GPU matcher's workgroup-memory bound; 'auto'
    // must land on the CPU backend with a still-usable canvas.
    const profile = randomProfile(2100, 77)
    const canvas = new OffscreenCanvas(64, 64)
    const renderer = await createAsciiRenderer({ canvas, profile, backend: 'auto' })
    try {
      expect(renderer.backend).toBe('cpu')
      renderer.setOptions({ columns: 8, color: 'mono' })
      renderer.setSource(randomImage(64, 64, 78))
      renderer.render()
      const frame = await renderer.captureFrame()
      expect(frame.columns).toBe(8)
      expect(frame.toText().length).toBeGreaterThan(0)
      const cpu = matchFrame(randomImage(64, 64, 78), { profile, columns: 8, color: 'mono' })
      expect(frame.glyphIds).toEqual(cpu.glyphIds)
    } finally {
      renderer.destroy()
    }
  })

  it('switching backends on one canvas fails loudly with the context-lock explanation', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const canvas = new OffscreenCanvas(64, 64)
    const first = await createAsciiRenderer({ canvas, profile, backend: 'webgpu' })
    first.destroy()
    // The canvas is now permanently a 'webgpu' canvas — the CPU backend must
    // explain that instead of silently freezing (the old failure mode).
    await expect(createAsciiRenderer({ canvas, profile, backend: 'cpu' })).rejects.toThrow(
      /first context type|fresh <canvas>/,
    )
  })

  it('cpu backend serves the same API for parity', async () => {
    const profile = makeProfile(STANDARD_SIX)
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(64, 64), profile, backend: 'cpu' })
    try {
      expect(renderer.backend).toBe('cpu')
      const img = makeCell((_, j) => (j < 4 ? [0, 0, 0] : [255, 255, 255]))
      renderer.setOptions({ columns: 1, rows: 1, color: 'mono' })
      renderer.setSource(img)
      renderer.render()
      const frame = await renderer.captureFrame()
      expect(frame.toText()).toBe('▄')
    } finally {
      renderer.destroy()
    }
  })

  it('informational: GPU match wall-time at 160 columns (Geist profile)', async () => {
    const res = await fetch(profileUrl)
    const profile = decodeProfile(new Uint8Array(await res.arrayBuffer()))
    const renderer = await createAsciiRenderer({ canvas: new OffscreenCanvas(256, 144), profile, backend: 'webgpu' })
    try {
      const img = randomImage(1280, 720, 19)
      renderer.setOptions({ columns: 160, color: 'full' })
      renderer.setSource(img)
      await renderer.captureFrame() // warm
      const runs = 20
      const t0 = performance.now()
      for (let i = 0; i < runs; i++) {
        renderer.setSource(img) // marks source dirty → full re-match
        await renderer.captureFrame()
      }
      const ms = (performance.now() - t0) / runs
      const grid = renderer.grid()!
      // eslint-disable-next-line no-console
      console.log(`[gpu-bench] ${grid.columns}×${grid.rows} full re-match+readback: ${ms.toFixed(2)}ms avg`)
      expect(ms).toBeGreaterThan(0)
    } finally {
      renderer.destroy()
    }
  })
})
