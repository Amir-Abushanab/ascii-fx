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

export interface Args {
  positional: string[]
  flags: Map<string, string | true>
}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next)
        i++
      } else {
        flags.set(key, true)
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
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
