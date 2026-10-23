// The shipped shaders are the source ones with comments and whitespace removed by the build
// (build/stripShaders.mjs). The conformance suites run against src, so this is what proves the
// shipped text is the same program: the same tokens in the same order, on the same lines for
// anything a preprocessor reads.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stripShaderSource, stripShaderText } from '../build/stripShaders.mjs'

const read = (name: string): string =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

const LITERAL = /(\/\* wgsl \*\/ `|`(?=#version 300 es))([^`]*)`/g
const literals = (src: string): string[] => [...src.matchAll(LITERAL)].map((m) => m[2])
const tokens = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => (l.includes('//') ? l.slice(0, l.indexOf('//')) : l))
    .join('\n')
    .split(/\s+/)
    .filter(Boolean)

/** A source file with every shader literal replaced by a placeholder. */
const blank = (s: string): string => s.replace(LITERAL, '<shader>')

describe('shader stripping', () => {
  for (const [file, count] of [
    ['shaders.ts', 10],
    ['glShaders.ts', 2],
  ] as const) {
    it(`${file}: finds every shader and keeps every token`, () => {
      const src = read(file)
      const before = literals(src)
      const after = literals(stripShaderSource(src))
      expect(before).toHaveLength(count)
      expect(after).toHaveLength(count)
      for (let i = 0; i < count; i++) {
        expect(tokens(after[i])).toEqual(tokens(before[i]))
        expect(after[i]).not.toContain('//')
        expect(after[i].length).toBeLessThan(before[i].length)
      }
    })

    it(`${file}: leaves everything outside the shaders alone`, () => {
      const src = read(file)
      expect(blank(stripShaderSource(src))).toBe(blank(src))
    })
  }

  it('keeps a preprocessor directive on its own first line', () => {
    expect(stripShaderText('#version 300 es\n  // note\n  precision highp float; // x\n')).toBe(
      '#version 300 es\nprecision highp float;',
    )
  })
})
