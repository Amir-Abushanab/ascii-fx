/** Integer luminance per ALGORITHM.md §2. Inputs and result in 0..255. */
export const luma8 = (r: number, g: number, b: number): number =>
  (77 * r + 150 * g + 29 * b + 128) >> 8

/** Pack RGBA into a u32 with little-endian byte order r,g,b,a (ALGORITHM.md §11). */
export const packRGBA = (r: number, g: number, b: number, a = 255): number =>
  (r | (g << 8) | (b << 16) | (a << 24)) >>> 0

export const unpackR = (c: number): number => c & 0xff
export const unpackG = (c: number): number => (c >>> 8) & 0xff
export const unpackB = (c: number): number => (c >>> 16) & 0xff
export const unpackA = (c: number): number => (c >>> 24) & 0xff

export const rgbHex = (c: number): string =>
  '#' +
  (c & 0xff).toString(16).padStart(2, '0') +
  ((c >>> 8) & 0xff).toString(16).padStart(2, '0') +
  ((c >>> 16) & 0xff).toString(16).padStart(2, '0')
