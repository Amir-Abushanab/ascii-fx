// WGSL implementing ALGORITHM.md exactly. All matcher arithmetic is u32/i32;
// workgroup atomics are associative integer ops, so reduction order can never
// change a result. Any deviation from the CPU reference is a bug here.

/** Max glyphs supported by the GPU matcher (workgroup memory bound). */
export const MAX_GPU_GLYPHS = 2048

const COMMON = /* wgsl */ `
struct Params {
  srcW: u32,
  srcH: u32,
  cols: u32,
  rows: u32,
  glyphCount: u32,
  colorMode: u32,      // 0 mono, 1 foreground, 2 full
  inkLight: u32,
  flatThreshold: u32,
  alphaMask: u32,      // 1 = alpha 'mask'
  blankId: u32,
  fgColor: u32,        // packed r|g<<8|b<<16
  bgColor: u32,
  srgbEncode: u32,     // 1 = source texels are linear; encode to sRGB before quantization (Three RTs, §28)
  baseCol: u32,        // dirty-rect dispatch offset (cells)
  baseRow: u32,
  temporal: u32,       // 1 = prevReduced holds last frame's samples; identical cells skip (spec §21, exact)
  hysteresisMilli: u32, // chromatic-v1 §C5, in thousandths; 0 = off
  covMax: u32,         // densest glyph's coverage (§6); the flat ramp's ceiling
}

fn luma8(r: u32, g: u32, b: u32) -> u32 {
  return (77u * r + 150u * g + 29u * b + 128u) >> 8u;
}

fn rdivU(n: u32, d: u32) -> u32 {
  return (2u * n + d) / (2u * d);
}

fn srgbEncode1(v: f32) -> f32 {
  if (v <= 0.0031308) {
    return v * 12.92;
  }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}
`

export const REDUCE_WGSL = /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> reduced: array<u32>;

// reduce-v1: one thread per output sample; a workgroup covers one cell's 8×8.
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let SW = P.cols * 8u;
  let SH = P.rows * 8u;
  let gx = gid.x + P.baseCol * 8u;
  let gy = gid.y + P.baseRow * 8u;
  let x0 = (gx * P.srcW) / SW;
  let x1 = max(x0 + 1u, ((gx + 1u) * P.srcW) / SW);
  let y0 = (gy * P.srcH) / SH;
  let y1 = max(y0 + 1u, ((gy + 1u) * P.srcH) / SH);
  var sr = 0u;
  var sg = 0u;
  var sb = 0u;
  var sa = 0u;
  var n = 0u;
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) {
      var c = textureLoad(srcTex, vec2<u32>(x, y), 0);
      if (P.srgbEncode == 1u) {
        c = vec4<f32>(srgbEncode1(c.r), srgbEncode1(c.g), srgbEncode1(c.b), c.a);
      }
      let r = u32(round(c.r * 255.0));
      let g = u32(round(c.g * 255.0));
      let b = u32(round(c.b * 255.0));
      var a = 255u;
      if (P.alphaMask == 1u) {
        a = u32(round(c.a * 255.0));
      }
      sr += r * a;
      sg += g * a;
      sb += b * a;
      sa += a;
      n += 1u;
    }
  }
  var outv = 0u;
  if (sa > 0u) {
    outv = rdivU(sr, sa) | (rdivU(sg, sa) << 8u) | (rdivU(sb, sa) << 16u) | (rdivU(sa, n) << 24u);
  }
  reduced[gy * SW + gx] = outv;
}
`

export const FEATURES_WGSL = /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> reduced: array<u32>;
@group(0) @binding(2) var<storage, read_write> features: array<vec4<u32>>;

var<workgroup> wMinKey: atomic<u32>;
var<workgroup> wMaxKey: atomic<u32>;
var<workgroup> wSumR: atomic<u32>;
var<workgroup> wSumG: atomic<u32>;
var<workgroup> wSumB: atomic<u32>;
var<workgroup> wSumL: atomic<u32>;
var<workgroup> wSumA: atomic<u32>;
var<workgroup> wMaskLo: atomic<u32>;
var<workgroup> wMaskHi: atomic<u32>;

// Cell features (ALGORITHM.md §5, §7): one workgroup per cell, lane k = sample k.
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) k: u32) {
  if (k == 0u) {
    atomicStore(&wMinKey, 0xffffffffu);
    atomicStore(&wMaxKey, 0u);
    atomicStore(&wSumR, 0u);
    atomicStore(&wSumG, 0u);
    atomicStore(&wSumB, 0u);
    atomicStore(&wSumL, 0u);
    atomicStore(&wSumA, 0u);
    atomicStore(&wMaskLo, 0u);
    atomicStore(&wMaskHi, 0u);
  }
  workgroupBarrier();

  let SW = P.cols * 8u;
  let cellX = wg.x + P.baseCol;
  let cellY = wg.y + P.baseRow;
  let base = (cellY * 8u) * SW + cellX * 8u;
  let s = reduced[base + (k / 8u) * SW + (k % 8u)];
  let r = s & 0xffu;
  let g = (s >> 8u) & 0xffu;
  let b = (s >> 16u) & 0xffu;
  let a = (s >> 24u) & 0xffu;
  let l = luma8(r, g, b);
  // (luma, index) keys: ties resolve to the lowest sample index.
  atomicMin(&wMinKey, (l << 6u) | k);
  atomicMax(&wMaxKey, (l << 6u) | (63u - k));
  atomicAdd(&wSumR, r);
  atomicAdd(&wSumG, g);
  atomicAdd(&wSumB, b);
  atomicAdd(&wSumL, l);
  atomicAdd(&wSumA, a);
  workgroupBarrier();

  let minKey = atomicLoad(&wMinKey);
  let maxKey = atomicLoad(&wMaxKey);
  let minIdx = minKey & 63u;
  let maxIdx = 63u - (maxKey & 63u);
  let dS = reduced[base + (minIdx / 8u) * SW + (minIdx % 8u)];
  let lS = reduced[base + (maxIdx / 8u) * SW + (maxIdx % 8u)];
  let dr = i32(r) - i32(dS & 0xffu);
  let dg = i32(g) - i32((dS >> 8u) & 0xffu);
  let db = i32(b) - i32((dS >> 16u) & 0xffu);
  let lr = i32(r) - i32(lS & 0xffu);
  let lg = i32(g) - i32((lS >> 8u) & 0xffu);
  let lb = i32(b) - i32((lS >> 16u) & 0xffu);
  let dd = dr * dr + dg * dg + db * db;
  let dl = lr * lr + lg * lg + lb * lb;
  if (dd <= dl) {
    if (k < 32u) {
      atomicOr(&wMaskLo, 1u << k);
    } else {
      atomicOr(&wMaskHi, 1u << (k - 32u));
    }
  }
  workgroupBarrier();

  if (k == 0u) {
    let minL = minKey >> 6u;
    let maxL = maxKey >> 6u;
    let cellA = rdivU(atomicLoad(&wSumA), 64u);
    var flags = 0u;
    if (P.alphaMask == 1u && cellA < 128u) {
      flags = 2u; // TRANSPARENT
    } else if (maxL - minL < P.flatThreshold) {
      flags = 1u; // FLAT
    }
    let meanR = rdivU(atomicLoad(&wSumR), 64u);
    let meanG = rdivU(atomicLoad(&wSumG), 64u);
    let meanB = rdivU(atomicLoad(&wSumB), 64u);
    let meanL = rdivU(atomicLoad(&wSumL), 64u);
    features[cellY * P.cols + cellX] = vec4<u32>(
      atomicLoad(&wMaskLo),
      atomicLoad(&wMaskHi),
      meanR | (meanG << 8u) | (meanB << 16u) | (meanL << 24u),
      flags,
    );
  }
}
`

export const matchWgsl = (maxGlyphs: number): string => /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> reduced: array<u32>;
@group(0) @binding(2) var<storage, read> features: array<vec4<u32>>;
@group(0) @binding(3) var<storage, read> masks: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read> coverage: array<u32>;
@group(0) @binding(5) var<storage, read_write> cells: array<vec4<u32>>;
@group(0) @binding(6) var<storage, read> prevReduced: array<u32>;

var<workgroup> wSame: atomic<u32>;
var<workgroup> wSameFlag: u32;
var<workgroup> wFlags: u32;
var<workgroup> wMaskS: vec2<u32>;
var<workgroup> wMean: u32;
var<workgroup> wScores: array<u32, ${maxGlyphs}>;
var<workgroup> wCand: array<u32, 8>;
var<workgroup> wCandCount: u32;
var<workgroup> wKey: atomic<u32>;
var<workgroup> wInkR: atomic<u32>;
var<workgroup> wInkG: atomic<u32>;
var<workgroup> wInkB: atomic<u32>;
var<workgroup> wInkN: atomic<u32>;
var<workgroup> wOffR: atomic<u32>;
var<workgroup> wOffG: atomic<u32>;
var<workgroup> wOffB: atomic<u32>;
var<workgroup> wOffN: atomic<u32>;
var<workgroup> wErr: atomic<u32>;
var<workgroup> wFg: u32;
var<workgroup> wBg: u32;
var<workgroup> wBestErr: u32;
var<workgroup> wBestId: u32;
var<workgroup> wBestFg: u32;
var<workgroup> wBestBg: u32;

// Prefilter + exact rerank (ALGORITHM.md §6, §9, §10): one workgroup per cell.
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) k: u32) {
  let cellX = wg.x + P.baseCol;
  let cellY = wg.y + P.baseRow;
  let ci = cellY * P.cols + cellX;

  // Exact temporal reuse (spec §21): if every source sample byte of this cell
  // is unchanged since the previous match with identical options, the cells
  // buffer already holds the exact result — skip all work.
  if (P.temporal == 1u) {
    if (k == 0u) {
      atomicStore(&wSame, 0u);
    }
    workgroupBarrier();
    let sIdx = (cellY * 8u + k / 8u) * (P.cols * 8u) + cellX * 8u + (k % 8u);
    if (reduced[sIdx] == prevReduced[sIdx]) {
      atomicAdd(&wSame, 1u);
    }
    workgroupBarrier();
    if (k == 0u) {
      wSameFlag = 0u;
      if (atomicLoad(&wSame) == 64u) {
        wSameFlag = 1u;
      }
    }
    workgroupBarrier();
    if (workgroupUniformLoad(&wSameFlag) == 1u) {
      return;
    }
  }

  if (k == 0u) {
    let f = features[ci];
    wMaskS = vec2<u32>(f.x, f.y);
    wMean = f.z;
    wFlags = f.w;
  }
  workgroupBarrier();
  let flags = workgroupUniformLoad(&wFlags);

  if ((flags & 2u) != 0u) { // transparent
    if (k == 0u) {
      cells[ci] = vec4<u32>(P.blankId | (flags << 16u), 0u, 0u, 0u);
    }
    return;
  }

  if ((flags & 1u) != 0u) { // flat (§6)
    let mean = workgroupUniformLoad(&wMean);
    let meanColor = mean & 0x00ffffffu;
    if (P.colorMode == 2u) {
      if (k == 0u) {
        cells[ci] = vec4<u32>(P.blankId | (flags << 16u), meanColor, meanColor, 0u);
      }
      return;
    }
    if (k == 0u) {
      atomicStore(&wKey, 0xffffffffu);
    }
    workgroupBarrier();
    let meanL = mean >> 24u;
    var lumaIn = meanL;
    if (P.inkLight == 0u) {
      lumaIn = 255u - meanL;
    }
    let covTarget = rdivU(lumaIn * P.covMax, 255u);
    for (var g = k; g < P.glyphCount; g += 64u) {
      let cov = coverage[g];
      let diff = max(cov, covTarget) - min(cov, covTarget);
      atomicMin(&wKey, diff * 65536u + g); // unique keys ⇒ lowest (diff, id)
    }
    workgroupBarrier();
    if (k == 0u) {
      let id = atomicLoad(&wKey) & 0xffffu;
      var fg = P.fgColor;
      if (P.colorMode == 1u) {
        fg = meanColor;
      }
      cells[ci] = vec4<u32>(id | (flags << 16u), fg, P.bgColor, 0u);
    }
    return;
  }

  // Structural path. Polarity (§8): matchMask for mono/foreground; raw for full.
  let m = workgroupUniformLoad(&wMaskS);
  var s = m;
  if (P.colorMode != 2u && P.inkLight == 1u) {
    s = vec2<u32>(~m.x, ~m.y);
  }

  // Prefilter (§9): Hamming scores for all glyphs.
  for (var g = k; g < P.glyphCount; g += 64u) {
    let gm = masks[g];
    var d = countOneBits(s.x ^ gm.x) + countOneBits(s.y ^ gm.y);
    if (P.colorMode == 2u) {
      d = min(d, 64u - d);
    }
    wScores[g] = d;
  }
  workgroupBarrier();

  // Top-8 = the 8 smallest (score, id) keys, selected in id order (§9).
  if (k == 0u) {
    var count = 0u;
    for (var g = 0u; g < P.glyphCount; g++) {
      let key = (wScores[g] << 16u) | g;
      if (count < 8u) {
        var pos = count;
        while (pos > 0u && wCand[pos - 1u] > key) {
          wCand[pos] = wCand[pos - 1u];
          pos -= 1u;
        }
        wCand[pos] = key;
        count += 1u;
      } else if (key < wCand[7u]) {
        var pos = 7u;
        while (pos > 0u && wCand[pos - 1u] > key) {
          wCand[pos] = wCand[pos - 1u];
          pos -= 1u;
        }
        wCand[pos] = key;
      }
    }
    wCandCount = count;
    wBestErr = 0xffffffffu;
    wBestId = wCand[0] & 0xffffu;
    wBestFg = 0u;
    wBestBg = 0u;
  }
  workgroupBarrier();
  let candCount = workgroupUniformLoad(&wCandCount);

  // This lane's sample.
  let SW = P.cols * 8u;
  let smp = reduced[(cellY * 8u + k / 8u) * SW + cellX * 8u + (k % 8u)];
  let sr = smp & 0xffu;
  let sg = (smp >> 8u) & 0xffu;
  let sb = (smp >> 16u) & 0xffu;

  // Exact rerank (§10), candidates in (score, id) order; ties keep the earlier.
  for (var c = 0u; c < candCount; c++) {
    if (k == 0u) {
      atomicStore(&wErr, 0u);
      atomicStore(&wInkR, 0u);
      atomicStore(&wInkG, 0u);
      atomicStore(&wInkB, 0u);
      atomicStore(&wInkN, 0u);
      atomicStore(&wOffR, 0u);
      atomicStore(&wOffG, 0u);
      atomicStore(&wOffB, 0u);
      atomicStore(&wOffN, 0u);
    }
    workgroupBarrier();
    let g = wCand[c] & 0xffffu;
    let gm = masks[g];
    var bitk = 0u;
    if (k < 32u) {
      bitk = (gm.x >> k) & 1u;
    } else {
      bitk = (gm.y >> (k - 32u)) & 1u;
    }
    if (P.colorMode != 0u) {
      if (bitk == 1u) {
        atomicAdd(&wInkR, sr);
        atomicAdd(&wInkG, sg);
        atomicAdd(&wInkB, sb);
        atomicAdd(&wInkN, 1u);
      } else {
        atomicAdd(&wOffR, sr);
        atomicAdd(&wOffG, sg);
        atomicAdd(&wOffB, sb);
        atomicAdd(&wOffN, 1u);
      }
    }
    workgroupBarrier();
    if (k == 0u) {
      if (P.colorMode == 0u) {
        wFg = P.fgColor;
        wBg = P.bgColor;
      } else {
        let iN = atomicLoad(&wInkN);
        let oN = atomicLoad(&wOffN);
        let iR = atomicLoad(&wInkR);
        let iG = atomicLoad(&wInkG);
        let iB = atomicLoad(&wInkB);
        let oR = atomicLoad(&wOffR);
        let oG = atomicLoad(&wOffG);
        let oB = atomicLoad(&wOffB);
        if (P.colorMode == 2u) {
          var inkR = 0u; var inkG = 0u; var inkB = 0u;
          if (iN > 0u) {
            inkR = rdivU(iR, iN); inkG = rdivU(iG, iN); inkB = rdivU(iB, iN);
          } else {
            inkR = rdivU(oR, oN); inkG = rdivU(oG, oN); inkB = rdivU(oB, oN);
          }
          var offR = inkR; var offG = inkG; var offB = inkB;
          if (oN > 0u) {
            offR = rdivU(oR, oN); offG = rdivU(oG, oN); offB = rdivU(oB, oN);
          }
          wFg = inkR | (inkG << 8u) | (inkB << 16u);
          wBg = offR | (offG << 8u) | (offB << 16u);
        } else {
          var fg = P.bgColor;
          if (iN > 0u) {
            fg = rdivU(iR, iN) | (rdivU(iG, iN) << 8u) | (rdivU(iB, iN) << 16u);
          }
          wFg = fg;
          wBg = P.bgColor;
        }
      }
    }
    workgroupBarrier();
    let fg = wFg;
    let bg = wBg;
    var cc = bg;
    if (bitk == 1u) {
      cc = fg;
    }
    let er = i32(sr) - i32(cc & 0xffu);
    let eg = i32(sg) - i32((cc >> 8u) & 0xffu);
    let eb = i32(sb) - i32((cc >> 16u) & 0xffu);
    atomicAdd(&wErr, u32(er * er + eg * eg + eb * eb));
    workgroupBarrier();
    if (k == 0u) {
      let err = atomicLoad(&wErr);
      if (err < wBestErr) {
        wBestErr = err;
        wBestId = g;
        wBestFg = fg;
        wBestBg = bg;
      }
    }
    workgroupBarrier();
  }

  if (k == 0u) {
    cells[ci] = vec4<u32>(wBestId, wBestFg, wBestBg, 0u);
  }
}
`

export const COMPOSITE_WGSL = /* wgsl */ `
struct CompParams {
  cols: u32,
  rows: u32,
  atlasCols: u32,
  pitchW: u32,
  pitchH: u32,
  pad: u32,
  cellW: u32,
  cellH: u32,
  colorMode: u32,      // 0 mono, 1 foreground, 2 full
  useBackdrop: u32,    // 1 = paint the ground plane (mono bg, glyph backdrop), 0 = premultiplied alpha out
  backdrop: u32,       // packed rgb
  _pad0: u32,
  atlasW: f32,
  atlasH: f32,
  originX: f32,
  originY: f32,
  cellScreenW: f32,
  cellScreenH: f32,
  lod: f32,
  _pad1: f32,
  clearColor: vec4<f32>,
}

// Interaction stage (spec §9): strictly downstream of matching. Pointer and
// time only ever touch this pass — never the matcher.
struct FxParams {
  kind: u32,           // 0 none, 1 reveal, 2 displace, 3 wave, 4 push, 5 color,
                       // 6 glyph-scale, 7 glyph-rotate, 8 original-mix, 9 resolution
  _k1: u32,
  _k2: u32,
  _k3: u32,
  pointer: vec2<f32>,  // device px
  velocity: vec2<f32>,
  radiusPx: f32,
  featherPx: f32,
  intensity: f32,
  time: f32,
}

@group(0) @binding(0) var<uniform> C: CompParams;
@group(0) @binding(1) var<storage, read> cells: array<vec4<u32>>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
// Always bound; a 1x1 placeholder for non-chromatic profiles, since a bind
// group layout cannot vary per draw.
@group(0) @binding(6) var atlasRgba: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<uniform> FX: FxParams;
@group(0) @binding(5) var srcTex: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = vec2<f32>(-1.0, -1.0);
  if (vi == 1u) {
    p = vec2<f32>(3.0, -1.0);
  } else if (vi == 2u) {
    p = vec2<f32>(-1.0, 3.0);
  }
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  return out;
}

fn unpack3(c: u32) -> vec3<f32> {
  return vec3<f32>(f32(c & 0xffu), f32((c >> 8u) & 0xffu), f32((c >> 16u) & 0xffu)) / 255.0;
}

fn falloff(px: vec2<f32>) -> f32 {
  let d = distance(px, FX.pointer);
  return 1.0 - smoothstep(max(FX.radiusPx - FX.featherPx, 0.0), FX.radiusPx + FX.featherPx, d);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var pxe = in.pos.xy;

  // Coordinate-space effects: warp the sampling position before grid mapping.
  if (FX.kind == 2u) { // displace
    let f = falloff(pxe) * FX.intensity;
    pxe += vec2<f32>(
      sin(pxe.y * 0.11 + FX.time * 2.0),
      cos(pxe.x * 0.13 + FX.time * 2.0),
    ) * (f * C.cellScreenW * 0.8);
  } else if (FX.kind == 3u) { // wave
    pxe.x += sin(pxe.y / max(C.cellScreenH, 1.0) * 1.5 + FX.time * 3.0) * FX.intensity * C.cellScreenW * 0.6;
  } else if (FX.kind == 4u) { // push (content repelled from pointer)
    let dv = pxe - FX.pointer;
    let d = max(length(dv), 0.001);
    let f = 1.0 - smoothstep(0.0, FX.radiusPx + FX.featherPx, d);
    pxe -= dv / d * f * FX.intensity * FX.radiusPx * 0.35;
  } else if (FX.kind == 9u) { // resolution (magnify)
    let f = falloff(pxe);
    let s = 1.0 + FX.intensity * f;
    pxe = FX.pointer + (pxe - FX.pointer) / s;
  }

  let px = pxe - vec2<f32>(C.originX, C.originY);
  let cf = floor(px / vec2<f32>(C.cellScreenW, C.cellScreenH));
  if (cf.x < 0.0 || cf.y < 0.0 || cf.x >= f32(C.cols) || cf.y >= f32(C.rows)) {
    return C.clearColor;
  }
  let cx = u32(cf.x);
  let cy = u32(cf.y);
  let cell = cells[cy * C.cols + cx];
  let glyph = cell.x & 0xffffu;
  let flags = cell.x >> 16u;
  if ((flags & 2u) != 0u) {
    return vec4<f32>(0.0);
  }
  var local = px / vec2<f32>(C.cellScreenW, C.cellScreenH) - cf; // 0..1 in cell

  // Glyph-local effects.
  if (FX.kind == 6u) { // glyph-scale (grow near pointer)
    let f = falloff(in.pos.xy);
    let s = max(1.0 - 0.75 * FX.intensity * f, 0.25);
    local = vec2<f32>(0.5) + (local - vec2<f32>(0.5)) * s;
  } else if (FX.kind == 7u) { // glyph-rotate
    let f = falloff(in.pos.xy);
    let ang = FX.intensity * f * 3.14159265;
    let c = cos(ang);
    let sn = sin(ang);
    let p = local - vec2<f32>(0.5);
    local = vec2<f32>(0.5) + vec2<f32>(c * p.x - sn * p.y, sn * p.x + c * p.y);
  }

  let tile = vec2<f32>(
    f32((glyph % C.atlasCols) * C.pitchW + C.pad),
    f32((glyph / C.atlasCols) * C.pitchH + C.pad),
  );
  let inset = 0.5 * exp2(C.lod);
  let texel = tile + clamp(
    local * vec2<f32>(f32(C.cellW), f32(C.cellH)),
    vec2<f32>(inset),
    vec2<f32>(f32(C.cellW), f32(C.cellH)) - vec2<f32>(inset),
  );
  let uv = texel / vec2<f32>(C.atlasW, C.atlasH);

  var outColor: vec4<f32>;
  if (C.colorMode == 3u) {
    // chromatic-v1: the glyph carries its own colour, so there is nothing to
    // tint. Sample the RGBA atlas and blend it onto the backdrop.
    let src = textureSampleLevel(atlasRgba, samp, uv, C.lod);
    if (C.useBackdrop == 0u) {
      outColor = vec4<f32>(src.rgb * src.a, src.a); // premultiplied
    } else {
      outColor = vec4<f32>(mix(unpack3(C.backdrop), src.rgb, src.a), 1.0);
    }
  } else {
    let a = textureSampleLevel(atlas, samp, uv, C.lod).r;
    let fg = unpack3(cell.y);
    // mono joins foreground here when the ground is dropped (transparent clearColor):
    // its fg is uniform, so glyph coverage becomes the only alpha, same as the CPU
    // compositeFrame with background: null. full never does — its background plane is
    // per-cell sampled content, not a backdrop.
    if ((C.colorMode == 0u || C.colorMode == 1u) && C.useBackdrop == 0u) {
      outColor = vec4<f32>(fg * a, a); // premultiplied
    } else {
      var bg = unpack3(cell.z);
      if (C.colorMode == 1u) {
        bg = unpack3(C.backdrop);
      }
      outColor = vec4<f32>(mix(bg, fg, a), 1.0);
    }
  }

  // Color-space effects.
  if (FX.kind == 1u || FX.kind == 8u) { // reveal / original-mix
    let gridSize = vec2<f32>(f32(C.cols) * C.cellScreenW, f32(C.rows) * C.cellScreenH);
    let uvSrc = clamp(px / gridSize, vec2<f32>(0.0), vec2<f32>(1.0));
    let srcC = textureSampleLevel(srcTex, samp, uvSrc, 0.0);
    var m = clamp(FX.intensity, 0.0, 1.0);
    if (FX.kind == 1u) {
      m = falloff(in.pos.xy) * m;
    }
    outColor = vec4<f32>(mix(outColor.rgb, srcC.rgb, m), max(outColor.a, m));
  } else if (FX.kind == 5u) { // color shift
    let f = clamp(falloff(in.pos.xy) * FX.intensity, 0.0, 1.0);
    outColor = vec4<f32>(mix(outColor.rgb, outColor.brg, f * 0.8), outColor.a);
  }
  return outColor;
}
`

export const MIPGEN_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = vec2<f32>(-1.0, -1.0);
  if (vi == 1u) {
    p = vec2<f32>(3.0, -1.0);
  } else if (vi == 2u) {
    p = vec2<f32>(-1.0, 3.0);
  }
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  // Bilinear tap at the parent-quad center = exact 2×2 box average.
  return textureSampleLevel(src, samp, in.uv, 0.0);
}
`

// chromatic-v1 (ALGORITHM.md §C): one workgroup per cell, but parallel over
// glyphs rather than over samples. Each thread walks a stride of the glyph
// table and scores it against all 64 samples held in workgroup memory, which
// keeps the inner loop barrier-free — the structural matcher's per-sample
// parallelism buys nothing here because there is no colour to fit and so no
// per-sample reduction to perform.
//
// glyphRgb holds descriptors ALREADY composited over the backdrop (§C3). That
// composite depends only on the glyph table and the backdrop, so the host
// uploads it when the backdrop changes rather than the shader redoing it for
// every candidate of every cell.
export const chromaticMatchWgsl = (): string => /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> reduced: array<u32>;
@group(0) @binding(2) var<storage, read> features: array<vec4<u32>>;
@group(0) @binding(3) var<storage, read> glyphRgb: array<u32>;
@group(0) @binding(4) var<storage, read_write> cells: array<vec4<u32>>;

var<workgroup> wSrc: array<u32, 64>;
var<workgroup> wFlags: u32;
var<workgroup> wPrevId: u32;
var<workgroup> wBestErr: atomic<u32>;
var<workgroup> wBestId: atomic<u32>;

fn errOf(g: u32) -> u32 {
  var err = 0u;
  let base = g * 64u;
  for (var k = 0u; k < 64u; k++) {
    let s = wSrc[k];
    let c = glyphRgb[base + k];
    let dr = i32(s & 0xffu) - i32(c & 0xffu);
    let dg = i32((s >> 8u) & 0xffu) - i32((c >> 8u) & 0xffu);
    let db = i32((s >> 16u) & 0xffu) - i32((c >> 16u) & 0xffu);
    err += u32(dr * dr + dg * dg + db * db);
  }
  return err;
}

// §C5 keep-incumbent test: best·1000 >= inc·(1000−h). Errors reach 12,484,800
// (§C4), so the products need 44 bits — a u32 multiply wraps and f32 cannot
// hold them exactly either, while the CPU compares in f64. Split each error
// into 16-bit halves; every partial product stays under 2^26 and the (hi, lo)
// pairs compare exactly.
fn hystKeeps(best: u32, inc: u32, m: u32) -> bool {
  let bLo = (best & 0xffffu) * 1000u;
  let bHi = (best >> 16u) * 1000u + (bLo >> 16u);
  let iLo = (inc & 0xffffu) * m;
  let iHi = (inc >> 16u) * m + (iLo >> 16u);
  return bHi > iHi || (bHi == iHi && (bLo & 0xffffu) >= (iLo & 0xffffu));
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) k: u32) {
  let cellX = wg.x + P.baseCol;
  let cellY = wg.y + P.baseRow;
  let ci = cellY * P.cols + cellX;

  let sIdx = (cellY * 8u + k / 8u) * (P.cols * 8u) + cellX * 8u + (k % 8u);
  wSrc[k] = reduced[sIdx];
  if (k == 0u) {
    wFlags = features[ci].w;
    wPrevId = cells[ci].x & 0xffffu;
    atomicStore(&wBestErr, 0xffffffffu);
    atomicStore(&wBestId, 0xffffffffu);
  }
  workgroupBarrier();

  // Only the transparent bit applies; chromatic-v1 has no flat path (§C2).
  let flags = workgroupUniformLoad(&wFlags) & 2u;
  if (flags != 0u) {
    if (k == 0u) {
      cells[ci] = vec4<u32>(P.blankId | (flags << 16u), 0u, 0u, 0u);
    }
    return;
  }

  // Pass 1: each thread's own best over its stride of the glyph table.
  var myErr = 0xffffffffu;
  var myId = 0xffffffffu;
  for (var g = k; g < P.glyphCount; g += 64u) {
    var err = 0u;
    let base = g * 64u;
    for (var i = 0u; i < 64u; i++) {
      let s = wSrc[i];
      let c = glyphRgb[base + i];
      let dr = i32(s & 0xffu) - i32(c & 0xffu);
      let dg = i32((s >> 8u) & 0xffu) - i32((c >> 8u) & 0xffu);
      let db = i32((s >> 16u) & 0xffu) - i32((c >> 16u) & 0xffu);
      err += u32(dr * dr + dg * dg + db * db);
      // Safe early exit: err can only grow, and a glyph that already exceeds
      // this thread's best cannot become the global minimum through it.
      if (err >= myErr) { break; }
    }
    if (err < myErr) {
      myErr = err;
      myId = g;
    }
  }
  atomicMin(&wBestErr, myErr);
  workgroupBarrier();

  // Pass 2: lowest id among the ties. Splitting the reduction in two keeps the
  // error exact — packing (err, id) into one u32 would need 24 + 16 bits.
  let bestErr = atomicLoad(&wBestErr);
  if (myErr == bestErr) {
    atomicMin(&wBestId, myId);
  }
  workgroupBarrier();

  if (k == 0u) {
    var id = atomicLoad(&wBestId);
    // Hysteresis (§C5). The incumbent is scored in full: it may have been
    // early-exited out of pass 1, and a partial sum would compare unequally.
    if (P.hysteresisMilli > 0u && wPrevId != id && wPrevId < P.glyphCount) {
      let incErr = errOf(wPrevId);
      if (hystKeeps(bestErr, incErr, 1000u - P.hysteresisMilli)) {
        id = wPrevId;
      }
    }
    cells[ci] = vec4<u32>(id, 0u, 0u, 0u);
  }
}
`
