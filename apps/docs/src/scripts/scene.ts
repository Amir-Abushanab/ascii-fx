/** Shared procedural demo scene (no image assets, deterministic look). */
export function makeSceneCanvas(width = 960, height = 540): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  drawScene(canvas, 0)
  return canvas
}

export function drawScene(canvas: HTMLCanvasElement, t: number): void {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  const bg = ctx.createLinearGradient(0, 0, w, h)
  bg.addColorStop(0, '#1a1a2e')
  bg.addColorStop(1, '#4a2f6e')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  const disc = (x: number, y: number, r: number, color: string): void => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  disc(w * 0.25 + Math.sin(t * 0.9) * w * 0.09, h * 0.37 + Math.cos(t * 0.7) * h * 0.09, h * 0.24, '#e4573f')
  disc(w * 0.73 + Math.cos(t * 0.6) * w * 0.07, h * 0.3 + Math.sin(t * 1.1) * h * 0.11, h * 0.17, '#2fa869')
  disc(w * 0.58 + Math.sin(t * 0.5) * w * 0.11, h * 0.74 + Math.cos(t) * h * 0.07, h * 0.2, '#3f6de4')
  ctx.strokeStyle = '#f0f0f5'
  ctx.lineWidth = h / 30
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, h * 0.39 + Math.sin(t * 1.3) * h * 0.025, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.round(h / 4.9)}px ui-monospace, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('ASCII FX', w / 2, h / 2)
}
