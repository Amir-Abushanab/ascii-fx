import type { RawImage } from '@ascii-fx/core'
import { idiv, rdiv } from '@ascii-fx/core'

const make = (
  width: number,
  height: number,
  fn: (x: number, y: number) => [number, number, number],
): RawImage => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y)
      const p = (y * width + x) * 4
      data[p] = r
      data[p + 1] = g
      data[p + 2] = b
      data[p + 3] = 255
    }
  }
  return { width, height, data }
}

export const gradient = (w = 96, h = 64): RawImage =>
  make(w, h, (x) => {
    const v = rdiv(x * 255, w - 1)
    return [v, v, v]
  })

export const checker = (w = 96, h = 64): RawImage =>
  make(w, h, (x, y) => {
    const v = (idiv(x, 8) + idiv(y, 8)) % 2 === 0 ? 0 : 255
    return [v, v, v]
  })

export const circle = (w = 96, h = 64): RawImage => {
  const r2 = (2 * idiv(Math.min(w, h), 3)) ** 2
  return make(w, h, (x, y) => {
    const dx = 2 * x - (w - 1)
    const dy = 2 * y - (h - 1)
    const v = dx * dx + dy * dy <= r2 ? 255 : 0
    return [v, v, v]
  })
}

export const quadrants = (w = 96, h = 64): RawImage =>
  make(w, h, (x, y) => {
    const left = x < idiv(w, 2)
    const top = y < idiv(h, 2)
    if (top && left) return [200, 40, 40]
    if (top) return [40, 200, 40]
    if (left) return [40, 40, 200]
    return [230, 230, 230]
  })

export const GOLDEN_IMAGES: Record<string, RawImage> = {
  gradient: gradient(),
  checker: checker(),
  circle: circle(),
  quadrants: quadrants(),
}
