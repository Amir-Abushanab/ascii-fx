// RESULTS.md is the single source of truth for every benchmark number the docs
// site publishes, and more than one harness writes into it. Each harness owns
// exactly one `## ` section and must leave the others untouched, so replacement
// is bounded by the next same-level heading rather than truncating the tail.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const RESULTS_PATH = fileURLToPath(new URL('./RESULTS.md', import.meta.url))

/**
 * Replace the `## <heading>` section with `body`, appending it if absent.
 * Sections that follow are preserved verbatim.
 *
 * @param {string} heading Section heading including the leading `## `.
 * @param {string} body Full section text, starting with the heading itself.
 */
export async function upsertSection(heading, body) {
  const md = await readFile(RESULTS_PATH, 'utf8')
  const start = md.indexOf(heading)

  if (start === -1) {
    await writeFile(RESULTS_PATH, `${md.trimEnd()}\n\n${body.trimEnd()}\n`)
    return
  }

  // Bound the replacement at the next same-level heading so sibling sections
  // written by other harnesses survive.
  const after = md.indexOf('\n## ', start + heading.length)
  const tail = after === -1 ? '' : md.slice(after + 1)
  const head = md.slice(0, start)

  await writeFile(RESULTS_PATH, `${head}${body.trimEnd()}\n${tail ? `\n${tail}` : ''}`)
}

/** Render a markdown pipe table. `align` is one entry per column. */
export function markdownTable(headers, align, rows) {
  const sep = align.map((a) => (a === 'right' ? '---:' : a === 'center' ? ':---:' : '---'))
  return [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
}
