import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import type { Plugin } from 'vite'
import { loadConfigFromFile } from 'vite'
import type { AsciiProfile } from '@ascii-fx/core'
import { decodeProfile } from '@ascii-fx/core'
import type { AsciiConfig } from '@ascii-fx/compiler'
import { buildFrame, buildProfile, decodePng } from '@ascii-fx/compiler'

export { defineAsciiConfig } from '@ascii-fx/compiler'
export type { AsciiConfig, AsciiFrameConfig, AsciiProfileConfig } from '@ascii-fx/compiler'

const PROFILE_PREFIX = 'virtual:ascii-profile/'
const FRAME_PREFIX = 'virtual:ascii-frame/'
const RESOLVED = '\0'

export interface AsciiPluginOptions {
  /** Inline config or path to an ascii-fx.config.(ts|js|mjs). Default './ascii-fx.config.ts'. */
  config?: string | AsciiConfig
  /** Compiled asset cache. Default '<root>/node_modules/.ascii-fx'. */
  cacheDir?: string
}

interface ProfileEntry {
  cachePath: string
  profile: AsciiProfile
  fontPath: string
}

const sha = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')

/**
 * ASCII FX Vite plugin (spec §17): compiles font profiles and static frames at
 * build time and exposes them as typed virtual modules
 * (`virtual:ascii-profile/<name>`, `virtual:ascii-frame/<name>`). All
 * compilation lives in @ascii-fx/compiler; nothing of it reaches the client
 * bundle — modules resolve to hashed .asciip/.asciif assets via `?url`.
 */
export function ascii(options: AsciiPluginOptions = {}): Plugin {
  let root = process.cwd()
  let cacheDir = ''
  let config: AsciiConfig | undefined
  let configDeps: string[] = []
  const profiles = new Map<string, ProfileEntry>()
  const frames = new Map<string, { cachePath: string; profileName: string; imagePath: string }>()

  async function ensureConfig(): Promise<AsciiConfig> {
    if (config) return config
    const opt = options.config
    if (opt && typeof opt === 'object') {
      config = opt
      return config
    }
    const file = resolve(root, typeof opt === 'string' ? opt : 'ascii-fx.config.ts')
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, file, root)
    if (!loaded) {
      throw new Error(`[ascii-fx] Could not load config at ${file}. Create it with defineAsciiConfig({ profiles: ... }).`)
    }
    configDeps = [loaded.path, ...loaded.dependencies.map((d) => resolve(root, d))]
    config = loaded.config as AsciiConfig
    return config
  }

  async function ensureProfile(name: string): Promise<ProfileEntry> {
    const cached = profiles.get(name)
    if (cached) return cached
    const cfg = await ensureConfig()
    const pc = cfg.profiles?.[name]
    if (!pc) {
      throw new Error(
        `[ascii-fx] Profile "${name}" is not defined in the config (available: ${Object.keys(cfg.profiles ?? {}).join(', ') || 'none'}).`,
      )
    }
    const fontPath = resolve(root, pc.font)
    if (!existsSync(fontPath)) throw new Error(`[ascii-fx] Font not found for profile "${name}": ${fontPath}`)
    const font = new Uint8Array(readFileSync(fontPath))
    const key = sha(
      JSON.stringify([sha(font), pc.charset ?? 'ascii', pc.characters ?? null, pc.shape6 ?? false, 'asciip/1']),
    ).slice(0, 16)
    const cachePath = resolve(cacheDir, `${name}-${key}.asciip`)
    let profile: AsciiProfile
    if (existsSync(cachePath)) {
      profile = decodeProfile(new Uint8Array(readFileSync(cachePath)))
    } else {
      const built = buildProfile({
        font,
        id: name,
        charset: pc.charset,
        characters: pc.characters,
        shape6: pc.shape6,
      })
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(cachePath, built.binary)
      profile = built.profile
    }
    const entry = { cachePath, profile, fontPath }
    profiles.set(name, entry)
    return entry
  }

  async function ensureFrame(name: string): Promise<{ cachePath: string; profileName: string; imagePath: string }> {
    const cached = frames.get(name)
    if (cached) return cached
    const cfg = await ensureConfig()
    const fc = cfg.frames?.[name]
    if (!fc) {
      throw new Error(
        `[ascii-fx] Frame "${name}" is not defined in the config (available: ${Object.keys(cfg.frames ?? {}).join(', ') || 'none'}).`,
      )
    }
    const profileName = fc.profile ?? 'default'
    const { profile } = await ensureProfile(profileName)
    const imagePath = resolve(root, fc.image)
    if (!existsSync(imagePath)) throw new Error(`[ascii-fx] Image not found for frame "${name}": ${imagePath}`)
    const imageBytes = new Uint8Array(readFileSync(imagePath))
    const key = sha(
      JSON.stringify([sha(imageBytes), profile.fingerprint, fc.columns, fc.rows, fc.color, fc.alpha, 'asciif/1']),
    ).slice(0, 16)
    const cachePath = resolve(cacheDir, `${name}-${key}.asciif`)
    if (!existsSync(cachePath)) {
      const built = buildFrame({
        image: decodePng(imageBytes),
        profile,
        columns: fc.columns,
        rows: fc.rows,
        color: fc.color,
        alpha: fc.alpha,
      })
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(cachePath, built.binary)
    }
    const entry = { cachePath, profileName, imagePath }
    frames.set(name, entry)
    return entry
  }

  return {
    name: 'ascii-fx',
    configResolved(resolved) {
      root = resolved.root
      cacheDir = options.cacheDir ? resolve(root, options.cacheDir) : resolve(root, 'node_modules/.ascii-fx')
      // Config/watch state resets per build so edits are picked up.
      config = typeof options.config === 'object' ? options.config : undefined
      profiles.clear()
      frames.clear()
    },
    resolveId(id) {
      if (id.startsWith(PROFILE_PREFIX) || id.startsWith(FRAME_PREFIX)) return RESOLVED + id
      return null
    },
    async load(id) {
      if (id.startsWith(RESOLVED + PROFILE_PREFIX)) {
        const name = id.slice(RESOLVED.length + PROFILE_PREFIX.length)
        const entry = await ensureProfile(name)
        this.addWatchFile(entry.fontPath)
        for (const dep of configDeps) this.addWatchFile(dep)
        return (
          `import url from ${JSON.stringify(`${entry.cachePath}?url`)}\n` +
          `export default { url, id: ${JSON.stringify(name)} }\n`
        )
      }
      if (id.startsWith(RESOLVED + FRAME_PREFIX)) {
        const name = id.slice(RESOLVED.length + FRAME_PREFIX.length)
        const entry = await ensureFrame(name)
        this.addWatchFile(entry.imagePath)
        for (const dep of configDeps) this.addWatchFile(dep)
        return (
          `import url from ${JSON.stringify(`${entry.cachePath}?url`)}\n` +
          `export default { url, id: ${JSON.stringify(name)}, profile: ${JSON.stringify(entry.profileName)} }\n`
        )
      }
      return null
    },
  }
}
