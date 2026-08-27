// Procedural demo scenes — all client-side, no assets, all recognizable.
import { createSolids3D } from './solids3d'

export type SceneKind =
  | 'orbs'
  | 'solids'
  | 'dvd'
  | 'plasma'
  | 'starfield'
  | 'life'
  | 'clock'
  | 'marquee'

export interface Scene {
  canvas: HTMLCanvasElement
  /** Advance the animation; t in seconds. */
  tick: (t: number) => void
}

const W = 960
const H = 540

const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  return [c, c.getContext('2d')!]
}

function orbs(): Scene {
  const [canvas, ctx] = mk()
  const tick = (t: number): void => {
    const bg = ctx.createLinearGradient(0, 0, W, H)
    bg.addColorStop(0, '#1a1a2e')
    bg.addColorStop(1, '#4a2f6e')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    const disc = (x: number, y: number, r: number, color: string): void => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    disc(240 + Math.sin(t * 0.9) * 90, 200 + Math.cos(t * 0.7) * 50, 130, '#e4573f')
    disc(700 + Math.cos(t * 0.6) * 70, 160 + Math.sin(t * 1.1) * 60, 90, '#2fa869')
    disc(560 + Math.sin(t * 0.5) * 110, 400 + Math.cos(t) * 40, 110, '#3f6de4')
    ctx.strokeStyle = '#f0f0f5'
    ctx.lineWidth = 18
    ctx.beginPath()
    ctx.arc(W / 2, H / 2, 210 + Math.sin(t * 1.3) * 14, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 110px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('ASCII FX', W / 2, H / 2)
  }
  tick(0)
  return { canvas, tick }
}

function dvd(): Scene {
  const [canvas, ctx] = mk()
  const box = { x: 120, y: 90, w: 300, h: 130, vx: 190, vy: 150 }
  let hue = 20
  let last = 0
  const tick = (t: number): void => {
    const dt = Math.min(0.05, t - last)
    last = t
    box.x += box.vx * dt
    box.y += box.vy * dt
    let bounced = false
    if (box.x < 0 || box.x + box.w > W) {
      box.vx *= -1
      box.x = Math.max(0, Math.min(W - box.w, box.x))
      bounced = true
    }
    if (box.y < 0 || box.y + box.h > H) {
      box.vy *= -1
      box.y = Math.max(0, Math.min(H - box.h, box.y))
      bounced = true
    }
    if (bounced) hue = (hue + 77) % 360
    ctx.fillStyle = '#05050a'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = `hsl(${hue} 85% 60%)`
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.w, box.h, 24)
    ctx.fill()
    ctx.fillStyle = '#05050a'
    ctx.font = 'bold 64px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('ASCII', box.x + box.w / 2, box.y + box.h / 2 - 22)
    ctx.fillText('FX', box.x + box.w / 2, box.y + box.h / 2 + 34)
  }
  tick(0)
  return { canvas, tick }
}

function plasma(): Scene {
  const [canvas, ctx] = mk()
  const pw = 240
  const ph = 135
  const small = document.createElement('canvas')
  small.width = pw
  small.height = ph
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(pw, ph)
  const tick = (t: number): void => {
    const d = img.data
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const v =
          Math.sin(x / 14 + t) +
          Math.sin(y / 9 - t * 0.8) +
          Math.sin((x + y) / 18 + t * 0.5) +
          Math.sin(Math.hypot(x - pw / 2, y - ph / 2) / 9 - t)
        const p = (y * pw + x) * 4
        d[p] = 128 + 127 * Math.sin(v * Math.PI * 0.5)
        d[p + 1] = 128 + 127 * Math.sin(v * Math.PI * 0.5 + 2.1)
        d[p + 2] = 128 + 127 * Math.sin(v * Math.PI * 0.5 + 4.2)
        d[p + 3] = 255
      }
    }
    sctx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(small, 0, 0, W, H)
  }
  tick(0)
  return { canvas, tick }
}

function starfield(): Scene {
  const [canvas, ctx] = mk()
  const N = 420
  const stars = Array.from({ length: N }, () => ({
    x: Math.random() * 2 - 1,
    y: Math.random() * 2 - 1,
    z: Math.random(),
  }))
  const tick = (): void => {
    ctx.fillStyle = '#020208'
    ctx.fillRect(0, 0, W, H)
    for (const s of stars) {
      s.z -= 0.006
      if (s.z <= 0.02) {
        s.x = Math.random() * 2 - 1
        s.y = Math.random() * 2 - 1
        s.z = 1
      }
      const sx = W / 2 + (s.x / s.z) * W * 0.45
      const sy = H / 2 + (s.y / s.z) * H * 0.45
      if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue
      const r = Math.max(0.8, (1 - s.z) * 5)
      const b = Math.min(255, 90 + (1 - s.z) * 200) | 0
      ctx.fillStyle = `rgb(${b},${b},${255})`
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  tick()
  return { canvas, tick }
}

function life(): Scene {
  const [canvas, ctx] = mk()
  const gw = 120
  const gh = 68
  let grid = new Uint8Array(gw * gh)
  const seed = (): void => {
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random() < 0.28 ? 1 : 0
  }
  seed()
  let next = new Uint8Array(gw * gh)
  let lastStep = 0
  let generations = 0
  const tick = (t: number): void => {
    if (t - lastStep > 0.09) {
      lastStep = t
      generations++
      if (generations % 320 === 0) seed()
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          let n = 0
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              n += grid[((y + dy + gh) % gh) * gw + ((x + dx + gw) % gw)]
            }
          const alive = grid[y * gw + x] === 1
          next[y * gw + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0
        }
      }
      ;[grid, next] = [next, grid]
    }
    ctx.fillStyle = '#03070d'
    ctx.fillRect(0, 0, W, H)
    const cw = W / gw
    const ch = H / gh
    ctx.fillStyle = '#4ade80'
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        if (grid[y * gw + x]) ctx.fillRect(x * cw, y * ch, cw - 1, ch - 1)
      }
  }
  tick(0)
  return { canvas, tick }
}

function clock(): Scene {
  const [canvas, ctx] = mk()
  const tick = (): void => {
    ctx.fillStyle = '#0d0d14'
    ctx.fillRect(0, 0, W, H)
    const cx = W / 2
    const cy = H / 2
    const R = H * 0.42
    ctx.strokeStyle = '#e8e8f0'
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ctx.lineWidth = i % 3 === 0 ? 9 : 4
      ctx.beginPath()
      ctx.moveTo(cx + Math.sin(a) * R * 0.86, cy - Math.cos(a) * R * 0.86)
      ctx.lineTo(cx + Math.sin(a) * R * 0.96, cy - Math.cos(a) * R * 0.96)
      ctx.stroke()
    }
    const now = new Date()
    const sec = now.getSeconds() + now.getMilliseconds() / 1000
    const min = now.getMinutes() + sec / 60
    const hr = (now.getHours() % 12) + min / 60
    const hand = (frac: number, len: number, width: number, color: string): void => {
      const a = frac * Math.PI * 2
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.sin(a) * R * len, cy - Math.cos(a) * R * len)
      ctx.stroke()
    }
    hand(hr / 12, 0.5, 14, '#e8e8f0')
    hand(min / 60, 0.74, 9, '#e8e8f0')
    hand(sec / 60, 0.82, 4, '#e4573f')
  }
  tick()
  return { canvas, tick }
}

function marquee(): Scene {
  const [canvas, ctx] = mk()
  const text = '  NEVER GONNA GIVE YOU UP ♪ '
  const tick = (t: number): void => {
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#20063b')
    bg.addColorStop(1, '#3b0d2e')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    ctx.font = 'bold 130px ui-monospace, Menlo, monospace'
    ctx.textBaseline = 'middle'
    const tw = ctx.measureText(text).width
    const x = W - ((t * 260) % (tw + W))
    for (const [dy, color] of [
      [-120, '#e4573f'],
      [0, '#ffffff'],
      [120, '#3f9de4'],
    ] as const) {
      const phase = dy === 0 ? 0 : dy < 0 ? tw * 0.33 : tw * 0.66
      const xx = W - ((t * 260 + phase) % (tw + W))
      ctx.fillStyle = color
      ctx.fillText(text, xx, H / 2 + dy + Math.sin(t * 2 + dy) * 12)
      void x
    }
  }
  tick(0)
  return { canvas, tick }
}

// The 3D scene is a module of its own because `scripts/render-assets.mjs` renders the
// README's hero loop from it too — one rasterizer, so the still on the page and the scene
// in the playground cannot drift apart.
function solids(): Scene {
  const [canvas, ctx] = mk()
  const img = ctx.createImageData(W, H)
  // Rendering straight into the ImageData saves a full-frame copy every tick.
  const scene = createSolids3D(W, H, img.data)
  const tick = (t: number): void => {
    scene.render(t)
    ctx.putImageData(img, 0, 0)
  }
  tick(0)
  return { canvas, tick }
}

export const SCENES: Record<SceneKind, { label: string; create: () => Scene }> = {
  orbs: { label: 'Animated orbs', create: orbs },
  solids: { label: '3D solids', create: solids },
  dvd: { label: 'DVD bounce', create: dvd },
  plasma: { label: 'Plasma', create: plasma },
  starfield: { label: 'Starfield', create: starfield },
  life: { label: 'Game of Life', create: life },
  clock: { label: 'Clock', create: clock },
  marquee: { label: 'Marquee ♪', create: marquee },
}
