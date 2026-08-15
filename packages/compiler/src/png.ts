import { Buffer } from 'node:buffer'
import { PNG } from 'pngjs'
import type { RawImage } from '@ascii-fx/core'

export function decodePng(bytes: Uint8Array): RawImage {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length),
  }
}
