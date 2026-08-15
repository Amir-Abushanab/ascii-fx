const ASCII = (() => {
  let s = ''
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c)
  return s
})()

const BLOCKS =
  '▀▄█▌▐░▒▓' +
  '▖▗▘▙▚▛▜▝▞▟'

export const BUILTIN_CHARSETS: Readonly<Record<string, string>> = {
  ascii: ASCII,
  'ascii-blocks': ASCII + BLOCKS,
}

export interface ResolvedCharset {
  name: string
  glyphs: string[]
}

/**
 * Resolve a built-in charset name or custom character list into normalized
 * code-point glyphs. Duplicates after normalization are an error (spec §43).
 */
export function resolveCharset(
  charset?: string,
  characters?: string | readonly string[],
): ResolvedCharset {
  if (characters !== undefined) {
    const glyphs =
      typeof characters === 'string' ? Array.from(characters) : characters.flatMap((c) => Array.from(c))
    if (glyphs.length === 0) throw new Error('Custom character set is empty.')
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const g of glyphs) {
      if (seen.has(g)) dupes.add(g)
      seen.add(g)
    }
    if (dupes.size > 0) {
      throw new Error(
        `Character set contains duplicate code points after normalization: ${[...dupes]
          .map((c) => JSON.stringify(c))
          .join(', ')}`,
      )
    }
    return { name: 'custom', glyphs }
  }
  const name = charset ?? 'ascii'
  const set = BUILTIN_CHARSETS[name]
  if (set === undefined) {
    throw new Error(
      `Unknown charset ${JSON.stringify(name)}. Built-ins: ${Object.keys(BUILTIN_CHARSETS).join(', ')}. ` +
        'Pass `characters` for a custom set.',
    )
  }
  return { name, glyphs: Array.from(set) }
}
