import type { AsciiProfile, ProfileSource } from '@ascii-fx/core'
import type { AsciiRendererRuntimeOptions } from '@ascii-fx/gpu'

const binaryIds = new WeakMap<ArrayBuffer | Uint8Array, number>()
let nextBinaryId = 1

const binaryId = (source: ArrayBuffer | Uint8Array): number => {
  const existing = binaryIds.get(source)
  if (existing !== undefined) return existing
  const id = nextBinaryId++
  binaryIds.set(source, id)
  return id
}

/** Stable for semantic sources, identity-based for mutable binary inputs. */
export const profileSourceKey = (source: ProfileSource | null | undefined): string => {
  if (source == null) return 'null'
  if (typeof source === 'string') return `url:${source}`
  if (source instanceof URL) return `url:${source.href}`
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return `bytes:${binaryId(source)}`
  if ('url' in source && !('glyphs' in source)) return `url:${(source as { url: string }).url}`
  return `profile:${(source as AsciiProfile).fingerprint}`
}

/** Every runtime matcher/view option that can be changed without recreation. */
export const rendererOptionsKey = (options: AsciiRendererRuntimeOptions): string =>
  JSON.stringify([
    options.columns,
    options.rows,
    options.color,
    options.alpha,
    options.foreground,
    options.background,
    options.flatThreshold,
    options.fit,
    options.clearColor,
    options.temporal,
    options.adaptiveResolution,
  ])
