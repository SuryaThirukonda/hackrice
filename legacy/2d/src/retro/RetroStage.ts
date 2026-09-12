import Phaser from 'phaser'
import { RETRO } from './palette'

export const VIEW_W = 384
export const VIEW_H = 216

interface PixelBurst { x: number; y: number; color: string; life: number; vx: number; vy: number }

let nextStage = 1

/** One low-resolution canvas displayed by Phaser with nearest-neighbour scaling. */
export class RetroStage {
  readonly ctx: CanvasRenderingContext2D
  readonly image: Phaser.GameObjects.Image
  private readonly texture: Phaser.Textures.CanvasTexture
  private readonly key: string
  private plate: CanvasImageSource | null = null
  private bursts: PixelBurst[] = []
  private shakePower = 0
  private shakeTime = 0
  private flashLife = 0
  private cheerLife = 0
  private readonly scene: Phaser.Scene
  private readonly crt: boolean

  constructor(scene: Phaser.Scene, plateKey: string, crt = true) {
    this.scene = scene
    this.crt = crt
    this.key = `retro-stage-${nextStage++}`
    const texture = scene.textures.createCanvas(this.key, VIEW_W, VIEW_H)
    if (!texture) throw new Error('Could not allocate retro canvas texture')
    this.texture = texture
    this.ctx = this.texture.context
    this.ctx.imageSmoothingEnabled = false
    const source = scene.textures.exists(plateKey) ? scene.textures.get(plateKey).getSourceImage() : null
    this.plate = source instanceof HTMLImageElement || source instanceof HTMLCanvasElement ? source : null
    this.image = scene.add.image(0, 0, this.key).setOrigin(0).setDepth(0)
    this.resize(scene.scale.width, scene.scale.height)
  }

  begin(dt: number, fallback: string = RETRO.navy): CanvasRenderingContext2D {
    const c = this.ctx
    c.save()
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.imageSmoothingEnabled = false
    c.fillStyle = fallback
    c.fillRect(0, 0, VIEW_W, VIEW_H)
    if (this.plate) c.drawImage(this.plate, 0, 0, VIEW_W, VIEW_H)
    this.shakeTime += dt
    const a = this.shakePower * Math.exp(-this.shakeTime / 0.14)
    this.image.setPosition(a > 0.02 ? Math.round(Math.sin(this.shakeTime * 91) * a * 2) : 0, a > 0.02 ? Math.round(Math.cos(this.shakeTime * 73) * a) : 0)
    if (a <= 0.02) this.shakePower = 0
    this.flashLife = Math.max(0, this.flashLife - dt)
    this.cheerLife = Math.max(0, this.cheerLife - dt)
    return c
  }

  end(dt: number): void {
    const c = this.ctx
    for (const p of this.bursts) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 24 * dt
      if (p.life > 0) { c.fillStyle = p.color; c.fillRect(Math.round(p.x), Math.round(p.y), 2, 2) }
    }
    this.bursts = this.bursts.filter((p) => p.life > 0)
    if (this.cheerLife > 0) {
      c.fillStyle = `rgba(255,211,61,${Math.min(0.18, this.cheerLife * 0.1)})`
      for (let x = 4; x < VIEW_W; x += 12) c.fillRect(x, 66 + ((x / 12) % 3) * 3, 3, 3)
    }
    if (this.flashLife > 0) { c.fillStyle = `rgba(255,250,240,${Math.min(0.45, this.flashLife)})`; c.fillRect(0, 0, VIEW_W, VIEW_H) }
    if (this.crt) {
      c.fillStyle = 'rgba(0,0,0,0.11)'
      for (let y = 1; y < VIEW_H; y += 3) c.fillRect(0, y, VIEW_W, 1)
    }
    c.restore()
    this.texture.refresh()
  }

  resize(w: number, h: number): void { this.image.setDisplaySize(w, h) }
  show(): void { this.image.setVisible(true) }
  hide(): void { this.image.setVisible(false) }
  shake(power: number): void { this.shakePower = Math.max(this.shakePower, power); this.shakeTime = 0 }
  flash(seconds = 0.15): void { this.flashLife = Math.max(this.flashLife, seconds) }
  cheer(seconds = 1): void { this.cheerLife = Math.max(this.cheerLife, seconds) }

  burst(x: number, y: number, colors: readonly string[], count = 18): void {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + (i % 3) * 0.17, speed = 18 + (i % 5) * 7
      this.bursts.push({ x, y, color: colors[i % colors.length], life: 0.35 + (i % 4) * 0.08, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 10 })
    }
  }

  destroy(): void { this.image.destroy(); this.scene.textures.remove(this.key) }
}

export function pixelCircle(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke = RETRO.ink): void {
  c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = Math.max(1, Math.round(r / 5))
  c.beginPath(); c.arc(Math.round(x), Math.round(y), Math.max(1, Math.round(r)), 0, Math.PI * 2); c.fill(); c.stroke()
}

export function pixelLine(c: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, color: string, width: number): void {
  c.strokeStyle = RETRO.ink; c.lineWidth = width + 2; c.beginPath(); c.moveTo(Math.round(ax), Math.round(ay)); c.lineTo(Math.round(bx), Math.round(by)); c.stroke()
  c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(Math.round(ax), Math.round(ay)); c.lineTo(Math.round(bx), Math.round(by)); c.stroke()
}
