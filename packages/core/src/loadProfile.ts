import type { AsciiProfile } from './types.js'
import { decodeProfile } from './profileCodec.js'

/** Anything that can resolve to a profile: the object itself, raw bytes, or a URL. */
export type ProfileSource = AsciiProfile | string | URL | ArrayBuffer | Uint8Array | { url: string; id?: string }

const isProfile = (s: ProfileSource): s is AsciiProfile =>
  typeof s === 'object' && s !== null && 'glyphs' in s && 'structural' in s

const cache = new Map<string, Promise<AsciiProfile>>()

/**
 * Resolve a profile source (spec §17 virtual modules export `{ url, id }`).
 * URL fetches are cached per session. Call-time network only — SSR-safe import.
 */
export function loadProfile(source: ProfileSource): Promise<AsciiProfile> {
  if (isProfile(source)) return Promise.resolve(source)
  if (source instanceof Uint8Array) return Promise.resolve(decodeProfile(source))
  if (source instanceof ArrayBuffer) return Promise.resolve(decodeProfile(new Uint8Array(source)))
  const url = typeof source === 'string' ? source : source instanceof URL ? source.href : source.url
  let pending = cache.get(url)
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to load ASCII FX profile from ${url} (${res.status}). Is the .asciip asset deployed?`)
      }
      return decodeProfile(new Uint8Array(await res.arrayBuffer()))
    })
    pending.catch(() => cache.delete(url))
    cache.set(url, pending)
  }
  return pending
}
