// Fine-grained Shiki: only the grammars the export dialog can show, on the
// JS regex engine (no wasm). This whole module is dynamically imported, so
// none of it loads until the dialog first opens.
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

export type CodeToHtml = (code: string, opts: { lang: string }) => string

export async function makeCodeToHtml(): Promise<CodeToHtml> {
  const highlighter = await createHighlighterCore({
    themes: [import('shiki/themes/github-dark.mjs')],
    langs: [
      import('shiki/langs/tsx.mjs'),
      import('shiki/langs/vue.mjs'),
      import('shiki/langs/svelte.mjs'),
      import('shiki/langs/glimmer-js.mjs'),
      import('shiki/langs/javascript.mjs'),
    ],
    engine: createJavaScriptRegexEngine(),
  })
  return (code, { lang }) => highlighter.codeToHtml(code, { lang, theme: 'github-dark' })
}
