// "Export component" dialog: pick a framework, preview the generated snippet
// with syntax highlighting (Shiki, lazily loaded with a plain-text fallback),
// then copy or download. Native <dialog>, no modal infrastructure needed.
import { FRAMEWORKS, generateSnippet, type ExportState, type Framework } from './exportSnippets'

import type { CodeToHtml } from './highlight'

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
.export-component .hd h2 { margin: 0; font-size: 14px; color: #7c9cff; }
.export-component .hd select { font: inherit; background: #17171f; color: inherit; border: 1px solid #2c2c3a; border-radius: 6px; padding: 4px 8px; }
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
.export-component .ft button:hover { border-color: #7c9cff; }
.export-component .ft button.primary { background: #7c9cff; border-color: #7c9cff; color: #0b0b0f; font-weight: 600; }
`

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
    this.picker.addEventListener('change', () => {
      this.framework = FRAMEWORKS.find((f) => f.id === this.picker.value) ?? FRAMEWORKS[0]
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
    hd.append(h2, this.picker, spacer, close)

    this.codeBox = document.createElement('div')
    this.codeBox.className = 'code'

    const ft = document.createElement('div')
    ft.className = 'ft'
    const note = document.createElement('span')
    note.className = 'note'
    note.textContent = 'reproduces the current dials · swap in your own src'
    const ftSpacer = document.createElement('div')
    ftSpacer.className = 'spacer'
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
    ft.append(note, ftSpacer, download, copy)

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
