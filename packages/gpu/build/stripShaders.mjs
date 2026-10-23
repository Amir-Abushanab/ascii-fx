// Build-time shader compaction. The WGSL and GLSL sources live in template literals, and a JS
// minifier leaves string contents alone, so every comment and indent in them ships verbatim —
// about a quarter of this package's gzipped size. This drops `//` comments, indentation, and
// blank lines from the shader text only. Line breaks stay, so a GLSL `#version` or `#define`
// keeps its own line, and nothing outside the marked literals is touched.

/** One shader's text, compacted. `//` always starts a comment in both WGSL and GLSL. */
export function stripShaderText(text) {
  return text
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('//')
      return (comment === -1 ? line : line.slice(0, comment)).trim()
    })
    .filter((line) => line !== '')
    .join('\n')
}

// A shader literal is one tagged `/* wgsl */` or one opening with `#version 300 es`. Neither
// language has a backtick, so a literal's content runs to the next one; `${…}` interpolations
// inside are short identifiers and pass through untouched.
const SHADER_LITERAL = /(\/\* wgsl \*\/ `|`(?=#version 300 es))([^`]*)`/g

/** A source file with every shader literal in it compacted. */
export function stripShaderSource(source) {
  return source.replace(SHADER_LITERAL, (_, open, body) => `${open}${stripShaderText(body)}\``)
}

/** esbuild plugin applying stripShaderSource to the files that hold shaders. */
export const stripShadersPlugin = {
  name: 'strip-shaders',
  setup(build) {
    build.onLoad({ filter: /[/\\](shaders|glShaders)\.ts$/ }, async (args) => {
      const { readFile } = await import('node:fs/promises')
      return { contents: stripShaderSource(await readFile(args.path, 'utf8')), loader: 'ts' }
    })
  },
}
