import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { decodeFrame, decodeProfile } from '@ascii-fx/core'
import { ascii } from '../src/index.js'

const FONT_PATH = fileURLToPath(
  new URL('../../../fixtures/fonts/GeistMono-Regular.ttf', import.meta.url),
)

const makePng = (): Uint8Array => {
  const png = new PNG({ width: 64, height: 32 })
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      const p = (y * 64 + x) * 4
      const v = x < 32 ? 30 : 220
      png.data[p] = v
      png.data[p + 1] = v
      png.data[p + 2] = 255 - v
      png.data[p + 3] = 255
    }
  }
  return new Uint8Array(PNG.sync.write(png))
}

interface LoadCtx {
  addWatchFile(file: string): void
}

const runHooks = async (
  plugin: ReturnType<typeof ascii>,
  id: string,
  watched: string[],
): Promise<string> => {
  const resolveId = plugin.resolveId as (id: string) => string | null
  const load = plugin.load as (this: LoadCtx, id: string) => Promise<string | null>
  const resolved = resolveId.call(plugin, id)
  expect(resolved).toBe(`\0${id}`)
  const code = await load.call({ addWatchFile: (f: string) => watched.push(f) }, resolved!)
  expect(code).toBeTruthy()
  return code!
}

const assetPathOf = (code: string): string => {
  const match = /import url from "(.*)\?url"/.exec(code.replaceAll("'", '"'))
  expect(match, `no ?url import in:\n${code}`).toBeTruthy()
  return match![1]
}

describe('@ascii-fx/vite plugin', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ascii-fx-vite-'))
  const pngPath = join(tmp, 'hero.png')
  writeFileSync(pngPath, Buffer.from(makePng()))

  const plugin = ascii({
    config: {
      profiles: { default: { font: FONT_PATH } },
      frames: { hero: { image: pngPath, columns: 16, color: 'full' } },
    },
    cacheDir: join(tmp, 'cache'),
  })
  ;(plugin.configResolved as (c: { root: string }) => void)({ root: tmp })

  it('compiles a profile into the cache and emits a ?url virtual module', async () => {
    const watched: string[] = []
    const code = await runHooks(plugin, 'virtual:ascii-profile/default', watched)
    expect(code).toContain(`id: "default"`)
    expect(watched).toContain(FONT_PATH)
    const cachePath = assetPathOf(code)
    const profile = decodeProfile(new Uint8Array(readFileSync(cachePath)))
    expect(profile.glyphCount).toBe(95)
    expect(profile.id).toBe('default')
  })

  it('reuses the cached profile on subsequent loads', async () => {
    const first = assetPathOf(await runHooks(plugin, 'virtual:ascii-profile/default', []))
    const mtime = statSync(first).mtimeMs
    const second = assetPathOf(await runHooks(plugin, 'virtual:ascii-profile/default', []))
    expect(second).toBe(first)
    expect(statSync(second).mtimeMs).toBe(mtime)
  })

  it('builds static frames bound to their profile', async () => {
    const watched: string[] = []
    const code = await runHooks(plugin, 'virtual:ascii-frame/hero', watched)
    expect(code).toContain(`profile: "default"`)
    expect(watched).toContain(pngPath)
    expect(watched).toContain(FONT_PATH)
    const framePath = assetPathOf(code)
    const profilePath = assetPathOf(await runHooks(plugin, 'virtual:ascii-profile/default', []))
    const profile = decodeProfile(new Uint8Array(readFileSync(profilePath)))
    const frame = decodeFrame(new Uint8Array(readFileSync(framePath)), profile)
    expect(frame.columns).toBe(16)
    expect(frame.colorMode).toBe('full')
    expect(frame.toText().length).toBeGreaterThan(0)
  })

  it('unknown names fail with the available list', async () => {
    await expect(runHooks(plugin, 'virtual:ascii-profile/nope', [])).rejects.toThrow(
      /available: default/,
    )
    await expect(runHooks(plugin, 'virtual:ascii-frame/nope', [])).rejects.toThrow(
      /available: hero/,
    )
  })

  it('ignores unrelated ids', () => {
    const resolveId = plugin.resolveId as (id: string) => string | null
    expect(resolveId.call(plugin, './regular-module.ts')).toBeNull()
  })

  it('invalidates compiled profiles when a watched font changes', async () => {
    const hotDir = mkdtempSync(join(tmpdir(), 'ascii-fx-vite-hmr-'))
    const fontPath = join(hotDir, 'font.ttf')
    const originalFont = readFileSync(FONT_PATH)
    writeFileSync(fontPath, originalFont)
    const hotPlugin = ascii({
      config: { profiles: { default: { font: fontPath } } },
      cacheDir: join(hotDir, 'cache'),
    })
    ;(hotPlugin.configResolved as (c: { root: string }) => void)({ root: hotDir })
    const first = assetPathOf(await runHooks(hotPlugin, 'virtual:ascii-profile/default', []))

    // A trailing byte is ignored by the font parser but must still invalidate
    // the content-addressed profile cache and virtual module.
    writeFileSync(fontPath, Buffer.concat([originalFont, Buffer.from([0])]))
    const watchChange = hotPlugin.watchChange as (id: string) => void
    watchChange.call(hotPlugin, fontPath)
    const second = assetPathOf(await runHooks(hotPlugin, 'virtual:ascii-profile/default', []))
    expect(second).not.toBe(first)
  })

  // A crash mid-write used to leave a truncated cache entry that every later
  // build trusted, surfacing as "Corrupt ASCII FX profile" with no mention of
  // the cache and no way out short of deleting node_modules/.ascii-fx by hand.
  // Writes are atomic now, and an unreadable entry is treated as a miss.
  it('rebuilds over a corrupt profile cache entry instead of failing forever', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ascii-fx-vite-corrupt-'))
    const cacheDir = join(dir, 'cache')
    const make = (): ReturnType<typeof ascii> => {
      const p = ascii({ config: { profiles: { default: { font: FONT_PATH } } }, cacheDir })
      ;(p.configResolved as (c: { root: string }) => void)({ root: dir })
      return p
    }
    const cachePath = assetPathOf(await runHooks(make(), 'virtual:ascii-profile/default', []))
    writeFileSync(cachePath, readFileSync(cachePath).subarray(0, 100)) // truncate in place

    // A fresh plugin instance (new dev server) must rebuild, not throw.
    const rebuilt = assetPathOf(await runHooks(make(), 'virtual:ascii-profile/default', []))
    expect(rebuilt).toBe(cachePath)
    expect(decodeProfile(new Uint8Array(readFileSync(rebuilt))).glyphCount).toBe(95)
  })

  it('rebuilds over a corrupt frame cache entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ascii-fx-vite-corrupt-frame-'))
    const image = join(dir, 'hero.png')
    writeFileSync(image, Buffer.from(makePng()))
    const cacheDir = join(dir, 'cache')
    const make = (): ReturnType<typeof ascii> => {
      const p = ascii({
        config: {
          profiles: { default: { font: FONT_PATH } },
          frames: { hero: { image, columns: 16, color: 'full' } },
        },
        cacheDir,
      })
      ;(p.configResolved as (c: { root: string }) => void)({ root: dir })
      return p
    }
    const cachePath = assetPathOf(await runHooks(make(), 'virtual:ascii-frame/hero', []))
    writeFileSync(cachePath, readFileSync(cachePath).subarray(0, 16))

    const rebuilt = assetPathOf(await runHooks(make(), 'virtual:ascii-frame/hero', []))
    expect(rebuilt).toBe(cachePath)
    const profile = decodeProfile(
      new Uint8Array(
        readFileSync(assetPathOf(await runHooks(make(), 'virtual:ascii-profile/default', []))),
      ),
    )
    expect(decodeFrame(new Uint8Array(readFileSync(rebuilt)), profile).columns).toBe(16)
  })
})
