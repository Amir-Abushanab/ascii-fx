// Palette presets and the post-effect dials. The presets live here and not in the
// library on purpose (spec §42: no visual-style presets in core) — the renderer takes
// a plain list of colours, and these are just lists someone might want.
import type { DitherKind, PaletteOptions, RGB } from '@ascii-fx/core'
import type { PostOptions } from '@ascii-fx/gpu'

const hex = (...codes: string[]): RGB[] =>
  codes.map((c) => [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ])

export const PALETTES: Record<string, { label: string; colors: RGB[] }> = {
  gameboy: { label: 'Game Boy', colors: hex('0f380f', '306230', '8bac0f', '9bbc0f') },
  pico8: {
    label: 'PICO-8',
    colors: hex(
      '000000',
      '1d2b53',
      '7e2553',
      '008751',
      'ab5236',
      '5f574f',
      'c2c3c7',
      'fff1e8',
      'ff004d',
      'ffa300',
      'ffec27',
      '00e436',
      '29adff',
      '83769c',
      'ff77a8',
      'ffccaa',
    ),
  },
  // Pepto's measured C64 palette.
  c64: {
    label: 'C64',
    colors: hex(
      '000000',
      'ffffff',
      '68372b',
      '70a4b2',
      '6f3d86',
      '588d43',
      '352879',
      'b8c76f',
      '6f4f25',
      '433900',
      '9a6759',
      '444444',
      '6c6c6c',
      '9ad284',
      '6c5eb5',
      '959595',
    ),
  },
  // Mode 4, palette 1, high intensity: the one everyone remembers.
  cga: { label: 'CGA', colors: hex('000000', '55ffff', 'ff55ff', 'ffffff') },
  amber: { label: 'amber CRT', colors: hex('000000', '5a3200', 'c87800', 'ffb000') },
  onebit: { label: '1-bit', colors: hex('000000', 'ffffff') },
}

export interface LookControls {
  palette: HTMLSelectElement
  dither: HTMLSelectElement
  spread: HTMLInputElement
  scanlines: HTMLInputElement
  vignette: HTMLInputElement
  curvature: HTMLInputElement
  aberration: HTMLInputElement
  bloom: HTMLInputElement
  noise: HTMLInputElement
}

/** The palette as a renderer option, or null for none. */
export function paletteOption(c: LookControls): PaletteOptions | null {
  const preset = PALETTES[c.palette.value]
  if (!preset) return null
  const dither = c.dither.value as DitherKind
  return {
    colors: preset.colors,
    ...(dither !== 'none' ? { dither, spread: Number(c.spread.value) } : {}),
  }
}

/** Only the dials off zero, so the exported snippet carries nothing that does nothing. */
export function postOption(c: LookControls): PostOptions | null {
  const post: PostOptions = {}
  const dials: Array<[keyof PostOptions, HTMLInputElement]> = [
    ['scanlines', c.scanlines],
    ['vignette', c.vignette],
    ['curvature', c.curvature],
    ['aberration', c.aberration],
    ['bloom', c.bloom],
    ['grain', c.noise],
  ]
  for (const [key, input] of dials) {
    const v = Number(input.value)
    if (v > 0) post[key] = v
  }
  return Object.keys(post).length > 0 ? post : null
}
