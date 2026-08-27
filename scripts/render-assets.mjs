// Render the README's visuals with the library itself, so what the page shows is real
// output rather than a screenshot that can drift from the code.
//
// The source is the playground's own 3D scene, imported rather than reimplemented: the
// README hero and the "3D solids" preset are the same rasterizer, so they cannot drift
// apart either. It is a pure function of t, so this is deterministic — same commit, same
// frames, byte for byte. Regenerate with `pnpm assets` after anything that changes the
// matcher or the scene.
//
// Pipeline per frame: procedural RGBA source → matchFrame (the exact CPU matcher, the
// same oracle the GPU path is held to) → compositeFrame (glyphs drawn back out to RGBA)
// → PNG → ffmpeg (downscale) → img2webp (animate). No browser and no GPU involved.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { buildProfile } from '@ascii-fx/compiler'
import { compositeFrame, matchFrame } from '@ascii-fx/core'
import { LOOP_SECONDS, createSolids3D } from '../apps/docs/src/playground/solids3d.ts'

const repo = new URL('..', import.meta.url)
const assets = fileURLToPath(new URL('assets/', repo))
const tmp = fileURLToPath(new URL('.assets-frames/', repo))

const WIDTH = 1200
// 1.9:1. The scene's own extent is about 1.3:1, so a wider banner than this would be
// margin rather than picture; here it reaches 85% of the width and 98% of the height.
const HEIGHT = 630
const COLUMNS = 76
// The scene closes exactly on its loop, so the clip has to be exactly that long — a
// shorter cut leaves a jump at the seam, a longer one repeats. Frames follow from the
// rate, which is the only free number here.
const FPS = Number(process.env.FPS ?? 12)
const FRAMES = Math.round(LOOP_SECONDS * FPS)
// Paper colour. The scene's own backdrop runs from about (5,6,13) in the corners to
// (29,28,41) under the glow, so this sits inside its range rather than punching a
// different black through every flat cell.
const BACKDROP = [8, 9, 16]
// The atlas cell is 30px, so a 90-column composite is 2700px wide — far more than a README
// renders. Downscale at encode time; at this width a glyph lands on ~9px, which is about
// where its shape stops being legible, and the file is a third the size it is at 1100.
const OUT_WIDTH = 800
// Colours in the palette every frame shares. Past ~48 the file stops shrinking and the
// picture stops improving; the composite only ever holds a fitted ink colour per cell over
// one flat paper colour, so it was never using many.
const PALETTE = 48

function writePng(path, image) {
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length)
  writeFileSync(path, PNG.sync.write(png))
}

// ffmpeg downscales and img2webp animates; both are system tools, not npm dependencies
// (knip is told so in knip.json). Fail here with something actionable rather than at the
// encode step with a spawn ENOENT.
for (const [bin, hint] of [
  ['ffmpeg', 'brew install ffmpeg'],
  ['img2webp', 'brew install webp'],
]) {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' })
  } catch {
    console.error(`render-assets needs ${bin} on PATH (${hint}).`)
    process.exit(1)
  }
}

const font = new Uint8Array(
  readFileSync(fileURLToPath(new URL('fixtures/fonts/GeistMono-Regular.ttf', repo))),
)
const { profile } = buildProfile({ font })

mkdirSync(assets, { recursive: true })
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

const scene = createSolids3D(WIDTH, HEIGHT)
const source = { width: WIDTH, height: HEIGHT, data: scene.rgba }

console.log(`rendering ${FRAMES} frames at ${COLUMNS} columns (${LOOP_SECONDS}s loop)…`)
for (let i = 0; i < FRAMES; i++) {
  scene.render((i / FRAMES) * LOOP_SECONDS)
  const frame = matchFrame(source, {
    profile,
    columns: COLUMNS,
    // 'foreground' keeps the backdrop fixed and fits only the ink colour. 'full' would fit
    // the background per cell too, and on smooth content fg converges on bg — every cell
    // becomes a solid block and the glyphs disappear. Correct reconstruction, unreadable art.
    color: 'foreground',
    background: BACKDROP,
    flatThreshold: 15,
  })
  writePng(
    `${tmp}/frame-${String(i).padStart(3, '0')}.png`,
    compositeFrame(frame, {
      background: BACKDROP,
    }),
  )
}

// Downscale, then quantise to one palette shared by every frame. The palette is what
// makes the file affordable: a lanczos downscale turns each two-colour glyph cell into a
// smear of unique antialiased colours, and lossless WebP then has to store all of them —
// 76 KB a frame against 19 KB quantised. `stats_mode=diff` weights the palette toward
// what moves, and `dither=none` keeps the glyph strokes flat instead of stippling them.
console.log(`downscaling to ${OUT_WIDTH}px and quantising to ${PALETTE} colours…`)
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-i',
    `${tmp}/frame-%03d.png`,
    '-filter_complex',
    `[0:v]scale=${OUT_WIDTH}:-1:flags=lanczos,split[a][b];` +
      `[a]palettegen=max_colors=${PALETTE}:stats_mode=diff[p];[b][p]paletteuse=dither=none`,
    '-start_number',
    '0',
    `${tmp}/small-%03d.png`,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

// Lossless, because this is line art: every glyph is a thin high-contrast stroke on a
// flat ground, which is the exact content lossy WebP rings around. On the quantised
// frames it is also the smaller of the two. `-min_size` drops key frames and searches per
// frame, so the static backdrop is only paid for once.
console.log('encoding hero.webp…')
execFileSync(
  'img2webp',
  [
    '-loop',
    '0',
    '-min_size',
    '-d',
    String(Math.round(1000 / FPS)),
    '-lossless',
    '-m',
    '6',
    ...Array.from({ length: FRAMES }, (_, i) => `${tmp}/small-${String(i).padStart(3, '0')}.png`),
    '-o',
    `${assets}/hero.webp`,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

// The still is the midpoint frame, so the hero image and the loop agree — but taken from
// full colour, since a single frame has no palette to amortise.
console.log('scaling hero.png…')
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-i',
    `${tmp}/frame-${String(Math.floor(FRAMES / 2)).padStart(3, '0')}.png`,
    '-vf',
    `scale=${OUT_WIDTH}:-1:flags=lanczos`,
    `${assets}/hero.png`,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

rmSync(tmp, { recursive: true, force: true })
console.log(`wrote ${assets}hero.webp and ${assets}hero.png`)
