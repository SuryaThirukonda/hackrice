// Overlay scene: a hand-drawn cursor and a trail of floating pixels that drift up and fade, in rotating vibrant colors.
import Phaser from 'phaser'
import { ACCENTS, P } from '../theme'

export class CursorTrail extends Phaser.Scene {
  private cursor!: Phaser.GameObjects.Graphics
  private pixels!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter
  private last = new Phaser.Math.Vector2(-1, -1)
  constructor() { super({ key: 'cursor', active: true }) }

  create(): void {
    if (!this.textures.exists('px')) { const g = this.make.graphics({ x: 0, y: 0 }, false); g.fillStyle(0xffffff).fillRect(0, 0, 8, 8); g.generateTexture('px', 8, 8); g.destroy() }
    if (!this.textures.exists('star')) { const g = this.make.graphics({ x: 0, y: 0 }, false); g.fillStyle(0xffffff); g.fillPoints([{ x: 8, y: 0 }, { x: 10, y: 6 }, { x: 16, y: 8 }, { x: 10, y: 10 }, { x: 8, y: 16 }, { x: 6, y: 10 }, { x: 0, y: 8 }, { x: 6, y: 6 }], true); g.generateTexture('star', 16, 16); g.destroy() }
    this.pixels = this.add.particles(0, 0, 'px', {
      speedY: { min: -70, max: -25 }, speedX: { min: -30, max: 30 }, lifespan: { min: 600, max: 1300 }, scale: { start: 1.5, end: 0 },
      alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 }, frequency: 18, quantity: 1, tint: ACCENTS, emitting: false,
    }).setDepth(20_000)
    this.sparks = this.add.particles(0, 0, 'star', { speed: { min: 80, max: 220 }, angle: { min: 0, max: 360 }, lifespan: 500, scale: { start: 1, end: 0 }, tint: [P.gold, P.cyan, P.pink], emitting: false }).setDepth(20_000)
    this.cursor = this.add.graphics().setDepth(20_001)
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p))
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.sparks.explode(14, p.x, p.y); this.tweens.add({ targets: this.cursor, scale: 0.75, duration: 60, yoyo: true }) })
    this.scene.bringToTop()
    this.drawCursor(0)
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const d = Phaser.Math.Distance.Between(p.x, p.y, this.last.x, this.last.y)
    if (d > 3 && this.last.x >= 0) {
      // lay pixels along the whole segment so fast moves leave a continuous trail
      const n = Math.min(24, Math.ceil(d / 6))
      for (let i = 1; i <= n; i++) { const k = i / n; this.pixels.emitParticleAt(Phaser.Math.Linear(this.last.x, p.x, k), Phaser.Math.Linear(this.last.y, p.y, k), 1) }
    }
    this.last.set(p.x, p.y)
    this.cursor.setPosition(p.x, p.y)
  }

  private drawCursor(t: number): void {
    const g = this.cursor; g.clear()
    const c = Phaser.Display.Color.HSVToRGB((t / 4000) % 1, 0.75, 1) as Phaser.Types.Display.ColorObject
    g.fillStyle(P.ink).fillPoints([{ x: 0, y: 0 }, { x: 22, y: 16 }, { x: 13, y: 18 }, { x: 18, y: 28 }, { x: 13, y: 30 }, { x: 8, y: 20 }, { x: 0, y: 26 }], true)
    g.fillStyle(c.color).fillPoints([{ x: 3, y: 5 }, { x: 17, y: 15 }, { x: 10, y: 16 }, { x: 14, y: 25 }, { x: 12, y: 26 }, { x: 8, y: 18 }, { x: 3, y: 22 }], true)
  }

  update(t: number): void {
    this.drawCursor(t)
    this.cursor.rotation = Math.sin(t / 300) * 0.06
  }
}
