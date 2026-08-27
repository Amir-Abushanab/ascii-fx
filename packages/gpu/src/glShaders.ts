// GLSL ES 3.00 port of COMPOSITE_WGSL (shaders.ts). This is the same compositor
// the WebGPU backend runs, expressed in what WebGL2 has:
//
//   storage buffer `cells`   → usampler2D over an RGBA32UI texture
//   textureSampleLevel(…)    → textureLod(…)
//   @builtin(position)       → gl_FragCoord, which is y-UP where WGSL is y-down,
//                              so every use goes through `fragTop` below
//
// The arithmetic is otherwise line-for-line the WGSL. It has to be: the CPU
// backend's Canvas2D path approximates the interaction shaders at cell
// granularity, and this one is supposed to be the real thing.

export const COMPOSITE_VERT_GLSL = `#version 300 es
// Fullscreen triangle; no attributes, no buffers.
void main() {
  vec2 p = vec2(-1.0, -1.0);
  if (gl_VertexID == 1) p = vec2(3.0, -1.0);
  else if (gl_VertexID == 2) p = vec2(-1.0, 3.0);
  gl_Position = vec4(p, 0.0, 1.0);
}
`

export const COMPOSITE_FRAG_GLSL = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uCells;
uniform sampler2D uAtlas;
uniform sampler2D uAtlasRgba;
uniform sampler2D uSrc;

uniform uvec2 uGrid;          // cols, rows
uniform uvec4 uAtlasLayout;   // atlasCols, pitchW, pitchH, pad
uniform uvec2 uCell;          // cellW, cellH
uniform uint uColorMode;      // 0 mono, 1 foreground, 2 full, 3 glyph
uniform uint uUseBackdrop;
uniform uint uBackdrop;       // packed rgb
uniform vec2 uAtlasSize;
uniform vec2 uOrigin;
uniform vec2 uCellScreen;
uniform float uLod;
uniform vec4 uClearColor;
uniform vec2 uCanvas;         // device px, for the y flip

uniform uint uFxKind;         // 0 none, 1 reveal … 9 resolution
uniform vec2 uFxPointer;      // device px, top-left origin
uniform float uFxRadius;
uniform float uFxFeather;
uniform float uFxIntensity;
uniform float uFxTime;

out vec4 fragColor;

vec3 unpack3(uint c) {
  return vec3(float(c & 0xffu), float((c >> 8) & 0xffu), float((c >> 16) & 0xffu)) / 255.0;
}

float falloff(vec2 px) {
  float d = distance(px, uFxPointer);
  return 1.0 - smoothstep(max(uFxRadius - uFxFeather, 0.0), uFxRadius + uFxFeather, d);
}

void main() {
  // WGSL's @builtin(position) is top-left origin; gl_FragCoord is bottom-left.
  vec2 fragTop = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 pxe = fragTop;

  // Coordinate-space effects: warp the sampling position before grid mapping.
  if (uFxKind == 2u) { // displace
    float f = falloff(pxe) * uFxIntensity;
    pxe += vec2(
      sin(pxe.y * 0.11 + uFxTime * 2.0),
      cos(pxe.x * 0.13 + uFxTime * 2.0)
    ) * (f * uCellScreen.x * 0.8);
  } else if (uFxKind == 3u) { // wave
    pxe.x += sin(pxe.y / max(uCellScreen.y, 1.0) * 1.5 + uFxTime * 3.0) * uFxIntensity * uCellScreen.x * 0.6;
  } else if (uFxKind == 4u) { // push
    vec2 dv = pxe - uFxPointer;
    float d = max(length(dv), 0.001);
    float f = 1.0 - smoothstep(0.0, uFxRadius + uFxFeather, d);
    pxe -= dv / d * f * uFxIntensity * uFxRadius * 0.35;
  } else if (uFxKind == 9u) { // resolution (magnify)
    float f = falloff(pxe);
    float s = 1.0 + uFxIntensity * f;
    pxe = uFxPointer + (pxe - uFxPointer) / s;
  }

  vec2 px = pxe - uOrigin;
  vec2 cf = floor(px / uCellScreen);
  if (cf.x < 0.0 || cf.y < 0.0 || cf.x >= float(uGrid.x) || cf.y >= float(uGrid.y)) {
    fragColor = uClearColor;
    return;
  }
  uvec4 cell = texelFetch(uCells, ivec2(int(cf.x), int(cf.y)), 0);
  uint glyph = cell.x & 0xffffu;
  uint flags = cell.x >> 16;
  if ((flags & 2u) != 0u) {
    fragColor = vec4(0.0);
    return;
  }
  vec2 local = px / uCellScreen - cf; // 0..1 in cell

  // Glyph-local effects.
  if (uFxKind == 6u) { // glyph-scale
    float f = falloff(fragTop);
    float s = max(1.0 - 0.75 * uFxIntensity * f, 0.25);
    local = vec2(0.5) + (local - vec2(0.5)) * s;
  } else if (uFxKind == 7u) { // glyph-rotate
    float f = falloff(fragTop);
    float ang = uFxIntensity * f * 3.14159265;
    float c = cos(ang);
    float sn = sin(ang);
    vec2 p = local - vec2(0.5);
    local = vec2(0.5) + vec2(c * p.x - sn * p.y, sn * p.x + c * p.y);
  }

  vec2 tile = vec2(
    float((glyph % uAtlasLayout.x) * uAtlasLayout.y + uAtlasLayout.w),
    float((glyph / uAtlasLayout.x) * uAtlasLayout.z + uAtlasLayout.w)
  );
  float inset = 0.5 * exp2(uLod);
  vec2 texel = tile + clamp(
    local * vec2(uCell),
    vec2(inset),
    vec2(uCell) - vec2(inset)
  );
  vec2 uv = texel / uAtlasSize;

  vec4 outColor;
  if (uColorMode == 3u) {
    // chromatic-v1: the glyph carries its own colour, so there is nothing to tint.
    vec4 src = textureLod(uAtlasRgba, uv, uLod);
    if (uUseBackdrop == 0u) {
      outColor = vec4(src.rgb * src.a, src.a); // premultiplied
    } else {
      outColor = vec4(mix(unpack3(uBackdrop), src.rgb, src.a), 1.0);
    }
  } else {
    float a = textureLod(uAtlas, uv, uLod).r;
    vec3 fg = unpack3(cell.y);
    if ((uColorMode == 0u || uColorMode == 1u) && uUseBackdrop == 0u) {
      outColor = vec4(fg * a, a); // premultiplied
    } else {
      vec3 bg = unpack3(cell.z);
      if (uColorMode == 1u) {
        bg = unpack3(uBackdrop);
      }
      outColor = vec4(mix(bg, fg, a), 1.0);
    }
  }

  // Color-space effects.
  if (uFxKind == 1u || uFxKind == 8u) { // reveal / original-mix
    vec2 gridSize = vec2(float(uGrid.x) * uCellScreen.x, float(uGrid.y) * uCellScreen.y);
    vec2 uvSrc = clamp(px / gridSize, vec2(0.0), vec2(1.0));
    vec4 srcC = textureLod(uSrc, uvSrc, 0.0);
    float m = clamp(uFxIntensity, 0.0, 1.0);
    if (uFxKind == 1u) {
      m = falloff(fragTop) * m;
    }
    outColor = vec4(mix(outColor.rgb, srcC.rgb, m), max(outColor.a, m));
  } else if (uFxKind == 5u) { // color shift
    float f = clamp(falloff(fragTop) * uFxIntensity, 0.0, 1.0);
    outColor = vec4(mix(outColor.rgb, outColor.brg, f * 0.8), outColor.a);
  }
  fragColor = outColor;
}
`
