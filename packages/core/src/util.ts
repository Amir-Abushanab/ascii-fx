// Integer arithmetic per ALGORITHM.md §0. Exact for |n| ≤ 2^52, 0 < d ≤ 2^32.

/** floor(n / d), d > 0, n ≥ 0. */
export const idiv = (n: number, d: number): number => Math.floor(n / d)

/** floor(n / d) toward −∞, any-sign n. */
export const fdiv = (n: number, d: number): number => Math.floor(n / d)

/** Round half up (toward +∞), d > 0, any-sign n. */
export const rdiv = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d))

export function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return (x * 0x01010101) >>> 24
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function align4(n: number): number {
  return (n + 3) & ~3
}
