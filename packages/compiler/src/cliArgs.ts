/**
 * CLI argument parsing and validation, separate from cli.ts so it is testable
 * without spawning the built binary (the node suite runs before `pnpm build`
 * in CI, so dist/cli.js may not exist when tests do).
 *
 * Validators throw plain Errors; cli.ts's top-level catch prints the message
 * and exits 1. They exist because the underlying builders do not reject what
 * they cannot handle: an unknown --color used to encode a silently wrong
 * artifact and a non-numeric --columns an unloadable one, both with exit 0.
 */

import { parseArgs as nodeParseArgs } from 'node:util'

export interface Args {
  positional: string[]
  flags: Map<string, string | true>
}

/** Every flag the CLI takes. Anything else is a typo, and is refused as one. */
const VALUE_FLAGS = [
  'font',
  'out',
  'charset',
  'characters',
  'id',
  'face',
  'image',
  'profile',
  'columns',
  'rows',
  'color',
  'alpha',
] as const
const SWITCH_FLAGS = ['shape6', 'shape6-lut'] as const

const OPTIONS: Record<string, { type: 'string' | 'boolean' }> = Object.fromEntries([
  ...VALUE_FLAGS.map((name) => [name, { type: 'string' }] as const),
  ...SWITCH_FLAGS.map((name) => [name, { type: 'boolean' }] as const),
])

/**
 * Strict, through node's own parser. The hand-rolled one this replaces took any `--word`
 * as a flag: `--columns=160` became a switch named `columns=160`, and `--colums 160` a flag
 * nothing read — both built the default grid and exited 0, the silently wrong artifact the
 * validators below exist to prevent. Now `--flag=value` works, and an unknown flag, or a
 * valued flag with no value, is an error naming the flag.
 */
export function parseArgs(argv: string[]): Args {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: OPTIONS,
    strict: true,
    allowPositionals: true,
  })
  const flags = new Map<string, string | true>()
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') flags.set(key, value)
    else if (value === true) flags.set(key, true)
  }
  return { positional: positionals, flags }
}

export const str = (args: Args, key: string): string | undefined => {
  const v = args.flags.get(key)
  return typeof v === 'string' ? v : undefined
}

/** An enum-valued flag: anything outside `allowed` is an error, never a guess. */
export function enumFlag<T extends string>(
  key: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined
  if ((allowed as readonly string[]).includes(value)) return value as T
  throw new Error(
    `Invalid --${key} ${JSON.stringify(value)}: expected one of ${allowed.join(' | ')}.`,
  )
}

/** A grid-dimension flag: positive integers only — NaN and fractions reach typed-array sizes otherwise. */
export function positiveIntFlag(key: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid --${key} ${JSON.stringify(value)}: expected a positive integer.`)
  }
  return n
}
