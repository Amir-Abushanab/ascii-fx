// Fetches the assets the /emoji experiment needs that cannot live in git:
//
//  1. Noto Color Emoji PNGs -> decoded IN NODE into 8x8 RGBA descriptors.
//     Decoding here rather than in the browser is the point of the bundled
//     path: no canvas readback, so no fingerprinting noise and a genuinely
//     deterministic set to contrast against the system one.
//  2. Kodak True Color images -> copied as-is; the browser decodes them.
//     They are the standard corpus for colour-imaging work, which beats me
//     hand-picking photographs that happen to flatter a result.
//
// Output lands in public/emoji/ (gitignored, like public/bench/). Re-run with
// `node prepEmoji.mjs`; existing files are reused so it is cheap to repeat.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChromaticProfile, decodePng } from '@ascii-fx/compiler'
import { matchFrame } from '@ascii-fx/core'

const OUT = fileURLToPath(new URL('./public/emoji/', import.meta.url))
const CACHE = fileURLToPath(new URL('./node_modules/.emoji-cache/', import.meta.url))
mkdirSync(OUT, { recursive: true })
mkdirSync(CACHE, { recursive: true })

const NOTO = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/png/128'
const KODAK = 'https://r0k.us/graphics/kodak/kodak'
// Chosen for colour-statistics variety, not for looks: faces and skin tones,
// foliage, sky, saturated man-made colour, water, and a low-key interior.
const PHOTOS = ['kodim04', 'kodim05', 'kodim08', 'kodim15', 'kodim21', 'kodim23']
const CONCURRENCY = 24

const idiv = (n, d) => Math.floor(n / d)
const rdiv = (n, d) => Math.floor((2 * n + d) / (2 * d))

async function fetchCached(url, cacheName) {
  const path = join(CACHE, cacheName)
  if (existsSync(path)) return new Uint8Array(readFileSync(path))
  const res = await fetch(url)
  if (!res.ok) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  writeFileSync(path, bytes)
  return bytes
}

// ————— candidate code points, mirroring src/emoji/emojiSet.ts —————
const RANGES = [
  [0x1f300, 0x1f5ff, false],
  [0x1f600, 0x1f64f, false],
  [0x1f680, 0x1f6ff, false],
  [0x1f900, 0x1f9ff, false],
  [0x1fa70, 0x1faff, false],
  [0x2600, 0x27bf, true],
]
const candidates = []
for (const [from, to, vs16] of RANGES) {
  for (let cp = from; cp <= to; cp++) candidates.push({ cp, vs16 })
}

// ————— 8x8 alpha-weighted reduction, same rule as reduce-v1 —————
function reduceTo8x8(img) {
  const { width: w, height: h, data } = img
  const out = new Uint8Array(256)
  for (let ty = 0; ty < 8; ty++) {
    const y0 = idiv(ty * h, 8)
    const y1 = Math.max(y0 + 1, idiv((ty + 1) * h, 8))
    for (let tx = 0; tx < 8; tx++) {
      const x0 = idiv(tx * w, 8)
      const x1 = Math.max(x0 + 1, idiv((tx + 1) * w, 8))
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * w + x) * 4
          const a = data[p + 3]
          sr += data[p] * a; sg += data[p + 1] * a; sb += data[p + 2] * a; sa += a; n++
        }
      }
      const k = (ty * 8 + tx) * 4
      if (sa === 0) { out[k] = out[k + 1] = out[k + 2] = out[k + 3] = 0 }
      else {
        out[k] = rdiv(sr, sa); out[k + 1] = rdiv(sg, sa); out[k + 2] = rdiv(sb, sa); out[k + 3] = rdiv(sa, n)
      }
    }
  }
  return out
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        results[idx] = await fn(items[idx], idx)
      }
    }),
  )
  return results
}

// ————— emoji —————
console.log(`[emoji] fetching up to ${candidates.length} Noto glyphs…`)
let fetched = 0
const decoded = await mapLimit(candidates, CONCURRENCY, async ({ cp, vs16 }) => {
  const name = `emoji_u${cp.toString(16)}.png`
  const bytes = await fetchCached(`${NOTO}/${name}`, name)
  if (++fetched % 200 === 0) console.log(`[emoji]   ${fetched}/${candidates.length}`)
  if (!bytes) return null
  try {
    const image = decodePng(bytes)
    return { char: String.fromCodePoint(cp) + (vs16 ? '️' : ''), image, tile: reduceTo8x8(image) }
  } catch {
    return null
  }
})

const kept = decoded.filter(Boolean)
// A fully transparent tile carries no ink; drop it the same way the browser
// builder drops blanks, so the two sets are pruned on comparable rules.
const solid = kept.filter((g) => {
  let cover = 0
  for (let k = 0; k < 64; k++) cover += g.tile[k * 4 + 3]
  return rdiv(cover, 64) >= 8
})

const samples = new Uint8Array(solid.length * 256)
solid.forEach((g, i) => samples.set(g.tile, i * 256))
writeFileSync(join(OUT, 'noto-set.json'), JSON.stringify({
  source: 'googlefonts/noto-emoji png/128',
  license: 'Apache-2.0 (image assets)',
  count: solid.length,
  glyphs: solid.map((g) => g.char),
}))
writeFileSync(join(OUT, 'noto-set.bin'), samples)
console.log(`[emoji] ${solid.length} glyphs -> noto-set.bin (${(samples.length / 1024).toFixed(0)} KB), ` +
  `${candidates.length - kept.length} absent from Noto, ${kept.length - solid.length} blank`)

// ————— compiled chromatic profile —————
// The measurement said a usage-curated ~100 glyphs matches the full 1301-glyph
// pool to within 1%, so that is what gets compiled and shipped. Curation trains
// on the photographs below, which are also what the sweep scores against; the
// experiment page keeps the held-out split, this is just the artefact.
const CURATED = 100
const decodedPhotos = []
for (const id of PHOTOS) {
  const bytes = await fetchCached(`${KODAK}/${id}.png`, `${id}.png`)
  if (bytes) decodedPhotos.push(decodePng(bytes))
}

if (decodedPhotos.length > 0) {
  console.log(`[emoji] compiling the full ${solid.length}-glyph profile…`)
  const glyphSources = solid.map((g) => ({ char: g.char, image: g.image }))
  const full = buildChromaticProfile({ glyphs: glyphSources, id: 'noto-full' })
  const counts = new Int32Array(full.profile.glyphCount)
  for (const photo of decodedPhotos) {
    const frame = matchFrame(photo, {
      profile: full.profile,
      columns: 20,
      matcher: 'chromatic',
      background: [11, 11, 15],
    })
    for (const id of frame.glyphIds) counts[id]++
  }
  const order = Array.from({ length: full.profile.glyphCount }, (_, i) => i).sort((a, b) => counts[b] - counts[a])
  const used = counts.filter((c) => c > 0).length

  // The full set ships so the picker can offer every glyph; the curated list
  // ships beside it as the default selection rather than as a second profile,
  // so narrowing is a subset of one palette instead of a profile swap.
  writeFileSync(join(OUT, 'noto-full.asciip'), full.binary)
  writeFileSync(
    join(OUT, 'noto-curated.json'),
    JSON.stringify({
      note: `Top ${CURATED} by usage over the Kodak corpus; the default selection in the picker.`,
      everPicked: used,
      of: full.profile.glyphCount,
      glyphs: order.slice(0, CURATED).map((i) => full.profile.glyphs[i]),
    }),
  )
  const curated = buildChromaticProfile({
    glyphs: order.slice(0, CURATED).map((i) => glyphSources[i]),
    id: 'noto-curated',
  })
  writeFileSync(join(OUT, 'noto-curated.asciip'), curated.binary)
  console.log(
    `[emoji] ${used}/${full.profile.glyphCount} glyphs were ever picked\n` +
      `[emoji] full  -> noto-full.asciip (${(full.binary.length / 1024 / 1024).toFixed(1)} MB, ${full.profile.glyphCount} glyphs)\n` +
      `[emoji] top ${CURATED} -> noto-curated.asciip (${(curated.binary.length / 1024).toFixed(0)} KB) + noto-curated.json`,
  )
}

// ————— photos —————
console.log(`[emoji] fetching ${PHOTOS.length} Kodak images…`)
const photos = []
for (const id of PHOTOS) {
  const bytes = await fetchCached(`${KODAK}/${id}.png`, `${id}.png`)
  if (!bytes) { console.warn(`[emoji] ! ${id} unavailable, skipping`); continue }
  writeFileSync(join(OUT, `${id}.png`), bytes)
  photos.push(id)
}
writeFileSync(join(OUT, 'photos.json'), JSON.stringify({
  source: 'Kodak True Color Image Suite (r0k.us mirror)',
  note: 'Standard colour-imaging corpus; released by Kodak for unrestricted research use.',
  photos,
}))
console.log(`[emoji] ${photos.length} photos -> public/emoji/`)
