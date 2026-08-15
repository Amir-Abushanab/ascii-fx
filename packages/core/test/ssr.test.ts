import { describe, expect, it } from 'vitest'
import { matchFrame, renderAscii } from '@ascii-fx/core'
import { STANDARD_SIX, makeCell, makeProfile } from './synthetic.js'

describe('SSR safety', () => {
  it('core imports and runs without any DOM globals', async () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    const profile = makeProfile(STANDARD_SIX)
    const raw = makeCell((_, j) => (j < 4 ? [0, 0, 0] : [255, 255, 255]))
    const frame = await renderAscii(raw, { profile, columns: 1, rows: 1 })
    expect(frame.toText()).toBe('▄')
    expect(matchFrame(raw, { profile, columns: 1, rows: 1 }).toText()).toBe('▄')
  })

  it('DOM sources in Node fail with a remediation message', async () => {
    const profile = makeProfile(STANDARD_SIX)
    await expect(renderAscii({} as never, { profile })).rejects.toThrow(/raw RGBA|ImageData/)
  })

  it('canvas2d entry imports cleanly during SSR', async () => {
    const mod = await import('../src/canvas2d.js')
    expect(typeof mod.renderFrameToCanvas).toBe('function')
  })
})
