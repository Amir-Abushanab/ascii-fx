// AsciiPass conformance: match Three's render target through the GPU pipeline
// and compare with the CPU reference over the same pixels. The scene uses only
// pure 0/1 channel colors so linear→sRGB encoding is exact at both ends.
import { describe, expect, it } from 'vitest'
import { matchFrame } from '@ascii-fx/core'

const gpuAvailable =
  typeof navigator !== 'undefined' && 'gpu' in navigator
    ? (await navigator.gpu.requestAdapter()) !== null
    : false

describe.runIf(gpuAvailable)('AsciiPass (three WebGPURenderer)', () => {
  it('matches the render target exactly against the CPU reference', async () => {
    const THREE = await import('three/webgpu')
    const { AsciiPass } = await import('@ascii-fx/three')
    const { makeProfile, STANDARD_SIX } = await import('../../core/test/synthetic.js')

    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false })
    await renderer.init()
    renderer.setSize(128, 128, false)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0, 0, 0)
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 1
    const quad = (x: number, y: number, w: number, h: number, color: number): void => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color }),
      )
      mesh.position.set(x, y, -1)
      scene.add(mesh)
    }
    quad(-0.4, 0.3, 0.9, 0.8, 0xffffff)
    quad(0.5, -0.2, 0.7, 1.0, 0xff0000)
    quad(0.1, 0.6, 1.2, 0.4, 0x00ff00)

    const profile = makeProfile(STANDARD_SIX)
    const pass = new AsciiPass({
      profile,
      renderer,
      width: 96,
      height: 64,
      columns: 12,
      color: 'full',
    })
    await pass.init()
    pass.render(scene, camera)
    const gpuFrame = await pass.captureFrame()

    const raw = (await renderer.readRenderTargetPixelsAsync(
      pass.renderTarget,
      0,
      0,
      96,
      64,
    )) as Uint8Array
    // Some three versions return WebGPU-padded rows (bytesPerRow aligned to 256).
    const tightRow = 96 * 4
    const paddedRow = Math.ceil(tightRow / 256) * 256
    let pixels: Uint8Array
    if (raw.length === 96 * 64 * 4) {
      pixels = raw
    } else if (raw.length === (64 - 1) * paddedRow + tightRow || raw.length === 64 * paddedRow) {
      pixels = new Uint8Array(96 * 64 * 4)
      for (let y = 0; y < 64; y++) {
        pixels.set(raw.subarray(y * paddedRow, y * paddedRow + tightRow), y * tightRow)
      }
    } else {
      throw new Error(`unexpected readRenderTargetPixelsAsync length ${raw.length}`)
    }

    const cpuOf = (data: Uint8Array): ReturnType<typeof matchFrame> =>
      matchFrame(
        { width: 96, height: 64, data },
        { profile, columns: 12, color: 'full', alpha: 'ignore' },
      )

    // The scene, rasterized by hand: axis-aligned quads under an orthographic camera cover
    // a pixel exactly when its centre is inside, later quads over earlier ones. This is the
    // reference when three cannot read its own target back (r170 returns zeros), and a
    // check on the readback when it can.
    const drawn = new Uint8Array(96 * 64 * 4)
    for (let i = 3; i < drawn.length; i += 4) drawn[i] = 255
    const rasterize = (x: number, y: number, w: number, h: number, rgb: number[]): void => {
      for (let py = 0; py < 64; py++) {
        for (let px = 0; px < 96; px++) {
          const wx = ((px + 0.5) / 96) * 2 - 1
          const wy = 1 - ((py + 0.5) / 64) * 2
          if (wx < x - w / 2 || wx >= x + w / 2 || wy <= y - h / 2 || wy > y + h / 2) continue
          drawn.set(rgb, (py * 96 + px) * 4)
        }
      }
    }
    rasterize(-0.4, 0.3, 0.9, 0.8, [255, 255, 255])
    rasterize(0.5, -0.2, 0.7, 1.0, [255, 0, 0])
    rasterize(0.1, 0.6, 1.2, 0.4, [0, 255, 0])

    let cpuFrame = cpuOf(drawn)
    if (pixels.some((v, i) => i % 4 !== 3 && v !== 0)) {
      let read = cpuOf(pixels)
      if (!read.glyphIds.every((v, i) => v === gpuFrame.glyphIds[i])) {
        // readRenderTargetPixelsAsync row order differs across three versions; try flipped.
        const flipped = new Uint8Array(pixels.length)
        for (let y = 0; y < 64; y++) {
          flipped.set(pixels.subarray(y * 96 * 4, (y + 1) * 96 * 4), (63 - y) * 96 * 4)
        }
        read = cpuOf(flipped)
      }
      // The two references have to agree before either is worth comparing against.
      expect(read.glyphIds).toEqual(cpuFrame.glyphIds)
      cpuFrame = read
    }

    expect(gpuFrame.glyphIds).toEqual(cpuFrame.glyphIds)
    expect(gpuFrame.foreground).toEqual(cpuFrame.foreground)
    expect(gpuFrame.background).toEqual(cpuFrame.background)
    expect(gpuFrame.flags).toEqual(cpuFrame.flags)

    pass.dispose()
    renderer.dispose()
  })

  // Rendered into a plain render target, three skips its output pass: no tone mapping, and
  // linear values in an 8-bit texture. As the *output* target the scene arrives as the
  // canvas would have shown it.
  it("applies the renderer's tone mapping, and follows its size", async () => {
    const THREE = await import('three/webgpu')
    const { AsciiPass } = await import('@ascii-fx/three')
    const { makeProfile, STANDARD_SIX } = await import('../../core/test/synthetic.js')

    const canvas = document.createElement('canvas')
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false })
    renderer.setSize(96, 64, false)
    renderer.toneMapping = THREE.ReinhardToneMapping

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 1
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    )
    mesh.position.z = -1
    scene.add(mesh)

    const pass = new AsciiPass({
      profile: makeProfile(STANDARD_SIX),
      renderer,
      columns: 12,
      color: 'full',
    })
    // No renderer.init() here: the pass does it.
    await pass.init()
    pass.render(scene, camera)
    const frame = await pass.captureFrame()
    // Reinhard maps white to 0.5 linear, which is 188 in sRGB. Without the output pass
    // this is 255 — which is what a three older than r178 gives, where the pass renders
    // straight into its target. This suite runs against more than one three (see the README).
    const level = frame.foreground![0] & 0xff
    if (Number(THREE.REVISION) >= 178) {
      expect(level).toBeGreaterThan(178)
      expect(level).toBeLessThan(198)
    } else {
      expect(level).toBe(255)
    }

    expect([pass.renderTarget.width, pass.renderTarget.height]).toEqual([96, 64])
    renderer.setSize(128, 32, false)
    pass.render(scene, camera)
    expect([pass.renderTarget.width, pass.renderTarget.height]).toEqual([128, 32])
    // Pinned sizes stay pinned.
    pass.setSize(48, 48)
    renderer.setSize(96, 64, false)
    pass.render(scene, camera)
    expect([pass.renderTarget.width, pass.renderTarget.height]).toEqual([48, 48])

    pass.dispose()
    renderer.dispose()
  })

  it('AsciiGlyphs builds an instanced grid from a frame', async () => {
    const { AsciiGlyphs } = await import('@ascii-fx/three')
    const { makeProfile, STANDARD_SIX, makeCell } = await import('../../core/test/synthetic.js')
    const profile = makeProfile(STANDARD_SIX)
    const frame = matchFrame(
      makeCell((_, j) => (j < 4 ? [10, 10, 10] : [240, 240, 240])),
      { profile, columns: 1, rows: 1, color: 'full' },
    )
    const glyphs = new AsciiGlyphs({ profile, columns: 1, rows: 1 })
    glyphs.updateFromFrame(frame)
    expect(glyphs.mesh.count).toBe(1)
    const aGlyph = glyphs.mesh.geometry.getAttribute('aGlyph')
    expect(aGlyph.getX(0)).toBe(2) // '▀'
    expect(() => glyphs.updateFromFrame({ ...frame, columns: 2 } as never)).toThrow(/grid/)
    glyphs.dispose()
  })
})

describe.skipIf(gpuAvailable)('WebGPU unavailable', () => {
  it('AsciiPass suite skipped — no adapter', () => {
    expect(gpuAvailable).toBe(false)
  })
})
