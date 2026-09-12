// Comic UI widgets drawn with Graphics: neon city backdrop, floating doodles, comic buttons, panels, halftone overlay.
import Phaser from 'phaser'
import { ACCENTS, DISPLAY, FONT, HEX, P } from '../theme'
import { sfx } from '../fx/sfx'

export function ensureTextures(scene: Phaser.Scene): void {
  const mk = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return
    const g = scene.make.graphics({ x: 0, y: 0 }, false); draw(g); g.generateTexture(key, w, h); g.destroy()
  }
  mk('px', 8, 8, (g) => g.fillStyle(0xffffff).fillRect(0, 0, 8, 8))
  mk('dot', 16, 16, (g) => g.fillStyle(0xffffff).fillCircle(8, 8, 8))
  mk('halftone', 12, 12, (g) => { g.fillStyle(0xffffff, 0.12).fillCircle(3, 3, 2).fillCircle(9, 9, 2) })
  mk('benday', 18, 18, (g) => { g.fillStyle(P.ink, 0.5).fillCircle(4, 4, 3).fillCircle(13, 13, 3) })
  mk('glow', 128, 128, (g) => { for (let r = 64; r > 0; r -= 4) { g.fillStyle(0xffffff, 0.03).fillCircle(64, 64, r) } })
}

/** Comic-book backdrop: bright sky, rotating sunburst rays, Ben-Day dots, speed lines, an ink panel frame and floating action bursts. */
export class ComicBackdrop {
  private rays!: Phaser.GameObjects.Graphics
  private dots!: Phaser.GameObjects.TileSprite
  private bursts: Phaser.GameObjects.Container[] = []
  private t = 0
  private scene: Phaser.Scene
  constructor(scene: Phaser.Scene, seed = 7) { this.scene = scene; this.build(new Phaser.Math.RandomDataGenerator([String(seed)])) }

  private build(rng: Phaser.Math.RandomDataGenerator): void {
    const s = this.scene, W = s.scale.width, H = s.scale.height
    const sky = s.add.graphics().setDepth(-100)
    sky.fillGradientStyle(P.sky1, P.sky1, P.sky2, P.sky2, 1).fillRect(0, 0, W, H)
    // sunburst rays from just above centre
    this.rays = s.add.graphics().setDepth(-99).setPosition(W * 0.5, H * 0.42)
    const R = Math.max(W, H) * 1.3, n = 28
    for (let i = 0; i < n; i++) {
      if (i % 2) continue
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
      this.rays.fillStyle(P.paper, 0.42).fillTriangle(0, 0, Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R)
    }
    // Ben-Day dots
    this.dots = s.add.tileSprite(0, 0, W, H, 'benday').setOrigin(0).setDepth(-98).setAlpha(0.35)
    // speed lines from the corners
    const sl = s.add.graphics().setDepth(-97)
    sl.lineStyle(3, P.ink, 0.35)
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) for (let i = 0; i < 9; i++) {
      const a = Math.atan2(H / 2 - cy, W / 2 - cx) + (i - 4) * 0.09, len = rng.between(60, 160)
      sl.lineBetween(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len)
    }
    // floor band
    const floor = s.add.graphics().setDepth(-96)
    floor.fillStyle(P.red).fillRect(0, H * 0.88, W, H * 0.12)
    floor.fillStyle(P.gold).fillRect(0, H * 0.88, W, 10)
    floor.lineStyle(6, P.ink).lineBetween(0, H * 0.88, W, H * 0.88)
    // panel frame: paper gutter + ink border
    const frame = s.add.graphics().setDepth(-95)
    frame.lineStyle(26, P.paper).strokeRect(0, 0, W, H)
    frame.lineStyle(7, P.ink).strokeRect(13, 13, W - 26, H - 26)
    // action bursts
    const words: [string, number][] = [['POW!', P.red], ['BAM!', P.blue], ['KO!', P.magenta], ['ZAP!', P.green]]
    words.forEach(([w, c], i) => {
      const x = [W * 0.085, W * 0.945, W * 0.075, W * 0.945][i], y = [H * 0.15, H * 0.11, H * 0.78, H * 0.8][i]
      const b = actionBurst(s, x, y, w, c, 40 + rng.between(0, 8)).setDepth(-94).setAngle(rng.between(-16, 16)).setScale(0.75)
      s.tweens.add({ targets: b, y: y - 14, angle: b.angle + rng.between(-6, 6), duration: rng.between(1600, 2600), yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 300 })
      this.bursts.push(b)
    })
  }

  update(dt: number): void {
    this.t += dt
    this.rays.rotation = this.t / 9000
    this.dots.tilePositionX = this.t / 80; this.dots.tilePositionY = this.t / 120
  }
}

/** Spiky comic burst with a word in it. */
export function actionBurst(scene: Phaser.Scene, x: number, y: number, word: string, color: number, r = 50): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y)
  const g = scene.add.graphics()
  const pts: { x: number; y: number }[] = []
  const spikes = 14
  for (let i = 0; i < spikes * 2; i++) { const a = (i / (spikes * 2)) * Math.PI * 2, rr = i % 2 ? r * 0.72 : r * (1 + ((i * 7) % 3) * 0.08); pts.push({ x: Math.cos(a) * rr * 1.25, y: Math.sin(a) * rr }) }
  g.fillStyle(P.ink).fillPoints(pts.map((p) => ({ x: p.x + 6, y: p.y + 7 })), true)
  g.fillStyle(color).fillPoints(pts, true); g.lineStyle(5, P.ink).strokePoints(pts, true)
  const t = scene.add.text(0, 0, word, { fontFamily: DISPLAY, fontSize: `${Math.round(r * 0.62)}px`, color: '#fff6e5', stroke: HEX(P.ink), strokeThickness: 7 }).setOrigin(0.5).setAngle(-8)
  c.add([g, t])
  return c
}

/** Floating comic doodles (stars, bolts, circles) that bob around a menu. */
export function doodles(scene: Phaser.Scene, n = 14): void {
  const W = scene.scale.width, H = scene.scale.height
  for (let i = 0; i < n; i++) {
    const g = scene.add.graphics().setDepth(-50)
    const c = ACCENTS[i % ACCENTS.length], kind = i % 3, size = Phaser.Math.Between(10, 22)
    g.lineStyle(4, P.ink); g.fillStyle(c)
    if (kind === 0) g.fillPoints([{ x: 0, y: -size }, { x: size * 0.35, y: -size * 0.35 }, { x: size, y: 0 }, { x: size * 0.35, y: size * 0.35 }, { x: 0, y: size }, { x: -size * 0.35, y: size * 0.35 }, { x: -size, y: 0 }, { x: -size * 0.35, y: -size * 0.35 }], true)
    else if (kind === 1) g.fillPoints([{ x: 4, y: -size }, { x: -size * 0.5, y: 2 }, { x: 0, y: 2 }, { x: -4, y: size }, { x: size * 0.5, y: -2 }, { x: 0, y: -2 }], true)
    else { g.fillCircle(0, 0, size * 0.7); g.strokeCircle(0, 0, size * 0.7) }
    g.setPosition(Phaser.Math.Between(40, W - 40), Phaser.Math.Between(60, H - 60)).setAlpha(0.9)
    scene.tweens.add({ targets: g, y: g.y - Phaser.Math.Between(14, 30), angle: Phaser.Math.Between(-20, 20), duration: Phaser.Math.Between(1800, 3200), yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: Phaser.Math.Between(0, 1500) })
  }
}

export interface ComicButtonOpts { color?: number; w?: number; h?: number; size?: number; sub?: string; enabled?: boolean; icon?: string }
/** A chunky comic button: tilted panel with thick ink outline, drop shadow, halftone, hover wobble, press stamp. */
export class ComicButton extends Phaser.GameObjects.Container {
  bg: Phaser.GameObjects.Graphics
  label: Phaser.GameObjects.Text
  focused = false
  private baseAngle: number
  private focusTween?: Phaser.Tweens.Tween
  constructor(scene: Phaser.Scene, x: number, y: number, text: string, onSelect: () => void, opts: ComicButtonOpts = {}) {
    super(scene, x, y)
    const w = opts.w ?? 420, h = opts.h ?? 76, color = opts.color ?? P.gold
    this.baseAngle = Phaser.Math.Between(-2, 2)
    this.bg = scene.add.graphics()
    this.draw(w, h, color, false, opts.enabled !== false)
    this.label = scene.add.text(opts.icon ? 16 : 0, opts.sub ? -10 : 0, text, { fontFamily: DISPLAY, fontSize: `${opts.size ?? 34}px`, color: '#fff6e5', stroke: HEX(P.ink), strokeThickness: 8 }).setOrigin(0.5)
    this.add([this.bg, this.label])
    if (opts.icon) this.add(scene.add.text(-w / 2 + 34, 0, opts.icon, { fontSize: '34px' }).setOrigin(0.5))
    if (opts.sub) this.add(scene.add.text(0, 18, opts.sub, { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5))
    this.setSize(w, h).setAngle(this.baseAngle)
    this.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
    this.on('pointerover', () => this.setFocus(true)); this.on('pointerout', () => this.setFocus(false))
    this.on('pointerdown', () => { if (opts.enabled === false) { this.shake(); return } this.stamp(); onSelect() })
    this.setData('draw', (f: boolean) => this.draw(w, h, color, f, opts.enabled !== false))
    scene.add.existing(this as unknown as Phaser.GameObjects.GameObject)
  }
  private draw(w: number, h: number, color: number, hover: boolean, enabled: boolean): void {
    const g = this.bg; g.clear()
    const a = enabled ? 1 : 0.5
    g.fillStyle(P.ink, 0.9).fillRoundedRect(-w / 2 + 8, -h / 2 + 10, w, h, 18)
    g.fillStyle(hover ? Phaser.Display.Color.IntegerToColor(color).brighten(18).color : color, a).fillRoundedRect(-w / 2, -h / 2, w, h, 18)
    g.fillStyle(0xffffff, hover ? 0.28 : 0.16).fillRoundedRect(-w / 2 + 10, -h / 2 + 8, w - 20, h * 0.35, 12)
    g.lineStyle(6, P.ink, a).strokeRoundedRect(-w / 2, -h / 2, w, h, 18)
  }
  setFocus(f: boolean): void {
    if (f === this.focused) return
    this.focused = f
    ;(this.getData('draw') as (f: boolean) => void)(f)
    this.focusTween?.stop()
    if (f) { sfx.hover(); this.focusTween = this.scene.tweens.add({ targets: this, scale: 1.08, angle: 0, duration: 140, ease: 'Back.Out' }) }
    else this.focusTween = this.scene.tweens.add({ targets: this, scale: 1, angle: this.baseAngle, duration: 160, ease: 'Sine.Out' })
  }
  stamp(): void { sfx.select(); this.scene.tweens.add({ targets: this, scale: 0.92, duration: 60, yoyo: true }) }
  shake(): void { sfx.back(); this.scene.tweens.add({ targets: this, x: this.x + 8, duration: 40, yoyo: true, repeat: 3 }) }
}

/** Comic speech-bubble style panel. */
export function comicPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, color = P.paper, tilt = -1.5): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 10, y + 12, w, h, 14)
  g.fillStyle(color).fillRoundedRect(x, y, w, h, 14)
  g.lineStyle(6, P.ink).strokeRoundedRect(x, y, w, h, 14)
  g.setAngle(tilt)
  return g
}

/** Keyboard focus helper for a vertical list of ComicButtons. */
export class MenuNav {
  index = 0
  private items: ComicButton[]
  private onSelect: (i: number) => void
  private onBack?: () => void
  private kb: Phaser.Input.Keyboard.KeyboardPlugin
  private handlers: [string, () => void][] = []
  constructor(scene: Phaser.Scene, items: ComicButton[], onSelect: (i: number) => void, onBack?: () => void, bindEsc = true) {
    this.items = items; this.onSelect = onSelect; this.onBack = onBack
    this.kb = scene.input.keyboard!
    const on = (ev: string, fn: () => void) => { this.kb.on(ev, fn); this.handlers.push([ev, fn]) }
    on('keydown-DOWN', () => this.move(1)); on('keydown-UP', () => this.move(-1))
    on('keydown-S', () => this.move(1)); on('keydown-W', () => this.move(-1))
    on('keydown-RIGHT', () => this.move(1)); on('keydown-LEFT', () => this.move(-1))
    on('keydown-ENTER', () => { this.items[this.index]?.stamp(); this.onSelect(this.index) }); on('keydown-SPACE', () => { this.items[this.index]?.stamp(); this.onSelect(this.index) })
    if (bindEsc) on('keydown-ESC', () => { if (this.onBack) { sfx.back(); this.onBack() } })
    this.items.forEach((b, i) => b.on('pointerover', () => this.focus(i)))
    this.focus(0)
  }
  move(d: number): void { this.focus((this.index + d + this.items.length) % this.items.length) }
  focus(i: number): void { this.items.forEach((b, k) => b.setFocus(k === i)); this.index = i }
  /** Remove the keyboard listeners (call when the menu is closed but the scene lives on). */
  dispose(): void { for (const [ev, fn] of this.handlers) this.kb.off(ev, fn); this.handlers = [] }
}
