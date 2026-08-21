// "Export component" dialog: pick a framework, preview the generated snippet
// with syntax highlighting (Shiki, lazily loaded with a plain-text fallback),
// then copy or download. Native <dialog>, no modal infrastructure needed.
import { FRAMEWORKS, generateSnippet, type ExportState, type Framework, type FrameworkId } from './exportSnippets'

import type { CodeToHtml } from './highlight'
import { buildAgentBrief } from './agentBrief'
import { createAgentCopyButton } from './agentCopyButton'

let highlighter: Promise<CodeToHtml> | null = null
const loadHighlighter = (): Promise<CodeToHtml> =>
  (highlighter ??= import('./highlight').then((m) => m.makeCodeToHtml()))

const STYLE = `
dialog.export-component {
  width: min(860px, 94vw); max-height: 88vh; padding: 0;
  border: 1px solid #2c2c3a; border-radius: 10px;
  background: #101018; color: #d6d6de;
  font: 13px 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
dialog.export-component::backdrop { background: rgba(0, 0, 0, 0.6); }
.export-component .hd { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #23232f; }
.export-component .hd h2 { margin: 0; font-size: 14px; color: #45e845; }
.export-component .hd select { font: inherit; background: #17171f; color: inherit; border: 1px solid #2c2c3a; border-radius: 6px; padding: 4px 8px; }
.export-component .hd .fw-mark { display: inline-flex; align-items: center; color: #45e845; margin-left: 2px; }
.export-component :where(select, button):focus-visible { outline: 2px solid #45e845; outline-offset: 2px; }
.export-component .hd .fw-mark svg { display: block; }
.export-component .hd .spacer { flex: 1; }
.export-component .x { background: none; border: none; color: #8a8a99; font-size: 17px; cursor: pointer; line-height: 1; }
.export-component .x:hover { color: #d6d6de; }
.export-component .code { margin: 12px 14px; border: 1px solid #23232f; border-radius: 8px; overflow: auto; max-height: 56vh; background: #0d1117; }
.export-component .code pre { margin: 0; padding: 12px 14px; overflow: auto; tab-size: 2; font-size: 12.5px; line-height: 1.55; }
.export-component .code pre:not(.shiki) { color: #d6d7db; white-space: pre; }
.export-component .ft { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid #23232f; }
.export-component .ft .note { color: #8a8a99; font-size: 12px; }
.export-component .ft .spacer { flex: 1; }
.export-component .ft button { font: inherit; padding: 5px 14px; border: 1px solid #2c2c3a; border-radius: 6px; background: #17171f; color: inherit; cursor: pointer; }
.export-component .ft button:hover { border-color: #45e845; }
.export-component .ft button.primary { background: #45e845; border-color: #45e845; color: #0b0b0f; font-weight: 600; }
`

/**
 * Framework marks for the picker. A native <option> can only hold text, so the
 * select keeps its own labels and the mark sits beside it, following the
 * selection — that keeps the control's keyboard and mobile behaviour rather
 * than reimplementing a listbox for the sake of six logos.
 *
 * Simplified to read at 16px and drawn in currentColor, like the section icons:
 * these are silhouettes, not brand-accurate reproductions.
 */
const MARKS: Record<FrameworkId, string> = {
  react:
    '<circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/>' +
    '<ellipse cx="12" cy="12" rx="10" ry="3.9"/>' +
    '<ellipse cx="12" cy="12" rx="10" ry="3.9" transform="rotate(60 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="10" ry="3.9" transform="rotate(120 12 12)"/>',
  // Stacked lozenges, the shape Solid's mark reduces to.
  solid:
    '<ellipse cx="12" cy="6.6" rx="9" ry="3.1" transform="rotate(-12 12 6.6)"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="3.1" transform="rotate(-12 12 12)"/>' +
    '<ellipse cx="12" cy="17.4" rx="9" ry="3.1" transform="rotate(-12 12 17.4)"/>',
  vue: '<path d="M1.8 3.6h4.6L12 13.2l5.6-9.6h4.6L12 21Z"/><path d="M7.9 3.6h3.0L12 5.6l1.1-2h3.0"/>',
  // One stroke: the slanted S the Svelte logo is built around.
  svelte: '<path d="M16.4 4.3 8.9 8.9a3.4 3.4 0 0 0 3.5 5.8l-.8.5a3.4 3.4 0 0 0 3.5 5.8l7.5-4.6"/>',
  ember: '<circle cx="12" cy="12" r="9.2"/><path d="M7.6 12.6h6.1a2.5 2.5 0 1 0-4.9-.9c-.5 3 1 5 3.4 5 1.4 0 2.6-.5 3.8-1.4"/>',
  wc: '<path d="M9.4 7.4 4.6 12l4.8 4.6"/><path d="M14.6 7.4 19.4 12l-4.8 4.6"/><path d="M13.2 5.2 10.8 18.8"/>',
}

/** Wrap one mark's body in the shared 24-grid frame. */
function markSvg(id: FrameworkId): string {
  return (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MARKS[id]}</svg>`
  )
}

export class ExportComponentDialog {
  private readonly dialog: HTMLDialogElement
  private readonly codeBox: HTMLDivElement
  private readonly picker: HTMLSelectElement
  private framework: Framework = FRAMEWORKS[0]
  private rawCode = ''
  private renderToken = 0

  constructor(private readonly getState: () => ExportState) {
    if (!document.getElementById('export-component-style')) {
      const style = document.createElement('style')
      style.id = 'export-component-style'
      style.textContent = STYLE
      document.head.appendChild(style)
    }
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'export-component'

    const hd = document.createElement('div')
    hd.className = 'hd'
    const h2 = document.createElement('h2')
    h2.textContent = 'Export component'
    this.picker = document.createElement('select')
    for (const f of FRAMEWORKS) {
      const opt = document.createElement('option')
      opt.value = f.id
      opt.textContent = f.label
      this.picker.appendChild(opt)
    }
    const mark = document.createElement('span')
    mark.className = 'fw-mark'
    mark.innerHTML = markSvg(this.framework.id)
    this.picker.addEventListener('change', () => {
      this.framework = FRAMEWORKS.find((f) => f.id === this.picker.value) ?? FRAMEWORKS[0]
      mark.innerHTML = markSvg(this.framework.id)
      this.renderSnippet()
    })
    const spacer = document.createElement('div')
    spacer.className = 'spacer'
    const close = document.createElement('button')
    close.className = 'x'
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '✕'
    close.addEventListener('click', () => this.dialog.close())
    hd.append(h2, mark, this.picker, spacer, close)

    this.codeBox = document.createElement('div')
    this.codeBox.className = 'code'

    const ft = document.createElement('div')
    ft.className = 'ft'
    const note = document.createElement('span')
    note.className = 'note'
    note.textContent = 'reproduces the current dials · swap in your own src'
    const ftSpacer = document.createElement('div')
    ftSpacer.className = 'spacer'
    // Reads the dials at click time, like the other footer buttons, so the brief
    // matches whatever is on screen rather than whatever opened the dialog.
    const agent = createAgentCopyButton(() => buildAgentBrief(this.framework.id, this.getState()))
    const download = this.button('Download file', () => this.downloadFile())
    const copy = this.button('Copy', async (btn) => {
      try {
        await navigator.clipboard.writeText(this.rawCode)
        this.flash(btn, 'Copied ✓')
      } catch {
        this.flash(btn, 'Copy failed')
      }
    })
    copy.classList.add('primary')
    ft.append(note, ftSpacer, agent, download, copy)

    this.dialog.append(hd, this.codeBox, ft)
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close()
    })
    document.body.appendChild(this.dialog)
  }

  show(): void {
    this.renderSnippet()
    this.dialog.showModal()
  }

  /** The framework currently selected in the picker, for callers building their own payload. */
  currentFramework(): FrameworkId {
    return this.framework.id
  }

  private renderSnippet(): void {
    this.rawCode = generateSnippet(this.framework.id, this.getState())
    // Plain text immediately; swap in the highlighted HTML when Shiki resolves.
    const pre = document.createElement('pre')
    pre.textContent = this.rawCode
    this.codeBox.replaceChildren(pre)
    const token = ++this.renderToken
    const { lang } = this.framework
    const code = this.rawCode
    void loadHighlighter()
      .then((codeToHtml) => {
        if (token === this.renderToken) this.codeBox.innerHTML = codeToHtml(code, { lang })
      })
      .catch(() => {
        // keep the plain-text fallback (unknown grammar or Shiki load failure)
      })
  }

  private downloadFile(): void {
    const url = URL.createObjectURL(new Blob([this.rawCode], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = this.framework.file
    a.click()
    URL.revokeObjectURL(url)
  }

  private flash(btn: HTMLButtonElement, text: string): void {
    const original = btn.textContent
    btn.textContent = text
    setTimeout(() => {
      btn.textContent = original
    }, 1200)
  }

  private button(label: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.addEventListener('click', () => onClick(b))
    return b
  }
}
