import type { AsciiProfile, ColorMode, AlphaMode, RGB } from '@ascii-fx/core'
import { createAsciiProfile, decodeProfile, subsetProfile } from '@ascii-fx/core'
import {
  activeProfile,
  defaultSelection,
  loadFullPalette,
  paletteReady,
  selectionSize,
  setSelection,
} from './emojiMode.js'
import { mountPicker, type PickerHandles } from './glyphPicker.js'
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
  Smile,
  Sparkles,
  ToggleRight,
  TriangleAlert,
  Type,
  createIcons,
} from 'lucide'
import { SCENES, type SceneKind } from './scenes'
import { ExportComponentDialog } from './exportDialog'
import { buildAgentBrief } from './agentBrief'
import { createAgentCopyButton } from './agentCopyButton'
import { refreshExplainer } from './explainer'
import { renderMath } from './math'
import { mountSectionIcons } from './sectionIcons'
import { pointerUV } from './pointer'
import type { ExportState } from './exportSnippets'

createIcons({
  // Every data-lucide name used in index.astro has to be listed here — lucide
  // warns and leaves the <i> empty for one it was not handed.
  icons: {
    Clapperboard,
    ClipboardCopy,
    Component,
    Cpu,
    Crop,
    FileText,
    ImageDown,
    Package,
    ScanText,
    Smile,
    Sparkles,
    ToggleRight,
    TriangleAlert,
    Type,
  },
})

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
let out = $<HTMLCanvasElement>('out')
const stats = $('stats')
const els = {
  emojiMode: $<HTMLInputElement>('emojiMode'),
  hyst: $<HTMLInputElement>('hyst'),
  hystOut: $<HTMLOutputElement>('hystOut'),
  hystLab: $<HTMLElement>('hystLab'),
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

const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)')
let animatePreferenceTouched = false
els.animate.checked = !reducedMotionQuery.matches

const hexToRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

// ————— fonts —————
const profileCache = new Map<string, Promise<AsciiProfile>>()
let customFontCounter = 0
let customFontFamily: string | null = null

/**
 * The chars field, deduped in given order; null when empty (= full charset).
 * Dedupe by grapheme, not code point: subsetProfile segments strings by the
 * profile's own glyph strings, so a VS16/ZWJ emoji must reach it whole — a
 * per-code-point pass would hand on half a glyph. The field itself is never
 * rewritten; sanitizing happens on read.
 */
function charSubset(): string | null {
  const text = els.chars.value
  if (!text) return null
  const units =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(new Intl.Segmenter().segment(text), (s) => s.segment)
      : Array.from(text)
  return [...new Set(units)].join('')
}

const emojiOn = (): boolean => els.emojiMode.checked

function loadSelectedProfile(): Promise<AsciiProfile> {
  // Emoji mode replaces the glyph set wholesale: a chromatic palette is not a
  // font, so the font/charset controls have nothing to say about it.
  if (emojiOn()) return activeProfile()
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
        if (!res.ok)
          throw new Error('compiled profile missing — run `pnpm golden:update` at the repo root')
        return decodeProfile(new Uint8Array(await res.arrayBuffer()))
      })
    } else if (value === 'upload') {
      if (!customFontFamily) return Promise.reject(new Error('pick a font file first'))
      pending = createAsciiProfile({
        fontFamily: customFontFamily,
        ...(chars ? { characters: chars } : {}),
      })
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
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 960 },
      audio: false,
    })
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
let outputVisible = true

function matchOptions(): AsciiRendererRuntimeOptions {
  return {
    columns: Number(els.columns.value),
    // chromatic-v1 emits colorMode 'glyph' and ignores fg/flat; passing the
    // ASCII values through would be silently meaningless rather than wrong,
    // but leaving them out keeps the option object honest about what applies.
    ...(emojiOn()
      ? { matcher: 'chromatic' as const, hysteresis: Number(els.hyst.value) }
      : {
          color: els.color.value as ColorMode,
          flatThreshold: Number(els.flat.value),
          foreground: hexToRgb(els.fg.value),
        }),
    alpha: els.alpha.value as AlphaMode,
    background: hexToRgb(els.bg.value),
    fit: els.fit.value as FitMode,
    temporal: els.temporal.checked && !els.temporal.disabled,
    adaptiveResolution: els.adaptive.checked && !els.adaptive.disabled,
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
  // Exact temporal reuse skips cells whose samples are unchanged, which only
  // pays against structural-v1's prefilter — chromatic-v1 never reads the
  // previous frame's samples, so the control is disabled rather than left
  // looking effective.
  els.temporal.disabled = cpu || emojiOn()
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
  // In emoji mode the palette size is the interesting number, and it changes
  // with the picker rather than with a charset string.
  const subset = emojiOn() || charSubset() ? ` · ${renderer.profile.glyphCount} glyphs` : ''
  const name = emojiOn()
    ? `chromatic-v1${selectionSize() === null ? ' · curated' : ''}`
    : (renderer.profile.metadata.fontFamily ?? renderer.profile.id)
  const children: (Node | string)[] = [document.createTextNode(`${renderer.backend} `)]
  if (backendNote) {
    const warn = document.createElement('span')
    warn.className = 'warn'
    warn.textContent = `⚠ ${backendNote}`
    children.push(warn, document.createTextNode(' '))
  }
  children.push(
    document.createTextNode(`· ${grid ? `${grid.columns}×${grid.rows} cells` : '—'} · `),
    fpsSpan,
    document.createTextNode(` · ${name}${subset} · ${active?.kind ?? '—'}`),
  )
  stats.replaceChildren(...children)
}

function renderLoopPolicy(): void {
  if (!renderer || !active) return
  const pageVisible = document.visibilityState !== 'hidden'
  const continuous = active.live && els.animate.checked && outputVisible && pageVisible
  if (active.source instanceof HTMLVideoElement) {
    if (continuous) void active.source.play().catch(() => {})
    else active.source.pause()
  }
  if (continuous) renderer.start()
  else {
    renderer.stop()
    if (outputVisible && pageVisible) renderer.render()
  }
  if (!continuous) fps = 0
}

function syncMotionPolicy(): void {
  renderLoopPolicy()
  if (
    active?.tick &&
    els.animate.checked &&
    outputVisible &&
    document.visibilityState !== 'hidden'
  ) {
    animationLoop()
  } else if (sceneRaf) {
    cancelAnimationFrame(sceneRaf)
    sceneRaf = 0
  }
  updateStats()
}

const outputObserver = new IntersectionObserver(([entry]) => {
  outputVisible = entry?.isIntersecting ?? true
  syncMotionPolicy()
})
outputObserver.observe(out)
document.addEventListener('visibilitychange', syncMotionPolicy)
reducedMotionQuery.addEventListener('change', () => {
  if (!animatePreferenceTouched) els.animate.checked = !reducedMotionQuery.matches
  syncMotionPolicy()
})

const resizeObserver = new ResizeObserver(() => {
  syncCanvasSize()
  if (renderer && active && !active.live) renderer.render()
})

/**
 * The GPU went away — memory pressure, a driver reset, a backgrounded tab — and
 * the renderer could not get a replacement. rebuild() swaps in a fresh <canvas>,
 * which is what the CPU matcher needs (an element is stuck with its first
 * context type), so 'auto' can land there instead of leaving a dead surface up.
 */
let lastDeviceLossAt = 0
/**
 * Set once WebGPU has proved it cannot actually render here. Setup can pass on a
 * browser whose limits or WGSL support differ and then drop every dispatch, so
 * 'auto' would keep choosing WebGPU forever; this pins the rebuild to CPU.
 */
let forcedBackend: BackendChoice | null = null
/** Why the running backend differs from the dropdown (webgpu picked, unavailable); shown in the status line. */
let backendNote: string | null = null
function handleGpuError(error: GPUError): void {
  if (forcedBackend) return
  forcedBackend = 'cpu'
  console.error('[ascii-fx] WebGPU error:', error.message)
  // Persistent, not a one-shot stats write: the fps ticker re-renders the
  // status every 500ms and would erase a plain textContent within a beat.
  backendNote = `webgpu failed, fell back: ${error.message}`
  void rebuild()
}

function handleDeviceLost(): void {
  const now = performance.now()
  // Two losses in quick succession means rebuilding is not helping.
  if (now - lastDeviceLossAt < 5000) {
    backendNote = 'gpu lost repeatedly and could not be restarted — reload the page'
    stats.textContent = backendNote
    return
  }
  lastDeviceLossAt = now
  backendNote = 'gpu device lost, fell back'
  forcedBackend = 'cpu'
  stats.textContent = 'gpu lost — restarting on the CPU matcher…'
  void rebuild()
}

async function rebuild(): Promise<void> {
  renderer?.destroy()
  renderer = undefined
  // A canvas is permanently bound to its first context type (webgpu vs 2d),
  // so switching backends needs a fresh element in the same slot.
  const fresh = out.cloneNode(false) as HTMLCanvasElement
  fresh.classList.toggle('swapping', out.classList.contains('swapping'))
  out.replaceWith(fresh)
  out = fresh
  outputObserver.disconnect()
  outputObserver.observe(out)
  resizeObserver.disconnect()
  resizeObserver.observe(out)
  out.addEventListener('pointermove', (e) => {
    renderer?.pointer.set(...pointerUV(e, out))
  })
  let profile: AsciiProfile
  try {
    profile = await loadSelectedProfile()
  } catch (err) {
    stats.textContent = `font failed: ${err instanceof Error ? err.message : String(err)}`
    return
  }
  const backend = forcedBackend ?? (els.backend.value as BackendChoice)
  // A forced rebuild carries its note (why we are on CPU); a user-initiated
  // one starts clean.
  if (!forcedBackend) backendNote = null
  try {
    renderer = await createAsciiRenderer({
      canvas: out,
      profile,
      backend,
      onDeviceLost: handleDeviceLost,
      onError: handleGpuError,
      ...matchOptions(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // An explicit WebGPU pick on a machine without it should degrade like
    // 'auto' does, not dead-end — but visibly: the status keeps saying which
    // backend actually runs and why the requested one could not.
    if (backend === 'webgpu') {
      backendNote = `webgpu unavailable, fell back: ${message}`
      try {
        renderer = await createAsciiRenderer({
          canvas: out,
          profile,
          backend: 'cpu',
          ...matchOptions(),
        })
      } catch (cpuErr) {
        stats.textContent = `renderer failed: ${cpuErr instanceof Error ? cpuErr.message : String(cpuErr)}`
        return
      }
    } else {
      stats.textContent = `renderer failed: ${message}`
      return
    }
  }
  syncCanvasSize()
  if (active) renderer.setSource(active.source)
  applyInteraction()
  syncInteractionAvailability()
  syncMotionPolicy()
  updateStats()
  // Explainer widgets run the real matcher against whatever font is loaded.
  refreshExplainer(profile)
  // So do the heading icons — swap the font and they change with it.
  void mountSectionIcons(profile, emojiOn())
}

async function switchSource(kind: string): Promise<void> {
  try {
    const next = await createSource(kind)
    active?.cleanup?.()
    active = next
    renderer?.setSource(next.source)
    syncMotionPolicy()
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

els.backend.addEventListener('change', () => {
  forcedBackend = null
  void rebuild()
})
els.chars.addEventListener('change', () => void rebuild())

// ————— Emoji mode —————

let picker: PickerHandles | undefined
/** Debounced: the picker's action buttons can fire faster than a rebuild. */
let paletteTimer: number | undefined

async function mountGlyphPicker(): Promise<void> {
  if (picker) return
  const host = $<HTMLElement>('pickerHost')
  host.textContent = 'loading the full palette…'
  const [full, initial] = await Promise.all([loadFullPalette(), defaultSelection()])
  host.textContent = ''
  picker = mountPicker(host, {
    profile: full,
    initial: (glyph) => initial.has(glyph),
    defaultSelection: initial,
    onChange: (glyphs) => {
      window.clearTimeout(paletteTimer)
      paletteTimer = window.setTimeout(() => {
        // A selection identical to the default stays null, so the common case
        // renders straight off the curated profile with no subsetting.
        setSelection(
          glyphs.length === initial.size && glyphs.every((g) => initial.has(g)) ? null : glyphs,
        )
        void rebuild()
      }, 140)
    },
  })
}

const emojiToggle = $<HTMLElement>('emojiToggle')
const heroStage = $<HTMLElement>('heroStage')
const heroBusyLabel = $<HTMLElement>('heroBusyLabel')

els.emojiMode.addEventListener('change', () => {
  els.hystLab.hidden = !emojiOn()
  syncPanel()
  // Flipping the switch fetches and decodes a palette and rebuilds the
  // renderer, which is visibly not instant on a first flip. The toggle owns the
  // wait so the pointer never sits on a control that looks idle.
  emojiToggle.dataset.busy = '1'
  els.emojiMode.disabled = true
  out.classList.add('swapping')
  heroStage.dataset.busy = '1'
  heroBusyLabel.textContent =
    emojiOn() && !paletteReady() ? 'loading emoji palette…' : 'switching matcher…'
  void (async () => {
    await rebuild()
    // The full 1301-glyph sheet is 6.8 MB, so it is fetched after the first
    // emoji frame is already on screen rather than blocking it.
    if (emojiOn()) await mountGlyphPicker()
  })()
    .catch((err: unknown) => {
      stats.textContent = `emoji mode failed: ${err instanceof Error ? err.message : String(err)}`
    })
    .finally(() => {
      delete emojiToggle.dataset.busy
      delete heroStage.dataset.busy
      els.emojiMode.disabled = false
      // rebuild() swaps in a fresh canvas element, so the class has to be
      // cleared on whichever one is current, not the one captured above.
      out.classList.remove('swapping')
    })
})

const optionInputs = [
  els.columns,
  els.color,
  els.alpha,
  els.flat,
  els.fg,
  els.bg,
  els.fit,
  els.temporal,
  els.adaptive,
  els.hyst,
]
for (const input of optionInputs) {
  input.addEventListener(input instanceof HTMLSelectElement ? 'change' : 'input', () => {
    els.columnsOut.value = els.columns.value
    els.flatOut.value = els.flat.value
    els.hystOut.value = Number(els.hyst.value).toFixed(2)
    renderer?.setOptions(matchOptions())
    if (renderer && active && !(active.live && els.animate.checked && outputVisible))
      renderer.render()
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

els.animate.addEventListener('change', () => {
  animatePreferenceTouched = true
  syncMotionPolicy()
})

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
  if (els.temporal.checked && !els.temporal.disabled) options.temporal = true
  if (els.adaptive.checked && !els.adaptive.disabled) options.adaptiveResolution = true

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

// The handoff lives in the panel too, not only inside the export dialog — it is
// the one export most people want and the least likely to be found behind a
// modal. It follows the dialog's framework pick when there is one, so the two
// can never hand an agent different snippets.
$('agentRow').append(
  createAgentCopyButton(() =>
    buildAgentBrief(exportDialog?.currentFramework() ?? 'react', getExportState()),
  ),
)

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
  outputObserver.disconnect()
  if (sceneRaf) cancelAnimationFrame(sceneRaf)
  renderer?.destroy()
  active?.cleanup?.()
})

// scene animation + fps meter
function animationLoop(): void {
  if (
    sceneRaf ||
    !active?.tick ||
    !els.animate.checked ||
    !outputVisible ||
    document.visibilityState === 'hidden'
  ) {
    return
  }
  const tick = (): void => {
    if (
      !active?.tick ||
      !els.animate.checked ||
      !outputVisible ||
      document.visibilityState === 'hidden'
    ) {
      sceneRaf = 0
      return
    }
    active.tick(performance.now() / 1000)
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

// The explainer's formulas are static markup, so they typeset once rather than
// on every profile refresh.
renderMath()

active = await createSource('orbs')
await rebuild()
syncMotionPolicy()
