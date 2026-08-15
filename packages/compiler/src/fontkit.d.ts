declare module 'fontkit' {
  export interface FontPathCommand {
    command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath'
    args: number[]
  }
  export interface FontPath {
    commands: FontPathCommand[]
  }
  export interface FontGlyph {
    advanceWidth: number
    path: FontPath
  }
  export interface Font {
    unitsPerEm: number
    ascent: number
    descent: number
    lineGap: number
    familyName?: string
    postscriptName?: string
    'OS/2'?: { usWeightClass?: number }
    fonts?: Font[]
    hasGlyphForCodePoint(codePoint: number): boolean
    glyphForCodePoint(codePoint: number): FontGlyph
  }
  export function create(buffer: Uint8Array): Font
  const fontkit: { create(buffer: Uint8Array): Font }
  export default fontkit
}
