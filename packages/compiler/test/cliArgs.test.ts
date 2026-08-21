// The builders do not reject what they cannot handle — an unknown --color
// used to encode a silently wrong artifact (colorMode undefined → 0 → "mono"
// with orphaned color planes) and --columns abc an unloadable 0×0 file, both
// with exit 0 — so the CLI's flag validators are the only gate.
import { describe, expect, it } from 'vitest'
import { enumFlag, parseArgs, positiveIntFlag, str } from '../src/cliArgs.js'

describe('parseArgs', () => {
  it('separates positionals, valued flags, and boolean flags', () => {
    const a = parseArgs(['frame', 'build', '--image', 'x.png', '--shape6', '--out', 'y.asciif'])
    expect(a.positional).toEqual(['frame', 'build'])
    expect(str(a, 'image')).toBe('x.png')
    expect(a.flags.get('shape6')).toBe(true)
    expect(str(a, 'out')).toBe('y.asciif')
  })
})

describe('enumFlag', () => {
  it('passes known values through and leaves absent flags undefined', () => {
    expect(enumFlag('color', 'full', ['mono', 'foreground', 'full'])).toBe('full')
    expect(enumFlag('color', undefined, ['mono', 'foreground', 'full'])).toBeUndefined()
  })
  it('rejects typos instead of building a wrong artifact', () => {
    expect(() => enumFlag('color', 'fulll', ['mono', 'foreground', 'full'])).toThrow(
      /Invalid --color "fulll": expected one of mono \| foreground \| full/,
    )
    expect(() => enumFlag('alpha', 'masked', ['mask', 'ignore'])).toThrow(/Invalid --alpha/)
  })
})

describe('positiveIntFlag', () => {
  it('parses positive integers and leaves absent flags undefined', () => {
    expect(positiveIntFlag('columns', '120')).toBe(120)
    expect(positiveIntFlag('columns', undefined)).toBeUndefined()
  })
  it('rejects NaN, zero, negatives, and fractions', () => {
    for (const bad of ['abc', '0', '-4', '2.5', 'NaN', '']) {
      expect(() => positiveIntFlag('columns', bad), bad).toThrow(/expected a positive integer/)
    }
  })
})
