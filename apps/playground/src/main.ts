import type { AsciiProfile, ColorMode, AlphaMode, RGB } from '@ascii-fx/core'
import { createAsciiProfile, decodeProfile, subsetProfile } from '@ascii-fx/core'
import type {
  AsciiRenderer,
  AsciiRendererRuntimeOptions,
  BackendChoice,
  FitMode,
  InteractionType,
  RenderSource,
} from '@ascii-fx/gpu'
import { createAsciiRenderer } from '@ascii-fx/gpu'
import {
  Clapperboard,
  ClipboardCopy,
  Component,
  Cpu,
  Crop,
  FileText,
  ImageDown,
  Package,
  ScanText,
  Sparkles,
  TriangleAlert,
  Type,
  createIcons,
} from 'lucide'
import { SCENES, type SceneKind } from './scenes'
import { ExportComponentDialog } from './exportDialog'
import { refreshExplainer } from './explainer'
import type { ExportState } from './exportSnippets'

createIcons({
  icons: { Clapperboard, ClipboardCopy, Component, Cpu, Crop, FileText, ImageDown, Package, ScanText, Sparkles, TriangleAlert, Type },
})

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
let out = $<HTMLCanvasElement>('out')
const stats = $('stats')
const els = {
  source: $<HTMLSelectElement>('source'),
  animate: $<HTMLInputElement>('animate'),
  imageFile: $<HTMLInputElement>('imageFile'),
  videoFile: $<HTMLInputElement>('videoFile'),
  font: $<HTMLSelectElement>('font'),
  fontFile: $<HTMLInputElement>('fontFile'),
  chars: $<HTMLInputElement>('chars'),
  backend: $<HTMLSelectElement>('backend'),
  temporal: $<HTMLInputElement>('temporal'),
  adaptive: $<HTMLInputElement>('adaptive'),
  columns: $<HTMLInputElement>('columns'),
  columnsOut: $<HTMLOutputElement>('columnsOut'),
  color: $<HTMLSelectElement>('color'),
  alpha: $<HTMLSelectElement>('alpha'),
  flat: $<HTMLInputElement>('flat'),
  flatOut: $<HTMLOutputElement>('flatOut'),
  fg: $<HTMLInputElement>('fg'),
  bg: $<HTMLInputElement>('bg'),
  fgLab: $<HTMLLabelElement>('fgLab'),
  bgLab: $<HTMLLabelElement>('bgLab'),
  colWarn: $<HTMLSpanElement>('colWarn'),
  fit: $<HTMLSelectElement>('fit'),
  interaction: $<HTMLSelectElement>('interaction'),
  fxRadius: $<HTMLInputElement>('fxRadius'),
  fxRadiusOut: $<HTMLOutputElement>('fxRadiusOut'),
  fxFeather: $<HTMLInputElement>('fxFeather'),
  fxFeatherOut: $<HTMLOutputElement>('fxFeatherOut'),
  fxIntensity: $<HTMLInputElement>('fxIntensity'),
  fxIntensityOut: $<HTMLOutputElement>('fxIntensityOut'),
}

const hexToRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

// ————— fonts —————
const profileCache = new Map<string, Promise<AsciiProfile>>()
let customFontCounter = 0
let customFontFamily: string | null = null

/** The chars field, deduped in given order; null when empty (= full charset). */
function charSubset(): string | null {
  const text = els.chars.value
  if (!text) return null
  return [...new Set(Array.from(text))].join('')
}

function loadSelectedProfile(): Promise<AsciiProfile> {
  const value = els.font.value
  const chars = charSubset()
  // Compiled profiles can only narrow (subsetProfile); runtime profiles
  // rasterize exactly the requested characters, so chars can go beyond ascii
  // there (blocks ▀▓, braille ⣿ — anything the browser font can draw).
  const key = `${value === 'upload' ? `upload:${customFontFamily ?? 'none'}` : value}:${value === 'geist' ? '' : (chars ?? '')}`
  let pending = profileCache.get(key)
  if (!pending) {
    if (value === 'geist') {
      pending = fetch(`${import.meta.env.BASE_URL}default.asciip`).then(async (res) => {
        if (!res.ok) throw new Error('compiled profile missing — run `pnpm golden:update` at the repo root')
        return decodeProfile(new Uint8Array(await res.arrayBuffer()))
      })
    } else if (value === 'upload') {
      if (!customFontFamily) return Promise.reject(new Error('pick a font file first'))
      pending = createAsciiProfile({ fontFamily: customFontFamily, ...(chars ? { characters: chars } : {}) })
    } else {
      pending = createAsciiProfile({ fontFamily: value, ...(chars ? { characters: chars } : {}) })
    }
    profileCache.set(key, pending)
    pending.catch(() => profileCache.delete(key))
  }
  return value === 'geist' && chars ? pending.then((p) => subsetProfile(p, chars)) : pending
}

async function loadFontFile(file: File): Promise<void> {
  const family = `PlaygroundFont${++customFontCounter}`
  const face = new FontFace(family, await file.arrayBuffer())
  await face.load()
  document.fonts.add(face)
  customFontFamily = family
}

// ————— sources —————
interface ActiveSource {
  kind: string
  source: RenderSource
  tick?: (t: number) => void
  live: boolean
  cleanup?: () => void
}
let active: ActiveSource | undefined

async function createSource(kind: string): Promise<ActiveSource> {
  if (kind in SCENES) {
    const scene = SCENES[kind as SceneKind].create()
    return { kind, source: scene.canvas, tick: scene.tick, live: true }
  }
  if (kind === 'webcam') {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960 }, audio: false })
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play()
    return {
      kind,
      source: video,
      live: true,
      cleanup: () => stream.getTracks().forEach((t) => t.stop()),
    }
  }
  if (kind === 'upload-image') {
    const file = els.imageFile.files?.[0]
    if (!file) throw new Error('pick an image file')
    const bitmap = await createImageBitmap(file)
    return { kind, source: bitmap, live: false, cleanup: () => bitmap.close() }
  }
  if (kind === 'upload-video') {
    const file = els.videoFile.files?.[0]
    if (!file) throw new Error('pick a video file')
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    video.loop = true
    video.playsInline = true
    await video.play()
    return { kind, source: video, live: true, cleanup: () => URL.revokeObjectURL(url) }
  }
  throw new Error(`unknown source ${kind}`)
}

// ————— renderer —————
let renderer: AsciiRenderer | undefined
let sceneRaf = 0
let frames = 0
let fpsWindowStart = performance.now()
let fps = 0

function matchOptions(): AsciiRendererRuntimeOptions {
  return {
    columns: Number(els.columns.value),
    color: els.color.value as ColorMode,
    alpha: els.alpha.value as AlphaMode,
    flatThreshold: Number(els.flat.value),
    foreground: hexToRgb(els.fg.value),
    background: hexToRgb(els.bg.value),
    fit: els.fit.value as FitMode,
    temporal: els.temporal.checked,
    adaptiveResolution: els.adaptive.checked,
  }
}

function applyInteraction(): void {
  const value = els.interaction.value
  renderer?.setInteraction(
    value === 'none'
      ? null
      : {
          type: value as InteractionType,
          radius: Number(els.fxRadius.value),
          feather: Number(els.fxFeather.value),
          intensity: Number(els.fxIntensity.value),
        },
  )
}

/** Every interaction runs on both backends; temporal/adaptive are WebGPU features. */
function syncInteractionAvailability(): void {
  const cpu = renderer?.backend === 'cpu'
  els.temporal.disabled = cpu
  els.adaptive.disabled = cpu
  syncPanel()
}

/** Show only the palette inputs the current color mode reads, and warn when
 * the cpu matcher is asked for more columns than it can sustain. */
function syncPanel(): void {
  const mode = els.color.value
  els.fgLab.hidden = mode !== 'mono'
  els.bgLab.hidden = mode === 'full'
  els.colWarn.hidden = !(renderer?.backend === 'cpu' && Number(els.columns.value) > 120)
}

function syncCanvasSize(): void {
  const dpr = window.devicePixelRatio || 1
  const rect = out.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width * dpr))
  const h = Math.max(1, Math.round(rect.height * dpr))
  if (out.width !== w || out.height !== h) renderer?.resize(w, h)
}

// Display refresh estimate: raised (never lowered) to the nearest common rate
// the page has actually achieved, so "good" adapts to 60Hz and 120Hz+ alike.
const REFRESH_RATES = [60, 75, 90, 120, 144, 165, 240]
let refreshEstimate = 60

function updateStats(): void {
  if (!renderer) return
  const grid = renderer.grid()
  const fpsSpan = document.createElement('span')
  if (fps > 0) {
    const ratio = fps / refreshEstimate
    fpsSpan.className = ratio >= 0.82 ? 'fps-good' : ratio >= 0.45 ? 'fps-ok' : 'fps-bad'
  }
  fpsSpan.textContent = `${fps.toFixed(0)} fps`
  const subset = charSubset() ? ` · ${renderer.profile.glyphCount} glyphs` : ''
  stats.replaceChildren(
    document.createTextNode(`${renderer.backend} · ${grid ? `${grid.columns}×${grid.rows} cells` : '—'} · `),
    fpsSpan,
    document.createTextNode(` · ${renderer.profile.metadata.fontFamily ?? renderer.profile.id}${subset} · ${active?.kind ?? '—'}`),
  )
}

function renderLoopPolicy(): void {
  if (!renderer || !active) return
  const continuous = active.live && (active.tick ? els.animate.checked : true)
  if (continuous) renderer.start()
  else {
    renderer.stop()
    renderer.render()
  }
}

const resizeObserver = new ResizeObserver(() => {
  syncCanvasSize()
  if (renderer && active && !active.live) renderer.render()
})

async function rebuild(): Promise<void> {
  renderer?.destroy()
  renderer = undefined
  // A canvas is permanently bound to its first context type (webgpu vs 2d),
  // so switching backends needs a fresh element in the same slot.
  const fresh = out.cloneNode(false) as HTMLCanvasElement
  out.replaceWith(fresh)
  out = fresh
  resizeObserver.disconnect()
  resizeObserver.observe(out)
  out.addEventListener('pointermove', (e) => {
    const rect = out.getBoundingClientRect()
    renderer?.pointer.set((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
  })
  let profile: AsciiProfile
  try {
    profile = await loadSelectedProfile()
  } catch (err) {
    stats.textContent = `font failed: ${err instanceof Error ? err.message : String(err)}`
    return
  }
  try {
    renderer = await createAsciiRenderer({
      canvas: out,
      profile,
      backend: els.backend.value as BackendChoice,
      ...matchOptions(),
    })
  } catch (err) {
    stats.textContent = `renderer failed: ${err instanceof Error ? err.message : String(err)}`
    return
  }
  syncCanvasSize()
  if (active) renderer.setSource(active.source)
  applyInteraction()
  syncInteractionAvailability()
  renderLoopPolicy()
  updateStats()
  // Explainer widgets run the real matcher against whatever font is loaded.
  refreshExplainer(profile)
}

async function switchSource(kind: string): Promise<void> {
  try {
    const next = await createSource(kind)
    active?.cleanup?.()
    active = next
    renderer?.setSource(next.source)
    renderLoopPolicy()
    updateStats()
  } catch (err) {
    stats.textContent = `source failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ————— wiring —————
// Upload options revert the select immediately: if the file dialog is
// canceled the UI still reflects reality, and picking the option again fires
// 'change' again (a select resting on the same value never re-fires).
let sourcePickerValue = 'orbs'
els.source.addEventListener('change', () => {
  const kind = els.source.value
  if (kind === 'upload-image' || kind === 'upload-video') {
    const input = kind === 'upload-image' ? els.imageFile : els.videoFile
    els.source.value = sourcePickerValue
    input.value = '' // re-selecting the same file must still fire 'change'
    input.click()
  } else {
    sourcePickerValue = kind
    void switchSource(kind)
  }
})
els.imageFile.addEventListener('change', () => {
  if (!els.imageFile.files?.length) return
  els.source.value = 'upload-image'
  sourcePickerValue = 'upload-image'
  void switchSource('upload-image')
})
els.videoFile.addEventListener('change', () => {
  if (!els.videoFile.files?.length) return
  els.source.value = 'upload-video'
  sourcePickerValue = 'upload-video'
  void switchSource('upload-video')
})

let fontPickerValue = 'geist'
els.font.addEventListener('change', () => {
  if (els.font.value === 'upload') {
    els.font.value = fontPickerValue
    els.fontFile.value = ''
    els.fontFile.click()
  } else {
    fontPickerValue = els.font.value
    void rebuild()
  }
})
els.fontFile.addEventListener('change', async () => {
  const file = els.fontFile.files?.[0]
  if (!file) return
  try {
    await loadFontFile(file)
    els.font.value = 'upload'
    fontPickerValue = 'upload'
    await rebuild()
  } catch (err) {
    stats.textContent = `font failed: ${err instanceof Error ? err.message : String(err)}`
  }
})

els.backend.addEventListener('change', () => void rebuild())
els.chars.addEventListener('change', () => void rebuild())

const optionInputs = [els.columns, els.color, els.alpha, els.flat, els.fg, els.bg, els.fit, els.temporal, els.adaptive]
for (const input of optionInputs) {
  input.addEventListener(input instanceof HTMLSelectElement ? 'change' : 'input', () => {
    els.columnsOut.value = els.columns.value
    els.flatOut.value = els.flat.value
    renderer?.setOptions(matchOptions())
    if (renderer && active && !(active.live && (active.tick ? els.animate.checked : true))) renderer.render()
    syncPanel()
    updateStats()
  })
}

const fxInputs = [els.interaction, els.fxRadius, els.fxFeather, els.fxIntensity]
for (const input of fxInputs) {
  input.addEventListener(input instanceof HTMLSelectElement ? 'change' : 'input', () => {
    els.fxRadiusOut.value = Number(els.fxRadius.value).toFixed(2)
    els.fxFeatherOut.value = Number(els.fxFeather.value).toFixed(2)
    els.fxIntensityOut.value = Number(els.fxIntensity.value).toFixed(2)
    applyInteraction()
  })
}

els.animate.addEventListener('change', renderLoopPolicy)

/** Current dials as a minimal diff from the library defaults (what a snippet needs). */
function getExportState(): ExportState {
  const options: Record<string, unknown> = {}
  const columns = Number(els.columns.value)
  if (columns !== 120) options.columns = columns
  if (els.color.value !== 'mono') options.color = els.color.value
  if (els.alpha.value !== 'mask') options.alpha = els.alpha.value
  const flat = Number(els.flat.value)
  if (flat !== 15) options.flatThreshold = flat
  const fg = hexToRgb(els.fg.value)
  const bg = hexToRgb(els.bg.value)
  if (fg.join() !== '255,255,255') options.foreground = fg
  if (bg.join() !== '0,0,0') options.background = bg
  if (els.fit.value !== 'contain') options.fit = els.fit.value
  if (els.temporal.checked) options.temporal = true
  if (els.adaptive.checked) options.adaptiveResolution = true

  let interaction: Record<string, unknown> | null = null
  if (els.interaction.value !== 'none') {
    interaction = { type: els.interaction.value }
    const radius = Number(els.fxRadius.value)
    const feather = Number(els.fxFeather.value)
    const intensity = Number(els.fxIntensity.value)
    if (radius !== 0.15) interaction.radius = radius
    if (feather !== 0.06) interaction.feather = feather
    if (intensity !== 1) interaction.intensity = intensity
  }

  const fontValue = els.font.value
  const font: ExportState['font'] =
    fontValue === 'geist'
      ? { kind: 'geist' }
      : fontValue === 'upload'
        ? { kind: 'upload', family: 'YourFont' }
        : { kind: 'system', family: fontValue }

  return {
    font,
    characters: charSubset() ?? undefined,
    backend: els.backend.value === 'auto' ? undefined : (els.backend.value as 'webgpu' | 'cpu'),
    options,
    interaction,
  }
}

let exportDialog: ExportComponentDialog | undefined
$('exportComponent').addEventListener('click', () => {
  exportDialog ??= new ExportComponentDialog(getExportState)
  exportDialog.show()
})

/** Success/error feedback that keeps the button's icon: swap only the label + pulse. */
function flash(btn: HTMLButtonElement, text: string, ok = true): void {
  const label = btn.querySelector<HTMLElement>('.btn-label')
  if (!label) return
  const original = label.textContent
  label.textContent = text
  btn.classList.add(ok ? 'flash-ok' : 'flash-err')
  setTimeout(() => {
    label.textContent = original
    btn.classList.remove('flash-ok', 'flash-err')
  }, 1200)
}

const copyTextBtn = $<HTMLButtonElement>('copyText')
copyTextBtn.addEventListener('click', () => {
  void renderer
    ?.captureFrame()
    .then((frame) => navigator.clipboard.writeText(frame.toText()))
    .then(() => flash(copyTextBtn, 'copied ✓'))
    .catch(() => flash(copyTextBtn, 'copy failed', false))
})
const saveTextBtn = $<HTMLButtonElement>('saveText')
saveTextBtn.addEventListener('click', () => {
  void renderer?.captureFrame().then((frame) => {
    const url = URL.createObjectURL(new Blob([frame.toText()], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'ascii-fx.txt'
    a.click()
    URL.revokeObjectURL(url)
    flash(saveTextBtn, 'saved ✓')
  })
})
const savePngBtn = $<HTMLButtonElement>('savePng')
savePngBtn.addEventListener('click', () => {
  if (!renderer) return
  renderer.render()
  void renderer.toBlob('image/png').then((blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ascii-fx.png'
    a.click()
    URL.revokeObjectURL(url)
    flash(savePngBtn, 'saved ✓')
  })
})
window.addEventListener('beforeunload', () => {
  renderer?.destroy()
  active?.cleanup?.()
})

// scene animation + fps meter
function animationLoop(): void {
  cancelAnimationFrame(sceneRaf)
  const tick = (): void => {
    if (active?.tick && els.animate.checked) active.tick(performance.now() / 1000)
    frames++
    const now = performance.now()
    if (now - fpsWindowStart > 500) {
      fps = (frames * 1000) / (now - fpsWindowStart)
      frames = 0
      fpsWindowStart = now
      const snapped = REFRESH_RATES.find((r) => fps <= r * 1.06) ?? 240
      if (snapped > refreshEstimate) refreshEstimate = snapped
      updateStats()
    }
    sceneRaf = requestAnimationFrame(tick)
  }
  sceneRaf = requestAnimationFrame(tick)
}

active = await createSource('orbs')
await rebuild()
animationLoop()
