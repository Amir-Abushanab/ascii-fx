import type { AsciiProfile } from './types.js'
import type { AsciiFrame } from './frame.js'
import { decodeFrame } from './frameCodec.js'

export type FrameSource = string | URL | ArrayBuffer | Uint8Array | { url: string }

/** Resolve a precompiled .asciif (spec §16) against its profile. */
export async function loadFrame(source: FrameSource, profile: AsciiProfile): Promise<AsciiFrame> {
  if (source instanceof Uint8Array) return decodeFrame(source, profile)
  if (source instanceof ArrayBuffer) return decodeFrame(new Uint8Array(source), profile)
  const url = typeof source === 'string' ? source : source instanceof URL ? source.href : source.url
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load ASCII FX frame from ${url} (${res.status}). Is the .asciif asset deployed?`)
  }
  return decodeFrame(new Uint8Array(await res.arrayBuffer()), profile)
}
