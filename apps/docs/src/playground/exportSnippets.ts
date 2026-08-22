// "Export component": turn the playground's current dials into a copy-paste
// component for each framework. Snippets embed only the diff from the library
// defaults, so they stay minimal and reproduce exactly what's on screen.

export type FrameworkId = 'react' | 'solid' | 'vue' | 'svelte' | 'ember' | 'wc'

export interface Framework {
  id: FrameworkId
  label: string
  /** Shiki language id (falls back to plain text if unavailable). */
  lang: string
  file: string
}

export const FRAMEWORKS: Framework[] = [
  { id: 'react', label: 'React', lang: 'tsx', file: 'AsciiArt.tsx' },
  { id: 'solid', label: 'Solid', lang: 'tsx', file: 'AsciiArt.tsx' },
  { id: 'vue', label: 'Vue', lang: 'vue', file: 'AsciiArt.vue' },
  { id: 'svelte', label: 'Svelte', lang: 'svelte', file: 'AsciiArt.svelte' },
  { id: 'ember', label: 'Ember (Octane)', lang: 'glimmer-js', file: 'ascii-art.gjs' },
  { id: 'wc', label: 'Web Component', lang: 'javascript', file: 'ascii-art.js' },
]

export interface ExportState {
  font: { kind: 'geist' } | { kind: 'system'; family: string } | { kind: 'upload'; family: string }
  /** Restrict matching to these characters (subset of the charset). */
  characters?: string
  /** Only when the user forced a backend (auto is the default). */
  backend?: 'webgpu' | 'cpu'
  /** Renderer options that differ from library defaults. */
  options: Record<string, unknown>
  /** Interaction with non-default fields only; null when none. */
  interaction: Record<string, unknown> | null
}

const literal = (value: unknown): string =>
  JSON.stringify(value)?.replaceAll('"', "'") ?? 'undefined'

/** Single-line `{ key: value, … }`; '{}' when empty. */
const inlineObject = (entries: Record<string, unknown>): string => {
  const keys = Object.keys(entries)
  if (keys.length === 0) return '{}'
  return `{ ${keys.map((k) => `${k}: ${literal(entries[k])}`).join(', ')} }`
}

interface ProfileSnippet {
  imports: string[]
  /** Setup lines (comments, font registration) before the profile expression. */
  pre: string[]
  /** Awaitable expression producing the profile. */
  expr: string
  /** Statement(s) producing `const profile = …` (await-able context). */
  code: string[]
}

function profileSnippet(state: ExportState): ProfileSnippet {
  const chars = state.characters
  const runtimeOpts = (family: string): string =>
    `{ fontFamily: ${literal(family)}${chars ? `, characters: ${literal(chars)}` : ''} }`
  let snippet: Omit<ProfileSnippet, 'code'>
  switch (state.font.kind) {
    case 'geist':
      snippet = {
        imports: chars ? ['loadProfile', 'subsetProfile'] : ['loadProfile'],
        pre: [
          '// compile yours: `ascii-fx profile build --font X.ttf --out default.asciip` or the @ascii-fx/vite plugin',
        ],
        expr: chars
          ? `loadProfile('/default.asciip').then((p) => subsetProfile(p, ${literal(chars)}))`
          : `loadProfile('/default.asciip')`,
      }
      break
    case 'system':
      snippet = {
        imports: ['createAsciiProfile'],
        pre: [
          '// runtime profile from an installed font (browser-rasterized; precompile for determinism)',
        ],
        expr: `createAsciiProfile(${runtimeOpts(state.font.family)})`,
      }
      break
    case 'upload':
      snippet = {
        imports: ['createAsciiProfile'],
        pre: [
          '// register your font file first, then profile it at runtime:',
          `const face = new FontFace(${literal(state.font.family)}, await (await fetch('/your-font.woff2')).arrayBuffer())`,
          'document.fonts.add(await face.load())',
        ],
        expr: `createAsciiProfile(${runtimeOpts(state.font.family)})`,
      }
      break
  }
  return { ...snippet, code: [...snippet.pre, `const profile = await ${snippet.expr}`] }
}

/** The framework-agnostic mount body used by the non-React wrappers. */
function mountLines(state: ExportState): string[] {
  const profile = profileSnippet(state)
  const rendererOpts: string[] = ['canvas', 'profile']
  if (state.backend) rendererOpts.push(`backend: ${literal(state.backend)}`)
  for (const [k, v] of Object.entries(state.options)) rendererOpts.push(`${k}: ${literal(v)}`)
  // Assignment (not declaration): every wrapper declares `let renderer` in an
  // outer scope so its cleanup can reach it.
  const lines = [
    ...profile.code,
    `renderer = await createAsciiRenderer({ ${rendererOpts.join(', ')} })`,
    '',
    'const img = new Image()',
    "img.src = '/your-image.jpg' // any image/video/canvas source works",
    'await img.decode()',
    'renderer.setSource(img)',
    'renderer.render()',
  ]
  if (state.interaction) {
    lines.push(
      '',
      `renderer.setInteraction(${inlineObject(state.interaction)})`,
      "canvas.addEventListener('pointermove', (e) => {",
      '  const r = canvas.getBoundingClientRect()',
      '  renderer.pointer.set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)',
      '})',
    )
  }
  return lines
}

const coreImports = (state: ExportState): string => {
  const profile = profileSnippet(state)
  return `import { createAsciiRenderer } from '@ascii-fx/gpu'\nimport { ${profile.imports.join(', ')} } from '@ascii-fx/core'`
}

const indentBlock = (lines: string[], indent: number): string =>
  lines.map((l) => (l === '' ? '' : ' '.repeat(indent) + l)).join('\n')

export function generateSnippet(target: FrameworkId, state: ExportState): string {
  const install = '// pnpm add @ascii-fx/gpu @ascii-fx/core'

  if (target === 'react') {
    const props: string[] = []
    if (state.backend) props.push(`backend=${literal(state.backend)}`)
    for (const [k, v] of Object.entries(state.options)) props.push(`${k}={${literal(v)}}`)
    if (state.interaction) props.push(`interaction={${inlineObject(state.interaction)}}`)
    const propLines = props.map((p) => `      ${p}`).join('\n')
    const profile = profileSnippet(state)
    if (state.font.kind === 'geist' && !state.characters) {
      return `// pnpm add @ascii-fx/react @ascii-fx/gpu @ascii-fx/core
import { AsciiImage } from '@ascii-fx/react'

export default function AsciiArt() {
  return (
    <AsciiImage
      src="/your-image.jpg"
      alt="Describe the image"
      profile={{ url: '/default.asciip' }}
${propLines ? propLines + '\n' : ''}    />
  )
}`
    }
    return `// pnpm add @ascii-fx/react @ascii-fx/gpu @ascii-fx/core
import { useEffect, useState } from 'react'
import { AsciiImage } from '@ascii-fx/react'
import { ${profile.imports.join(', ')}, type AsciiProfile } from '@ascii-fx/core'

export default function AsciiArt() {
  const [profile, setProfile] = useState<AsciiProfile>()
  useEffect(() => {
    void (async () => {
${indentBlock(profile.pre, 6)}
      setProfile(await ${profile.expr})
    })()
  }, [])
  if (!profile) return null
  return (
    <AsciiImage
      src="/your-image.jpg"
      alt="Describe the image"
      profile={profile}
${propLines ? propLines + '\n' : ''}    />
  )
}`
  }

  if (target === 'solid') {
    return `${install}
import { onCleanup, onMount } from 'solid-js'
${coreImports(state)}

export default function AsciiArt() {
  let canvas!: HTMLCanvasElement
  onMount(() => {
    let renderer: Awaited<ReturnType<typeof createAsciiRenderer>> | undefined
    let disposed = false
    void (async () => {
${indentBlock(mountLines(state), 6)}
      if (disposed) renderer?.destroy()
    })()
    onCleanup(() => {
      disposed = true
      renderer?.destroy()
    })
  })
  return <canvas ref={canvas} style={{ width: '100%', 'aspect-ratio': '16 / 9' }} />
}`
  }

  if (target === 'vue') {
    return `<!-- pnpm add @ascii-fx/gpu @ascii-fx/core -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
${coreImports(state)}

const canvasRef = ref<HTMLCanvasElement>()
let renderer: Awaited<ReturnType<typeof createAsciiRenderer>> | undefined

onMounted(async () => {
  const canvas = canvasRef.value!
${indentBlock(mountLines(state), 2)}
})
onUnmounted(() => renderer?.destroy())
</script>

<template>
  <canvas ref="canvasRef" style="width: 100%; aspect-ratio: 16 / 9"></canvas>
</template>`
  }

  if (target === 'svelte') {
    return `<!-- pnpm add @ascii-fx/gpu @ascii-fx/core -->
<script lang="ts">
${coreImports(state)}

  let canvas: HTMLCanvasElement

  $effect(() => {
    let renderer: Awaited<ReturnType<typeof createAsciiRenderer>> | undefined
    let disposed = false
    void (async () => {
${indentBlock(mountLines(state), 6)}
      if (disposed) renderer?.destroy()
    })()
    return () => {
      disposed = true
      renderer?.destroy()
    }
  })
</script>

<canvas bind:this={canvas} style="width: 100%; aspect-ratio: 16 / 9"></canvas>`
  }

  if (target === 'ember') {
    return `${install} ember-modifier
import Component from '@glimmer/component'
import { modifier } from 'ember-modifier'
${coreImports(state)}

export default class AsciiArt extends Component {
  attach = modifier((canvas) => {
    let renderer
    let disposed = false
    void (async () => {
${indentBlock(mountLines(state), 6)}
      if (disposed) renderer?.destroy()
    })()
    return () => {
      disposed = true
      renderer?.destroy()
    }
  })

  <template>
    <canvas {{this.attach}} style="width: 100%; aspect-ratio: 16 / 9"></canvas>
  </template>
}`
  }

  // Web component (plain JS)
  return `${install}
${coreImports(state)}

class AsciiArtElement extends HTMLElement {
  async connectedCallback() {
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:100%;aspect-ratio:16/9'
    this.attachShadow({ mode: 'open' }).append(canvas)
    let renderer
${indentBlock(mountLines(state), 4)}
    this.renderer = renderer
  }
  disconnectedCallback() {
    this.renderer?.destroy()
  }
}
customElements.define('ascii-art', AsciiArtElement)
// <ascii-art></ascii-art>`
}
