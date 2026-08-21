/**
 * "Copy for your agent" — the clipboard payload that hands the current playground setup to a
 * coding agent.
 *
 * Three parts: a task line, the snippet for the selected framework (so the agent reproduces THESE
 * dials rather than a generic example), and @ascii-fx's own skill doc as reference. The doc is the
 * exact `packages/core/skills/ascii-fx/SKILL.md` the published agent skill ships, inlined at build
 * time via `?raw` — so the button and the skill cannot drift, and there is no runtime fetch to
 * fail. Its YAML frontmatter is tooling metadata that reads as noise to an agent consuming the doc
 * as prose, so it is stripped.
 */
import skillDoc from '../../../../packages/core/skills/ascii-fx/SKILL.md?raw'
import { generateSnippet, type ExportState, type FrameworkId } from './exportSnippets'

const TASK = `Add ASCII FX to my site — the exact setup I configured in the playground.

1. Install the packages named in the snippet's first line.
2. Use the code under "WHAT I CONFIGURED" verbatim. Those options ARE the design — reproduce them
   exactly, don't re-tune them or "clean up" the values.
3. Swap the placeholder source for my own image/video, and give the canvas a real size (it fills
   its parent). The \`alt\` text is required on the React components.
4. Matching needs a compiled profile. If the snippet loads one from a URL, generate it with
   @ascii-fx/compiler or the @ascii-fx/vite plugin and serve it — see the reference below.

Use the reference below — @ascii-fx's own agent skill doc — for the entry point that fits my stack,
and for how profiles, colour modes and the emoji matcher work.`

/** Strip a leading `---\n…\n---` YAML frontmatter block. */
function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '')
}

/** Build the full agent brief. `target` picks which adapter the embedded snippet uses. */
export function buildAgentBrief(target: FrameworkId, state: ExportState): string {
  return [
    TASK,
    '--- WHAT I CONFIGURED ---',
    generateSnippet(target, state),
    '--- REFERENCE: the @ascii-fx agent skill ---',
    stripFrontmatter(skillDoc).trim(),
  ].join('\n\n')
}
