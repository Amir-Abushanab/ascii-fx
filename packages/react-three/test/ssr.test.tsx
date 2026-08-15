// Import-level SSR safety: the R3F bindings must be importable server-side.
// (Headless R3F canvas rendering is out of scope for automated tests — the
// underlying AsciiPass is conformance-tested in packages/three.)
import { describe, expect, it } from 'vitest'

describe('@ascii-fx/react-three SSR', () => {
  it('imports without DOM globals', async () => {
    expect(typeof window).toBe('undefined')
    const mod = await import('../src/index.js')
    expect(typeof mod.AsciiEffect).toBe('function')
    expect(typeof mod.AsciiGlyphs).toBe('function')
    expect(typeof mod.useAsciiEffect).toBe('function')
  })
})
