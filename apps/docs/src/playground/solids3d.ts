// A software 3D rasterizer — z-buffer, perspective camera, per-pixel Blinn-Phong —
// rendering a handful of solids tumbling past one another.
//
// It exists to put the matcher in front of what only a 3D scene has: curved shading
// ramps running into hard silhouettes at every angle, and solids that occlude each other
// as they cross. Software rather than WebGL because there is no GPU context to borrow in
// Node, and because a scene competing for the renderer's own adapter would be measuring
// the wrong thing in the browser.
//
// Nothing here touches the DOM: it writes RGBA into a buffer you own. The playground
// hands it an ImageData's `data`; `scripts/render-assets.mjs` renders the README's
// hero loop from the very same module, so the still on the page and the scene in the
// playground cannot drift apart.

type V3 = readonly [number, number, number]
type Tri = readonly [V3, V3, V3]
/** Row-major 3×3. Rotation only, so it transforms normals as-is. */
type M3 = Float32Array

interface Mesh {
  /** 9 floats per triangle: xyz for each of its three vertices. */
  pos: Float32Array
  /** 9 floats per triangle: the matching vertex normals. */
  nrm: Float32Array
}

const TAU = Math.PI * 2

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (v: V3): V3 => {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
/** Weld key. The generators build positions out of trig, so exact equality won't do. */
const vkey = (p: V3): string =>
  `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`

/** Faces meeting at a vertex are averaged only if their normals are within this angle. */
const CREASE = Math.cos((60 * Math.PI) / 180)

/**
 * Bare triangles in, vertex normals out: average the face normals meeting at each
 * position, but only across faces within the crease angle of the one being shaded. That
 * single rule gives the sphere smooth poles, the cylinder a hard rim and the pyramid
 * flat sides — so no generator below has to say anything about normals.
 */
function toMesh(tris: Tri[]): Mesh {
  const face = tris.map((t) => unit(cross(sub(t[1], t[0]), sub(t[2], t[0]))))
  const meeting = new Map<string, number[]>()
  tris.forEach((t, i) => {
    for (const p of t) {
      const at = meeting.get(vkey(p))
      if (at) at.push(i)
      else meeting.set(vkey(p), [i])
    }
  })
  const pos = new Float32Array(tris.length * 9)
  const nrm = new Float32Array(tris.length * 9)
  tris.forEach((t, i) => {
    const f = face[i]
    for (let k = 0; k < 3; k++) {
      const p = t[k]
      let sx = 0
      let sy = 0
      let sz = 0
      for (const j of meeting.get(vkey(p))!) {
        const g = face[j]
        if (f[0] * g[0] + f[1] * g[1] + f[2] * g[2] < CREASE) continue
        sx += g[0]
        sy += g[1]
        sz += g[2]
      }
      // The face itself always clears the crease test, so this is never the zero vector.
      const n = unit([sx, sy, sz])
      const o = i * 9 + k * 3
      pos[o] = p[0]
      pos[o + 1] = p[1]
      pos[o + 2] = p[2]
      nrm[o] = n[0]
      nrm[o + 1] = n[1]
      nrm[o + 2] = n[2]
    }
  })
  return { pos, nrm }
}

const same = (a: V3, b: V3): boolean =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6

/**
 * Triangulate an (si+1)×(sj+1) lattice of samples, wound counter-clockwise seen from
 * outside. Degenerate quads are dropped, which is what collapses a sphere's pole rows
 * to a single triangle each.
 */
function lattice(at: (i: number, j: number) => V3, si: number, sj: number): Tri[] {
  const tris: Tri[] = []
  for (let j = 0; j < sj; j++) {
    for (let i = 0; i < si; i++) {
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i + 1, j + 1)
      const d = at(i, j + 1)
      if (!same(a, b)) tris.push([a, b, c])
      if (!same(c, d)) tris.push([a, c, d])
    }
  }
  return tris
}

/** i winds about +Y, j runs from the +Y pole down. */
const sphere = (r: number, seg = 20, rings = 12): Tri[] =>
  lattice(
    (i, j) => {
      const phi = (j / rings) * Math.PI
      const th = (i / seg) * TAU
      const s = Math.sin(phi)
      return [r * s * Math.cos(th), r * Math.cos(phi), r * s * Math.sin(th)]
    },
    seg,
    rings,
  )

const torus = (R: number, r: number, seg = 22, ring = 11): Tri[] =>
  lattice(
    (i, j) => {
      const u = (i / seg) * TAU
      const v = (j / ring) * TAU
      const rr = R + r * Math.cos(v)
      // -sin, so the tube winds outward the same way the sphere's lattice does.
      return [rr * Math.cos(u), -r * Math.sin(v), rr * Math.sin(u)]
    },
    seg,
    ring,
  )

/** seg 3 is a triangular prism, 6 a hex prism, 20 reads as a cylinder. */
function cylinder(r: number, h: number, seg: number): Tri[] {
  const y = h / 2
  const ring = (i: number, top: boolean): V3 => {
    const th = (i / seg) * TAU
    return [r * Math.cos(th), top ? y : -y, r * Math.sin(th)]
  }
  const tris = lattice((i, j) => ring(i, j === 0), seg, 1)
  for (let i = 0; i < seg; i++) {
    tris.push([[0, y, 0], ring(i + 1, true), ring(i, true)])
    tris.push([[0, -y, 0], ring(i, false), ring(i + 1, false)])
  }
  return tris
}

/** seg 4 is a square pyramid, 24 a cone. */
function cone(r: number, h: number, seg: number): Tri[] {
  const y = h / 2
  const ring = (i: number): V3 => {
    const th = (i / seg) * TAU
    return [r * Math.cos(th), -y, r * Math.sin(th)]
  }
  const tris: Tri[] = []
  for (let i = 0; i < seg; i++) {
    tris.push([[0, y, 0], ring(i + 1), ring(i)])
    tris.push([[0, -y, 0], ring(i), ring(i + 1)])
  }
  return tris
}

/** Two triangles across a planar quad, keeping its winding. */
const quad = (a: V3, b: V3, c: V3, d: V3): Tri[] => [
  [a, b, c],
  [a, c, d],
]

function cuboid(w: number, h: number, d: number): Tri[] {
  const [x, y, z] = [w / 2, h / 2, d / 2]
  const v = (sx: number, sy: number, sz: number): V3 => [sx * x, sy * y, sz * z]
  return [
    ...quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)),
    ...quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)),
    ...quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)),
    ...quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)),
    ...quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)),
    ...quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)),
  ]
}

const rotX = (a: number): M3 => {
  const s = Math.sin(a)
  const c = Math.cos(a)
  return new Float32Array([1, 0, 0, 0, c, -s, 0, s, c])
}
const rotY = (a: number): M3 => {
  const s = Math.sin(a)
  const c = Math.cos(a)
  return new Float32Array([c, 0, s, 0, 1, 0, -s, 0, c])
}
const rotZ = (a: number): M3 => {
  const s = Math.sin(a)
  const c = Math.cos(a)
  return new Float32Array([c, -s, 0, s, c, 0, 0, 0, 1])
}
const mul3 = (a: M3, b: M3): M3 => {
  const m = new Float32Array(9)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
    }
  }
  return m
}

// Camera: fixed, a little above the scene and looking down at the origin. Nothing about
// it moves, so every pixel that changes between frames changed because a solid moved.
const CAM_D = 10.5
const TILT = 0.36
const NEAR = 0.5
// Focal length per pixel of frame height, so the framing holds at any size. Set together
// with CAM_D and the orbit radii below: a close camera over tight orbits fills a third of
// the frame with lit surface, where a distant one over wide orbits left small solids
// adrift in a mostly empty field — and an empty field is a page of blank cells, which is
// nothing to look at and nothing to match.
const FOCAL_PER_H = 800 / 540

// Lights are rigged to the camera, so these are view-space directions and the Blinn
// half-vector is constant — the whole shader is three dot products and five squarings.
const [LKX, LKY, LKZ] = unit([-0.42, 0.72, 0.55])
const [LFX, LFY, LFZ] = unit([0.72, -0.28, 0.24])
const [LHX, LHY, LHZ] = unit([LKX, LKY, LKZ + 1])
// Per-channel weights: cool ambient, warm key, cold fill. Nothing is ever fully black,
// which matters more here than it would on screen — a glyph matcher given a flat black
// shadow side has nothing to match.
const [AR, AG, AB] = [0.22, 0.23, 0.33]
const [KR, KG, KB] = [1.55, 1.46, 1.28]
const [FR, FG, FB] = [0.34, 0.47, 0.76]
/** Projected vertex scratch: x, y, 1/z, nx, ny, nz per vertex. */
const vtx = new Float32Array(18)

/**
 * One triangle, from `vtx`. Barycentric edge walk with incremental edge functions;
 * depth interpolates 1/z, which is the one quantity that *is* linear in screen space.
 * Normals interpolate affinely — wrong under perspective, invisible at these sizes.
 */
function raster(
  rgba: Uint8ClampedArray,
  depth: Float32Array,
  w: number,
  h: number,
  cr: number,
  cg: number,
  cb: number,
  gloss: number,
): void {
  const x0 = vtx[0]
  const y0 = vtx[1]
  const x1 = vtx[6]
  const y1 = vtx[7]
  const x2 = vtx[12]
  const y2 = vtx[13]
  // Signed area is positive exactly for the front faces, because projection flips y.
  const area = (y1 - y0) * (x2 - x0) - (x1 - x0) * (y2 - y0)
  if (area <= 1e-9) return
  const inv = 1 / area
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
  const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
  const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)))
  if (minX > maxX || minY > maxY) return

  const ax = y2 - y1
  const ay = x1 - x2
  const bx = y0 - y2
  const by = x2 - x0
  const gx = y1 - y0
  const gy = x0 - x1
  const px = minX + 0.5
  const py = minY + 0.5
  let ra = ax * (px - x1) + ay * (py - y1)
  let rb = bx * (px - x2) + by * (py - y2)
  let rg = gx * (px - x0) + gy * (py - y0)

  const iz0 = vtx[2]
  const iz1 = vtx[8]
  const iz2 = vtx[14]
  for (let y = minY; y <= maxY; y++) {
    let wa = ra
    let wb = rb
    let wg = rg
    let idx = y * w + minX
    for (let x = minX; x <= maxX; x++, idx++) {
      if (wa >= 0 && wb >= 0 && wg >= 0) {
        const b0 = wa * inv
        const b1 = wb * inv
        const b2 = wg * inv
        const iz = b0 * iz0 + b1 * iz1 + b2 * iz2
        if (iz > depth[idx]) {
          depth[idx] = iz
          let nx = b0 * vtx[3] + b1 * vtx[9] + b2 * vtx[15]
          let ny = b0 * vtx[4] + b1 * vtx[10] + b2 * vtx[16]
          let nz = b0 * vtx[5] + b1 * vtx[11] + b2 * vtx[17]
          const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
          nx *= l
          ny *= l
          nz *= l
          const kd = nx * LKX + ny * LKY + nz * LKZ
          const k = kd > 0 ? kd : 0
          const fd = nx * LFX + ny * LFY + nz * LFZ
          const f = fd > 0 ? fd : 0
          const hd = nx * LHX + ny * LHY + nz * LHZ
          let s = hd > 0 ? hd : 0
          // ^32 by squaring: Math.pow in a per-pixel loop is the one thing that shows up.
          s *= s
          s *= s
          s *= s
          s *= s
          s *= s
          s *= gloss * 255
          const p = idx * 4
          rgba[p] = cr * (AR + k * KR + f * FR) + s
          rgba[p + 1] = cg * (AG + k * KG + f * FG) + s
          rgba[p + 2] = cb * (AB + k * KB + f * FB) + s
        }
      }
      wa += ax
      wb += bx
      wg += gx
    }
    ra += ay
    rb += by
    rg += gy
  }
}

/**
 * The scene repeats exactly every this many seconds.
 *
 * Every rate below is an integer multiple of 2π/LOOP_SECONDS, which is the whole reason
 * that is true — pick one rate off the grid and the loop stops closing, which is only
 * visible as a jump cut at the seam of the README's animation.
 */
export const LOOP_SECONDS = 8
const RATE = TAU / LOOP_SECONDS

interface Solid {
  mesh: Mesh
  /** Base colour, 0–255, before lighting. */
  color: V3
  gloss: number
  /** Orbit radius, then the tilt of its orbital plane about x and about z. */
  orbit: V3
  /** Orbit rate, in multiples of `RATE`; negative runs the other way round. */
  rate: number
  phase: number
  /** Tumble rate about each axis, in multiples of `RATE`. */
  spin: V3
  /** The orbital plane, folded out of `orbit` once at build time. */
  ring: M3
}

// A big anchor sphere drifting at the middle, with six solids on orbits that each sit in
// their own tilted plane. A shared plane, radius or direction would settle into one
// legible ring; these keep crossing in front of and behind each other, which is the part
// of a 3D scene a flat one cannot fake.
const SCENE: Solid[] = (
  [
    {
      mesh: sphere(1.7),
      color: [233, 110, 68],
      gloss: 0.6,
      orbit: [0.43, 1, 0.4],
      rate: 1,
      phase: 0,
      spin: [1, 1, 1],
    },
    {
      mesh: torus(1.05, 0.42),
      color: [64, 196, 208],
      gloss: 0.45,
      orbit: [2.85, 0.52, 0.2],
      rate: 1,
      phase: 0,
      spin: [3, 1, 1],
    },
    {
      mesh: cylinder(0.62, 2, 20),
      color: [86, 198, 118],
      gloss: 0.35,
      orbit: [2.67, -0.44, 0.55],
      rate: 2,
      phase: 2.1,
      spin: [1, 3, 2],
    },
    {
      mesh: cone(1, 2, 4),
      color: [234, 190, 74],
      gloss: 0.3,
      orbit: [3.1, 0.6, -0.3],
      rate: -1,
      phase: 4,
      spin: [2, 1, 3],
    },
    {
      mesh: cylinder(0.95, 1.9, 3),
      color: [214, 92, 178],
      gloss: 0.3,
      orbit: [2.54, -0.58, -0.42],
      rate: -2,
      phase: 1,
      spin: [1, 2, 3],
    },
    {
      mesh: cone(0.85, 2.1, 24),
      color: [226, 76, 76],
      gloss: 0.5,
      orbit: [2.91, 0.3, 0.62],
      rate: 2,
      phase: 3.4,
      spin: [3, 2, 1],
    },
    {
      mesh: cuboid(1.45, 1.45, 1.45),
      color: [98, 118, 234],
      gloss: 0.4,
      orbit: [2.48, -0.62, 0.18],
      rate: -1,
      phase: 5.2,
      spin: [2, 3, 1],
    },
  ] as const
).map((s) => ({
  ...s,
  mesh: toMesh(s.mesh),
  ring: mul3(rotZ(s.orbit[2]), rotX(s.orbit[1])),
}))

// Camera: fixed, a little above the scene and looking down at the origin. Nothing about
// it moves, so every pixel that changes between frames changed because a solid moved.
const CAM = rotX(TILT)
// Orbits are circles; the frames they are shown in are not. Stretching only the centres
// along x — the solids themselves stay round — widens the ellipses until the scene fills
// a landscape frame instead of leaving a third of it empty on either side.
const SPREAD = 1.35

// A grid on the floor. Seven solids over a void leave most of the frame blank, and blank
// is exactly what the matcher has nothing to say about — a page of empty cells. The grid
// fills it with the one thing a flat backdrop cannot supply: straight lines converging on
// a vanishing point, at every angle between horizontal and vertical.
const GROUND_Y = 4.2
const GRID = 1.5
/** Distance at which the grid starts fading, and how far the fade runs into the sky. */
const GROUND_NEAR = 5
const GROUND_FAR = 55
/** How far the lines themselves survive; past this the floor is a smooth wash. */
const GRID_FADE = 22
// Floor between the lines, and the lines themselves. Both are lifted well clear of the
// sky: a grid the matcher renders as blank cells is a grid that is not there.
const [FLOOR_R, FLOOR_G, FLOOR_B] = [11, 18, 38]
const [LINE_R, LINE_G, LINE_B] = [118, 182, 242]

/** 1 on a grid line, 0 between, with a `w`-wide ramp so the line is not stair-stepped. */
function gridLine(v: number, w: number): number {
  const d = Math.abs(v / GRID - Math.round(v / GRID)) * GRID
  return Math.max(0, 1 - d / w)
}

export interface Solids3D {
  /** RGBA, `width · height · 4`. Rewritten in full by every `render`. */
  readonly rgba: Uint8ClampedArray
  readonly width: number
  readonly height: number
  /** Draw the scene at `t` seconds. A pure function of `t`: same t, same pixels. */
  render: (t: number) => void
}

/**
 * @param into Write into this buffer rather than a fresh one — pass an `ImageData`'s
 *   `data` to save a copy per frame. Must be `width · height · 4` long.
 */
export function createSolids3D(
  width: number,
  height: number,
  into: Uint8ClampedArray = new Uint8ClampedArray(width * height * 4),
): Solids3D {
  if (into.length !== width * height * 4) {
    throw new Error(`createSolids3D: buffer is ${into.length}, expected ${width * height * 4}`)
  }
  const depth = new Float32Array(width * height)
  const focal = height * FOCAL_PER_H
  const cx0 = width / 2
  const cy0 = height / 2

  // The camera never moves, so everything that is not a solid — the sky and the whole
  // ground plane, colour and depth both — is the same in every frame. Build it once and
  // memcpy it in at the top of each; the per-frame cost of the entire backdrop is two
  // typed-array copies. The depth copy is what lets the solids occlude the grid for free.
  const bg = new Uint8ClampedArray(width * height * 4)
  const bgDepth = new Float32Array(width * height)
  // The ray for a pixel is cast in view space and taken back to world space through the
  // camera's transpose (a rotation, so that is its inverse). Sampling 2×2 per pixel is
  // only affordable because it happens once: it is what keeps the far grid from breaking
  // into moiré, which a glyph matcher would faithfully reproduce as noise.
  const cam0 = CAM[1]
  const cam1 = CAM[4]
  const cam2 = CAM[7]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let iz = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = x + 0.25 + sx * 0.5
          const py = y + 0.25 + sy * 0.5
          // Sky: the same soft glow the scene has always had, and the ground's ceiling.
          const u = py / (height - 1)
          const d = Math.hypot((px - cx0) / (width * 0.78), (py - height * 0.16) / (height * 0.9))
          const glow = Math.max(0, 1 - d) ** 2 * 44
          let cr = 6 + u * 4 + glow * 0.8
          let cg = 8 + u * 4 + glow * 0.95
          let cb = 17 + u * 6 + glow * 1.3

          const dx = (px - cx0) / focal
          const dy = -(py - cy0) / focal
          const denom = cam0 * dx + cam1 * dy - cam2
          const s = (-GROUND_Y - cam2 * CAM_D) / denom
          if (denom !== 0 && s > NEAR) {
            // World x and z of the hit, through the same transpose.
            const vz = -s + CAM_D
            const wx = CAM[0] * s * dx + CAM[3] * s * dy + CAM[6] * vz
            const wz = CAM[2] * s * dx + CAM[5] * s * dy + CAM[8] * vz
            // Line width in world units that holds one pixel wide however far away it is,
            // and a fade so the grid dissolves into the sky rather than ending at a seam.
            const w = (s / focal) * 3
            const near = 1 - Math.min(1, Math.max(0, (s - GROUND_NEAR) / GROUND_FAR))
            // The lines fade out well before the floor does. Past the point where their
            // screen spacing closes to a couple of pixels they are aliasing, not drawing,
            // and the matcher would spend a different glyph on every cell of it; what is
            // left is a smooth wash that lights the far half of the frame for free.
            const crisp = 1 - Math.min(1, Math.max(0, (s - GROUND_NEAR) / GRID_FADE))
            const line = Math.max(gridLine(wx, w), gridLine(wz, w)) * crisp
            cr = cr * (1 - near) + (FLOOR_R + line * (LINE_R - FLOOR_R)) * near
            cg = cg * (1 - near) + (FLOOR_G + line * (LINE_G - FLOOR_G)) * near
            cb = cb * (1 - near) + (FLOOR_B + line * (LINE_B - FLOOR_B)) * near
            iz += 1 / s
          }
          r += cr
          g += cg
          b += cb
        }
      }
      const p = (y * width + x) * 4
      bg[p] = r / 4
      bg[p + 1] = g / 4
      bg[p + 2] = b / 4
      bg[p + 3] = 255
      bgDepth[y * width + x] = iz / 4
    }
  }

  const render = (t: number): void => {
    into.set(bg)
    depth.set(bgDepth)
    for (const s of SCENE) {
      const a = t * s.rate * RATE + s.phase
      const rx = s.orbit[0] * Math.cos(a)
      const rz = s.orbit[0] * Math.sin(a)
      const { ring } = s
      const wx = ring[0] * rx + ring[2] * rz
      const wy = ring[3] * rx + ring[5] * rz
      const wz = ring[6] * rx + ring[8] * rz
      const sx = wx * SPREAD
      const cx = CAM[0] * sx + CAM[1] * wy + CAM[2] * wz
      const cy = CAM[3] * sx + CAM[4] * wy + CAM[5] * wz
      const cz = CAM[6] * sx + CAM[7] * wy + CAM[8] * wz - CAM_D
      const m = mul3(
        CAM,
        mul3(
          rotY(t * s.spin[1] * RATE + s.phase),
          mul3(rotX(t * s.spin[0] * RATE), rotZ(t * s.spin[2] * RATE)),
        ),
      )
      const { pos, nrm } = s.mesh
      const [cr, cg, cb] = s.color
      for (let i = 0; i < pos.length; i += 9) {
        let clipped = false
        for (let k = 0; k < 3; k++) {
          const o = i + k * 3
          const x = pos[o]
          const y = pos[o + 1]
          const z = pos[o + 2]
          const vz = m[6] * x + m[7] * y + m[8] * z + cz
          // The scene never comes near the camera, so a whole-triangle reject stands in
          // for a near-plane clipper.
          if (vz > -NEAR) {
            clipped = true
            break
          }
          const iz = -1 / vz
          const v = k * 6
          vtx[v] = cx0 + focal * (m[0] * x + m[1] * y + m[2] * z + cx) * iz
          vtx[v + 1] = cy0 - focal * (m[3] * x + m[4] * y + m[5] * z + cy) * iz
          vtx[v + 2] = iz
          const nx = nrm[o]
          const ny = nrm[o + 1]
          const nz = nrm[o + 2]
          vtx[v + 3] = m[0] * nx + m[1] * ny + m[2] * nz
          vtx[v + 4] = m[3] * nx + m[4] * ny + m[5] * nz
          vtx[v + 5] = m[6] * nx + m[7] * ny + m[8] * nz
        }
        if (!clipped) raster(into, depth, width, height, cr, cg, cb, s.gloss)
      }
    }
  }
  render(0)
  return { rgba: into, width, height, render }
}
