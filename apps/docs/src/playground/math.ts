// The explainer's formulas mirror ALGORITHM.md, so they are written as TeX in
// the markup (`data-tex`) and typeset with KaTeX at load. Keeping the source as
// TeX rather than hand-written MathML means a formula here stays diffable
// against the spec it came from.
import katex from 'katex'
// KaTeX's stylesheet; importing it for its side effect is how the bundler is told the
// typeset markup needs it.
// eslint-disable-next-line import/no-unassigned-import
import 'katex/dist/katex.min.css'

/**
 * Typeset every `[data-tex]` element under `root`. Elements keep their TeX in
 * the attribute, so this is idempotent — re-running re-renders from source
 * rather than from already-typeset output.
 */
export function renderMath(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-tex]')) {
    const tex = el.dataset.tex
    if (!tex) continue
    // katex is a CJS namespace: `render` is only reachable off the default export,
    // not as a named import.
    // eslint-disable-next-line import/no-named-as-default-member
    katex.render(tex, el, {
      displayMode: el.tagName === 'DIV',
      throwOnError: false,
      // The formulas are integer arithmetic; \operatorname names like rdiv and
      // popcount are ours, not TeX built-ins.
      trust: false,
      output: 'html',
    })
  }
}
