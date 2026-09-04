// Render the README's and the social card's visuals with the library itself, so what the
// page shows is real output rather than a screenshot that can drift from the code.
//
// The source is the playground's own 3D scene, imported rather than reimplemented: the
// README hero and the "3D solids" preset are the same rasterizer, so they cannot drift
// apart either. It is a pure function of t, so this is deterministic — same commit, same
// frames, byte for byte. Regenerate with `pnpm assets` after anything that changes the
// matcher or the scene; `pnpm assets og` redoes just the card, which is seconds rather
// than the hero loop's minute.
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
import { createTextRaster } from './textRaster.mjs'

const repo = new URL('..', import.meta.url)
const assets = fileURLToPath(new URL('assets/', repo))
const tmp = fileURLToPath(new URL('.assets-frames/', repo))

// `pnpm assets` does everything; `pnpm assets og` or `pnpm assets hero` does one.
const asked = process.argv.slice(2)
const wants = (target) => asked.length === 0 || asked.includes(target)
const unknown = asked.filter((a) => a !== 'hero' && a !== 'og')
if (unknown.length > 0) {
  console.error(`render-assets: unknown target(s) ${unknown.join(', ')} — expected hero or og.`)
  process.exit(1)
}

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

function readPng(path) {
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) }
}

const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })

// ffmpeg downscales and img2webp animates; both are system tools, not npm dependencies
// (knip is told so in knip.json). Fail here with something actionable rather than at the
// encode step with a spawn ENOENT. img2webp is the hero's alone, so `og` does not need it.
for (const [bin, hint, needed] of [
  ['ffmpeg', 'brew install ffmpeg', true],
  ['img2webp', 'brew install webp', wants('hero')],
]) {
  if (!needed) continue
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

/** The one matcher setting every asset here is rendered at. */
const matchOptions = (columns) => ({
  profile,
  columns,
  // 'foreground' keeps the backdrop fixed and fits only the ink colour. 'full' would fit
  // the background per cell too, and on smooth content fg converges on bg — every cell
  // becomes a solid block and the glyphs disappear. Correct reconstruction, unreadable art.
  color: 'foreground',
  background: BACKDROP,
  flatThreshold: 15,
})

if (wants('hero')) {
  const scene = createSolids3D(WIDTH, HEIGHT)
  const source = { width: WIDTH, height: HEIGHT, data: scene.rgba }

  console.log(`rendering ${FRAMES} frames at ${COLUMNS} columns (${LOOP_SECONDS}s loop)…`)
  for (let i = 0; i < FRAMES; i++) {
    scene.render((i / FRAMES) * LOOP_SECONDS)
    writePng(
      `${tmp}/frame-${String(i).padStart(3, '0')}.png`,
      compositeFrame(matchFrame(source, matchOptions(COLUMNS)), { background: BACKDROP }),
    )
  }

  // Downscale, then quantise to one palette shared by every frame. The palette is what
  // makes the file affordable: a lanczos downscale turns each two-colour glyph cell into a
  // smear of unique antialiased colours, and lossless WebP then has to store all of them —
  // 76 KB a frame against 19 KB quantised. `stats_mode=diff` weights the palette toward
  // what moves, and `dither=none` keeps the glyph strokes flat instead of stippling them.
  console.log(`downscaling to ${OUT_WIDTH}px and quantising to ${PALETTE} colours…`)
  ffmpeg([
    '-i',
    `${tmp}/frame-%03d.png`,
    '-filter_complex',
    `[0:v]scale=${OUT_WIDTH}:-1:flags=lanczos,split[a][b];` +
      `[a]palettegen=max_colors=${PALETTE}:stats_mode=diff[p];[b][p]paletteuse=dither=none`,
    '-start_number',
    '0',
    `${tmp}/small-%03d.png`,
  ])

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
  ffmpeg([
    '-i',
    `${tmp}/frame-${String(Math.floor(FRAMES / 2)).padStart(3, '0')}.png`,
    '-vf',
    `scale=${OUT_WIDTH}:-1:flags=lanczos`,
    `${assets}/hero.png`,
  ])
  console.log(`wrote ${assets}hero.webp and ${assets}hero.png`)
}

// ── The social card ────────────────────────────────────────────────────────────────────
//
// One image serves both jobs: GitHub's repository social preview (Settings → Social
// preview, which wants 1280×640 and is uploaded by hand) and the site's og:image, which
// apps/docs/prep.mjs copies into public/. Everything crawlers show it at is smaller than
// it is, so the card is built for the 600px-wide render a feed actually gives it: few
// enough columns that a glyph is still a glyph there, and type sized off cap height.
const CARD_W = 1280
const CARD_H = 640
// The scene is rendered wider than the card and cropped from the left, which slides the
// solids — and the backdrop glow centred with them — off to the right, clear of the copy.
const CARD_SRC_W = 1520
const CARD_COLUMNS = 96
// Where in the loop the solids read best against a left-hand column of text: they have
// gathered into one mass on the right rather than strung out across the whole frame, and
// nothing has drifted under the type.
const CARD_T = 6.6
// The paper-coloured scrim: full strength out to SCRIM_HOLD, then eased away to nothing by
// SCRIM_END. It holds rather than ramping from x=0 because the copy runs to about x=640
// and a linear ramp is already half spent by then. SCRIM_MAX is not 1 — a ghost of the
// glyph texture under the type is the whole point of setting it on the picture rather than
// on a panel — and the eased tail lands on the left flank of the solids, so they read as
// emerging from the dark instead of starting at a line.
const SCRIM_HOLD = 560
const SCRIM_END = 960
const SCRIM_MAX = 0.9
const CARD_PALETTE = 256
const INK = {
  accent: [69, 232, 69],
  text: [214, 214, 222],
  muted: [138, 138, 153],
  rule: [43, 60, 48],
}

if (wants('og')) {
  console.log(`rendering og.png at ${CARD_COLUMNS} columns…`)
  const scene = createSolids3D(CARD_SRC_W, CARD_H)
  scene.render(CARD_T)
  // Crop to the card's aspect before matching, so the grid is derived from what is kept.
  const cropped = new Uint8ClampedArray(CARD_W * CARD_H * 4)
  for (let y = 0; y < CARD_H; y++) {
    cropped.set(
      scene.rgba.subarray(y * CARD_SRC_W * 4, y * CARD_SRC_W * 4 + CARD_W * 4),
      y * CARD_W * 4,
    )
  }
  const frame = matchFrame(
    { width: CARD_W, height: CARD_H, data: cropped },
    matchOptions(CARD_COLUMNS),
  )
  writePng(`${tmp}/card.png`, compositeFrame(frame, { background: BACKDROP }))

  // The composite is one atlas cell per glyph — 2880px across — so it is scaled down to
  // the card's width. Rounding the grid to whole cells leaves it a few rows taller than
  // 2:1, and those rows are cropped off rather than squashed: the glyph cell has to keep
  // the font's own aspect or the type below stops matching the texture behind it.
  ffmpeg([
    '-i',
    `${tmp}/card.png`,
    '-vf',
    `scale=${CARD_W}:-1:flags=lanczos,crop=${CARD_W}:${CARD_H}`,
    `${tmp}/card-scaled.png`,
  ])

  const card = readPng(`${tmp}/card-scaled.png`)

  // smoothstep, so the scrim has no edge to catch the eye where it lands.
  for (let x = 0; x < card.width; x++) {
    const u = Math.min(1, Math.max(0, (x - SCRIM_HOLD) / (SCRIM_END - SCRIM_HOLD)))
    const a = SCRIM_MAX * (1 - u * u * (3 - 2 * u))
    if (a <= 0) continue
    for (let y = 0; y < card.height; y++) {
      const i = (y * card.width + x) * 4
      for (let c = 0; c < 3; c++) {
        card.data[i + c] = Math.round(card.data[i + c] + (BACKDROP[c] - card.data[i + c]) * a)
      }
    }
  }

  const type = createTextRaster(font)
  const wordmark = type.cellForCap(74)
  const tagline = type.cellForCap(28)
  const meta = type.cellForCap(15)
  const x = 84
  type.draw(card, 'ASCII FX', { x, y: 250, cellH: wordmark, color: INK.accent })
  type.draw(card, 'ASCII that actually', { x, y: 326, cellH: tagline, color: INK.text })
  type.draw(card, 'looks like the picture.', { x, y: 376, cellH: tagline, color: INK.text })
  for (let ry = 0; ry < 2; ry++) {
    for (let rx = x; rx < x + 96; rx++) {
      const i = ((416 + ry) * card.width + rx) * 4
      card.data.set(INK.rule, i)
    }
  }
  type.draw(card, 'shape, not brightness · WebGPU · real time', {
    x,
    y: 461,
    cellH: meta,
    color: INK.muted,
  })
  writePng(`${tmp}/card-typeset.png`, card)

  // Every crawler that shows the card fetches it, so it is worth the last pass: an indexed
  // palette takes it from 434 KB to 135 KB with no visible difference. 256 rather than the
  // loop's 48 — the type is antialiased against the scrim and quantising that too far bands
  // the letterforms, which is the one thing on the card that has to stay clean.
  ffmpeg([
    '-i',
    `${tmp}/card-typeset.png`,
    '-vf',
    `split[a][b];[a]palettegen=max_colors=${CARD_PALETTE}:stats_mode=full[p];` +
      '[b][p]paletteuse=dither=none',
    '-compression_level',
    '100',
    `${assets}og.png`,
  ])
  console.log(`wrote ${assets}og.png`)
}

rmSync(tmp, { recursive: true, force: true })
