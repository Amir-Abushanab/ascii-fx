// Runtime font profiles (spec §14 "usability still wins", §41): generated with
// Canvas at call time when no compiled .asciip is supplied. Browser-rasterizer
// output — NOT deterministic across browsers/OSes; precompiled profiles are.
import type { AsciiProfile } from './types.js'
import { resolveCharset } from './charsets.js'
import { idiv, nextPow2, rdiv } from './util.js'

export interface CreateAsciiProfileOptions {
  /** CSS font family. Default 'monospace'. */
  fontFamily?: string
  fontWeight?: number
  charset?: string
  characters?: string | readonly string[]
}

const CELL_H = 64
const PADDING = 4

const cache = new Map<string, Promise<AsciiProfile>>()
let warned = false

/**
 * Generate a profile from a browser-installed font (spec §41). Cached per
 * (family, weight, charset) for the session. Prefer compiled profiles for
 * deterministic rendering and faster startup.
 */
export function createAsciiProfile(options: CreateAsciiProfileOptions = {}): Promise<AsciiProfile> {
  const family = options.fontFamily ?? 'monospace'
  const weight = options.fontWeight ?? 400
  const { name: charsetName, glyphs } = resolveCharset(options.charset, options.characters)
  const key = `${family}|${weight}|${charsetName}|${glyphs.join('')}`
  let pending = cache.get(key)
  if (!pending) {
    pending = buildRuntimeProfile(family, weight, charsetName, glyphs)
    cache.set(key, pending)
    pending.catch(() => cache.delete(key))
  }
  return pending
}

async function buildRuntimeProfile(
  family: string,
  weight: number,
  charsetName: string,
  glyphs: string[],
): Promise<AsciiProfile> {
  const hasDom = typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined'
  if (!hasDom) {
    throw new Error(
      'createAsciiProfile needs a browser Canvas. In Node, compile a profile with @ascii-fx/compiler instead.',
    )
  }
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await document.fonts.load(`${weight} ${CELL_H}px ${family}`)
    } catch {
      // best effort; fall through to whatever the canvas resolves
    }
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  const isDev = env?.NODE_ENV !== 'production'
  if (isDev && !warned) {
    warned = true
    console.info(
      `[ascii-fx] Runtime font profile generated for "${family}". ` +
        'For faster startup and deterministic rendering, precompile it with @ascii-fx/compiler.',
    )
  }

  const measureCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(8, 8)
      : document.createElement('canvas')
  const mctx = measureCanvas.getContext('2d') as CanvasRenderingContext2D
  const fontAt = (px: number): string => `${weight} ${px}px ${family}`
  mctx.font = fontAt(48)
  const probe = mctx.measureText('Mg')
  const ascent48 = probe.fontBoundingBoxAscent || 48 * 0.8
  const descent48 = probe.fontBoundingBoxDescent || 48 * 0.2
  const fontSize = Math.max(4, Math.floor((48 * CELL_H) / (ascent48 + descent48)))
  mctx.font = fontAt(fontSize)
  const metrics = mctx.measureText('M')
  const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.8
  const advance = metrics.width
  const cellW = Math.max(1, Math.round(advance))
  const baseline = Math.max(0, Math.min(CELL_H, Math.round(ascent)))

  const n = glyphs.length
  const pitchW = nextPow2(cellW + 2 * PADDING)
  const pitchH = nextPow2(CELL_H + 2 * PADDING)
  let atlasColumns = 1
  while (atlasColumns * atlasColumns < n) atlasColumns++
  const atlasRows = idiv(n + atlasColumns - 1, atlasColumns)
  const atlasW = atlasColumns * pitchW
  const atlasH = atlasRows * pitchH
  const atlasData = new Uint8Array(atlasW * atlasH)
  const masksLo = new Uint32Array(n)
  const masksHi = new Uint32Array(n)
  const coverage = new Uint16Array(n)

  const glyphCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(cellW, CELL_H)
      : document.createElement('canvas')
  glyphCanvas.width = cellW
  glyphCanvas.height = CELL_H
  const ctx = glyphCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.font = fontAt(fontSize)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'

  // 8×8 mask-cell boundaries over the cell box (same partition rule as raster-v1).
  const xBound = Array.from({ length: 9 }, (_, m) => idiv(m * cellW, 8))
  const yBound = Array.from({ length: 9 }, (_, m) => idiv(m * CELL_H, 8))

  for (let i = 0; i < n; i++) {
    ctx.clearRect(0, 0, cellW, CELL_H)
    ctx.fillText(glyphs[i], 0, baseline)
    const img = ctx.getImageData(0, 0, cellW, CELL_H)
    let lo = 0
    let hi = 0
    let totalAlpha = 0
    for (let my = 0; my < 8; my++) {
      for (let mx = 0; mx < 8; mx++) {
        let sum = 0
        let count = 0
        for (let y = yBound[my]; y < Math.max(yBound[my] + 1, yBound[my + 1]); y++) {
          for (let x = xBound[mx]; x < Math.max(xBound[mx] + 1, xBound[mx + 1]); x++) {
            sum += img.data[(y * cellW + x) * 4 + 3]
            count++
          }
        }
        totalAlpha += sum
        if (2 * sum >= count * 255) {
          const m = my * 8 + mx
          if (m < 32) lo |= 1 << m
          else hi |= 1 << (m - 32)
        }
      }
    }
    masksLo[i] = lo >>> 0
    masksHi[i] = hi >>> 0
    coverage[i] = Math.min(65535, rdiv(totalAlpha * 65535, cellW * CELL_H * 255))
    const tileX = (i % atlasColumns) * pitchW + PADDING
    const tileY = idiv(i, atlasColumns) * pitchH + PADDING
    for (let y = 0; y < CELL_H; y++) {
      for (let x = 0; x < cellW; x++) {
        atlasData[(tileY + y) * atlasW + tileX + x] = img.data[(y * cellW + x) * 4 + 3]
      }
    }
  }

  // Content-derived pseudo-fingerprint (not a compiler fingerprint).
  let h = 0x811c9dc5
  for (let i = 0; i < atlasData.length; i += 97) h = Math.imul(h ^ atlasData[i], 0x01000193) >>> 0
  const fingerprint = `f17e${h.toString(16).padStart(8, '0')}`.padEnd(64, '0')

  return {
    version: 1,
    id: `runtime:${family}`,
    fingerprint,
    charsetHash: '00'.repeat(32),
    fontHash: '00'.repeat(32),
    glyphs,
    glyphCount: n,
    metrics: {
      unitsPerEm: 1000,
      ascent: Math.round((ascent / CELL_H) * 1000),
      descent: -Math.round(((CELL_H - ascent) / CELL_H) * 1000),
      lineGap: 0,
      advanceUnits: Math.round((advance / CELL_H) * 1000),
      cellWidth: cellW,
      cellHeight: CELL_H,
      baseline,
    },
    atlas: {
      width: atlasW,
      height: atlasH,
      pitchWidth: pitchW,
      pitchHeight: pitchH,
      cellWidth: cellW,
      cellHeight: CELL_H,
      padding: PADDING,
      columns: atlasColumns,
      data: atlasData,
    },
    structural: { masksLo, masksHi, coverage },
    metadata: {
      id: `runtime:${family}`,
      charset: charsetName,
      fontFamily: family,
      fontWeight: weight,
      compilerVersion: 'runtime',
    },
  }
}
