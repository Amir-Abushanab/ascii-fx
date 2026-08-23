// Render the README's visuals with the library itself, so what the page shows is real
// output rather than a screenshot that can drift from the code.
//
// The animated source is procedural, so this is deterministic: same commit, same frames,
// byte-for-byte. Regenerate with `pnpm assets` after anything that changes the matcher.
//
// Pipeline per frame: procedural RGBA source → matchFrame (the exact CPU matcher, the
// same oracle the GPU path is held to) → compositeFrame (glyphs drawn back out to RGBA)
// → PNG → ffmpeg. No browser and no GPU involved.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { buildProfile } from '@ascii-fx/compiler'
import { compositeFrame, matchFrame } from '@ascii-fx/core'

const repo = new URL('..', import.meta.url)
const assets = fileURLToPath(new URL('assets/', repo))
const tmp = fileURLToPath(new URL('.assets-frames/', repo))

const WIDTH = 1200
const HEIGHT = 500
const COLUMNS = 110
const FRAMES = Number(process.env.FRAMES ?? 32)
const FPS = 16
const BACKDROP = [10, 10, 14]
// The atlas cell is 30px, so a 110-column composite is 3300px wide — far more than a
// README renders. Downscale at encode time; anything above ~12px per cell is wasted bytes.
const OUT_WIDTH = 1000

/**
 * Three drifting light sources with ring interference over a dark ground.
 *
 * The rings matter: a purely smooth gradient is best reconstructed by a *solid* cell, so
 * the matcher correctly emits near-blank glyphs and the output reads as a blur. Structure
 * at the cell scale is what gives it edges to match, which is what the glyphs are for.
 */
function sourceFrame(t) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4)
  const phase = t * 2 * Math.PI
  const orbs = [
    { x: 0.22 + 0.1 * Math.cos(phase), y: 0.46 + 0.18 * Math.sin(phase), c: [255, 70, 96] },
    {
      x: 0.5 + 0.12 * Math.cos(phase + 2.1),
      y: 0.54 + 0.16 * Math.sin(phase + 2.1),
      c: [58, 240, 140],
    },
    {
      x: 0.78 + 0.1 * Math.cos(phase + 4.2),
      y: 0.44 + 0.18 * Math.sin(phase + 4.2),
      c: [88, 150, 255],
    },
  ]
  for (let y = 0; y < HEIGHT; y++) {
    const v = y / (HEIGHT - 1)
    for (let x = 0; x < WIDTH; x++) {
      const u = x / (WIDTH - 1)
      let r = 8
      let g = 9
      let b = 14
      for (const o of orbs) {
        const d = Math.hypot((u - o.x) * 1.9, v - o.y)
        // Falloff sets the envelope; the ring term carves it into bands the matcher can
        // actually find an edge in.
        const fall = Math.max(0, 1 - d / 0.62)
        const ring = 0.5 + 0.5 * Math.sin(d * 40 - phase * 2)
        const w = 1.7 * fall * (0.45 + 0.55 * ring)
        r += o.c[0] * w
        g += o.c[1] * w
        b += o.c[2] * w
      }
      const p = (y * WIDTH + x) * 4
      data[p] = Math.min(255, r)
      data[p + 1] = Math.min(255, g)
      data[p + 2] = Math.min(255, b)
      data[p + 3] = 255
    }
  }
  return { width: WIDTH, height: HEIGHT, data }
}

function writePng(path, image) {
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length)
  writeFileSync(path, PNG.sync.write(png))
}

// ffmpeg is a system tool, not an npm dependency (knip is told so in knip.json). Fail
// here with something actionable rather than at the encode step with a spawn ENOENT.
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
} catch {
  console.error('render-assets needs ffmpeg on PATH (brew install ffmpeg).')
  process.exit(1)
}

const font = new Uint8Array(
  readFileSync(fileURLToPath(new URL('fixtures/fonts/GeistMono-Regular.ttf', repo))),
)
const { profile } = buildProfile({ font })

mkdirSync(assets, { recursive: true })
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

console.log(`rendering ${FRAMES} frames at ${COLUMNS} columns…`)
for (let i = 0; i < FRAMES; i++) {
  const frame = matchFrame(sourceFrame(i / FRAMES), {
    profile,
    columns: COLUMNS,
    // 'foreground' keeps the backdrop fixed and fits only the ink colour. 'full' would fit
    // the background per cell too, and on smooth content fg converges on bg — every cell
    // becomes a solid block and the glyphs disappear. Correct reconstruction, unreadable art.
    color: 'foreground',
    background: BACKDROP,
    flatThreshold: 15,
  })
  const rgba = compositeFrame(frame, { background: BACKDROP })
  writePng(`${tmp}/frame-${String(i).padStart(3, '0')}.png`, rgba)
  // The still is the midpoint frame, so the hero image and the loop agree.
  if (i === Math.floor(FRAMES / 2)) writePng(`${assets}/hero.png`, rgba)
}

// A shared palette across all frames, so the loop does not shimmer between per-frame
// palettes — the glyphs are already high-contrast, and per-frame quantisation is visible.
console.log('encoding hero.gif…')
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    `${tmp}/frame-%03d.png`,
    '-filter_complex',
    `[0:v]scale=${OUT_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none`,
    '-loop',
    '0',
    `${assets}/hero.gif`,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

console.log('scaling hero.png…')
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-i',
    `${assets}/hero.png`,
    '-vf',
    `scale=${OUT_WIDTH}:-1:flags=lanczos`,
    `${assets}/hero-scaled.png`,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)
renameSync(`${assets}/hero-scaled.png`, `${assets}/hero.png`)

rmSync(tmp, { recursive: true, force: true })
console.log(`wrote ${assets}hero.gif and ${assets}hero.png`)
