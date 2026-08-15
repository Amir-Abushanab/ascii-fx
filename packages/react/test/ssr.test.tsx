// SSR safety (spec §18/§52): every component renders on the server with a
// layout-stable, accessible fallback and no browser globals.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { AsciiCanvas, AsciiImage, AsciiVideo } from '@ascii-fx/react'
import { STANDARD_SIX, makeProfile } from '../../core/test/synthetic.js'

const profile = makeProfile(STANDARD_SIX)

describe('React SSR', () => {
  it('runs without DOM globals', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  it('AsciiImage server-renders the accessible img fallback', () => {
    const html = renderToString(<AsciiImage src="/hero.jpg" alt="A portrait" profile={profile} columns={120} />)
    expect(html).toContain('<img')
    expect(html).toContain('alt="A portrait"')
    expect(html).toContain('src="/hero.jpg"')
    expect(html).toContain('<canvas')
    expect(html).toContain('aria-hidden')
  })

  it('AsciiImage supports decorative alt=""', () => {
    const html = renderToString(<AsciiImage src="/bg.png" alt="" profile={profile} />)
    expect(html).toContain('alt=""')
  })

  it('the spec §58 zero-config form server-renders without a profile', () => {
    const html = renderToString(<AsciiImage src="/cat.jpg" alt="Cat" />)
    expect(html).toContain('src="/cat.jpg"')
    expect(html).toContain('alt="Cat"')
  })

  it('AsciiVideo server-renders the video fallback', () => {
    const html = renderToString(<AsciiVideo src="/clip.mp4" profile={profile} poster="/poster.jpg" />)
    expect(html).toContain('<video')
    expect(html).toContain('poster="/poster.jpg"')
  })

  it('AsciiCanvas server-renders its wrapper', () => {
    const html = renderToString(<AsciiCanvas profile={profile} columns={80} />)
    expect(html).toContain('<canvas')
  })
})
