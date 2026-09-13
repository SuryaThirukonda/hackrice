import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, doodles, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, GAMES, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'
import { Engine3D } from '../engine3d/Engine3D'

/** Game cards with tiny looping previews drawn in code; hover tilts the card, select stamps it. */
export class GameSelectScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private cards: Phaser.GameObjects.Container[] = []
  private previews: ((t: number) => void)[] = []
  private focusTweens: (Phaser.Tweens.Tween | undefined)[] = []
  private index = 0
  private mode = '1p'
  constructor() { super('games') }
  init(d: { mode?: string }): void { this.mode = d?.mode ?? '1p' }

  create(): void {
    this.cards = []; this.previews = []; this.index = 0 // class fields outlive scene restarts
    ensureTextures(this)
    const { width: W, height: H } = this.scale
    this.city = new ComicBackdrop(this, 11)
    void Engine3D.get() // Pre-warm WebGL so entering a sport is immediate.
    doodles(this, 8)
    comicPanel(this, W / 2 - 330, H * 0.06, 660, 84, P.paper, -1.5)
    this.add.text(W / 2, H * 0.06 + 42, `CHOOSE A GAME  ·  ${this.mode === '2p' ? '2 PLAYERS' : this.mode === 'card' ? 'FIGHT NIGHT' : '1 PLAYER'}`, { fontFamily: DISPLAY, fontSize: '40px', color: HEX(P.ink) }).setOrigin(0.5).setAngle(-1.5)
    new ComicButton(this, 90, 48, '◀ BACK', () => { sfx.back(); wipeTo(this, this.mode === 'card' ? 'menu' : 'mode') }, { color: P.blue, w: 110, h: 42, size: 16 })
    const list = this.mode === 'card' ? GAMES.filter((g) => g.id === 'card' || g.id === 'boxing') : GAMES.filter((g) => g.id !== 'card')
    const cw = Math.min(300, (W - 80) / list.length - 24), ch = H * 0.52
    list.forEach((g, i) => {
      const x = W / 2 + (i - (list.length - 1) / 2) * (cw + 24), y = H * 0.55
      const c = this.add.container(x, y + H)
      const bg = this.add.graphics()
      bg.fillStyle(P.ink, 0.9).fillRoundedRect(-cw / 2 + 10, -ch / 2 + 12, cw, ch, 22)
      bg.fillStyle(g.color).fillRoundedRect(-cw / 2, -ch / 2, cw, ch, 22)
      bg.fillStyle(P.paper).fillRoundedRect(-cw / 2 + 14, -ch / 2 + 14, cw - 28, ch * 0.55, 16)
      bg.lineStyle(6, P.ink).strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, 22)
      const pv = this.add.graphics()
      const name = this.add.text(0, ch * 0.16, g.name.toUpperCase(), { fontFamily: DISPLAY, fontSize: '36px', color: '#fff6e5', stroke: HEX(P.ink), strokeThickness: 8 }).setOrigin(0.5)
      const tag = this.add.text(0, ch * 0.3, g.tagline, { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900', wordWrap: { width: cw - 40 }, align: 'center' }).setOrigin(0.5)
      c.add([bg, pv, name, tag])
      c.setSize(cw, ch).setInteractive(new Phaser.Geom.Rectangle(0, 0, cw, ch), Phaser.Geom.Rectangle.Contains)
      c.on('pointerover', () => this.focus(i)); c.on('pointerdown', () => this.select(i))
      this.tweens.add({ targets: c, y, duration: 520, delay: 120 + i * 110, ease: 'Back.Out' })
      this.cards.push(c)
      this.previews.push(this.makePreview(g.id, pv, cw - 28, ch * 0.55, -ch / 2 + 14))
    })
    const kb = this.input.keyboard!
    kb.on('keydown-RIGHT', () => this.focus((this.index + 1) % this.cards.length)); kb.on('keydown-LEFT', () => this.focus((this.index - 1 + this.cards.length) % this.cards.length))
    kb.on('keydown-D', () => this.focus((this.index + 1) % this.cards.length)); kb.on('keydown-A', () => this.focus((this.index - 1 + this.cards.length) % this.cards.length))
    kb.on('keydown-ENTER', () => this.select(this.index)); kb.on('keydown-SPACE', () => this.select(this.index))
    kb.on('keydown-ESC', () => { sfx.back(); wipeTo(this, this.mode === 'card' ? 'menu' : 'mode') })
    this.focus(0)
    this.add.text(W / 2, H - 28, '←→ choose  ·  Enter select  ·  Esc back', { fontFamily: FONT, fontSize: '16px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 12, y: 5 } }).setOrigin(0.5)
  }

  private focus(i: number): void {
    if (i !== this.index) sfx.hover()
    this.index = i
    this.cards.forEach((c, k) => { this.focusTweens[k]?.stop(); this.focusTweens[k] = this.tweens.add({ targets: c, scale: k === i ? 1.06 : 0.96, angle: k === i ? 0 : (k < i ? -3 : 3), duration: 180, ease: 'Back.Out' }) })
  }
  private select(i: number): void {
    if (!this.scene.isActive() || !this.cards[i] || this.cards[i].list.length < 3) return
    const g = GAMES.find((x) => this.cards[i] && x.name.toUpperCase() === (this.cards[i].list[2] as Phaser.GameObjects.Text).text)!
    sfx.select(); this.tweens.add({ targets: this.cards[i], scale: 0.9, duration: 60, yoyo: true, onComplete: () => {
      if (g.id === 'boxing' || g.id === 'bowling' || g.id === 'golf') wipeTo(this, 'prefight', { game: g.id, mode: this.mode === 'card' ? 'card' : '1p' })
      else wipeTo(this, 'placeholder', { title: g.name.toUpperCase(), sub: `${this.mode.toUpperCase()} · coming next`, color: g.color })
    } })
  }

  /** Little looping vignettes: a boxer jabbing, a ball rolling into pins, a pitch and swing, two chips clashing. */
  private makePreview(id: string, g: Phaser.GameObjects.Graphics, w: number, h: number, top: number): (t: number) => void {
    const cx = 0, cy = top + h / 2
    return (t: number) => {
      g.clear()
      const s = t / 1000
      if (id === 'boxing') {
        const jab = Math.max(0, Math.sin(s * 4)) ** 4
        g.fillStyle(P.ink, 0.4).fillEllipse(cx - 40, cy + 50, 60, 14).fillEllipse(cx + 44, cy + 50, 60, 14)
        for (const [x, col, dir] of [[-40, P.cyan, 1], [44, P.red, -1]] as [number, number, number][]) {
          const j = dir === 1 ? jab : Math.max(0, Math.sin(s * 4 + 2)) ** 4
          g.fillStyle(col).fillRoundedRect(x - 16, cy - 30 + Math.sin(s * 6) * 2, 32, 58, 10); g.lineStyle(4, P.ink).strokeRoundedRect(x - 16, cy - 30 + Math.sin(s * 6) * 2, 32, 58, 10)
          g.fillStyle(0xf6c9a0).fillCircle(x, cy - 46, 14); g.lineStyle(4, P.ink).strokeCircle(x, cy - 46, 14)
          g.fillStyle(P.gold).fillCircle(x + dir * (22 + 40 * j), cy - 20, 11); g.lineStyle(4, P.ink).strokeCircle(x + dir * (22 + 40 * j), cy - 20, 11)
          if (j > 0.9) { g.lineStyle(3, 0xffffff); for (let k = 0; k < 3; k++) g.lineBetween(x + dir * 70, cy - 30 + k * 10, x + dir * 90, cy - 36 + k * 12) }
        }
      } else if (id === 'bowling') {
        const k = (s % 2) / 2
        g.fillStyle(0xe9c98a).fillPoints([{ x: -w / 2 + 30, y: cy + h / 2 - 10 }, { x: w / 2 - 30, y: cy + h / 2 - 10 }, { x: 40, y: top + 20 }, { x: -40, y: top + 20 }], true)
        g.lineStyle(3, P.ink).strokePoints([{ x: -w / 2 + 30, y: cy + h / 2 - 10 }, { x: w / 2 - 30, y: cy + h / 2 - 10 }, { x: 40, y: top + 20 }, { x: -40, y: top + 20 }], true)
        for (let i = 0; i < 4; i++) { const px = (i - 1.5) * 16, fall = k > 0.85 ? (k - 0.85) * 6 : 0; g.fillStyle(0xffffff).fillRoundedRect(px - 4, top + 12 - 20 + fall * 10, 8, 20, 3); g.lineStyle(2, P.ink).strokeRoundedRect(px - 4, top + 12 - 20 + fall * 10, 8, 20, 3) }
        const by = cy + h / 2 - 20 - k * (h - 50), r = 16 - k * 10
        g.fillStyle(P.magenta).fillCircle(Math.sin(k * 3) * 20, by, r); g.lineStyle(3, P.ink).strokeCircle(Math.sin(k * 3) * 20, by, r)
        if (k > 0.85) { g.fillStyle(P.gold); g.fillPoints([{ x: 0, y: top + 4 }, { x: 8, y: top + 20 }, { x: -8, y: top + 20 }], true) }
      } else if (id === 'golf') {
        g.fillStyle(0x3aa655).fillRect(-w / 2 + 14, cy - 10, w - 28, h / 2 + 4)
        g.fillStyle(0x7ed957).fillEllipse(30, cy + 22, 90, 34)
        g.lineStyle(3, P.ink).lineBetween(46, cy + 22, 46, cy - 30); g.fillStyle(P.red).fillTriangle(46, cy - 30, 70, cy - 22, 46, cy - 14)
        const k = (s % 2.2) / 2.2
        const bx = -70 + k * 116, by = cy + 20 - Math.sin(k * Math.PI) * 70
        g.fillStyle(0xffffff).fillCircle(bx, by, 5); g.lineStyle(2, P.ink).strokeCircle(bx, by, 5)
        g.lineStyle(6, 0x8a5a2b).lineBetween(-72, cy + 24, -72 + Math.cos(-1.6 + k * 4) * 40, cy + 24 + Math.sin(-1.6 + k * 4) * 40)
        g.fillStyle(P.cyan).fillRoundedRect(-84, cy - 16, 24, 40, 8)
      } else {
        const k = Math.sin(s * 3)
        for (const [x, col] of [[-36, P.cyan], [36, P.red]] as [number, number][]) { g.fillStyle(col).fillCircle(x + Math.sign(x) * -k * 12, cy, 30); g.lineStyle(4, P.ink).strokeCircle(x + Math.sign(x) * -k * 12, cy, 30); g.fillStyle(P.gold).fillCircle(x + Math.sign(x) * -k * 12, cy, 12) }
        if (k > 0.8) { g.fillStyle(P.gold).fillPoints([{ x: 0, y: cy - 34 }, { x: 10, y: cy - 8 }, { x: 34, y: cy }, { x: 10, y: cy + 8 }, { x: 0, y: cy + 34 }, { x: -10, y: cy + 8 }, { x: -34, y: cy }, { x: -10, y: cy - 8 }], true) }
      }
    }
  }

  update(t: number, dt: number): void { this.city.update(dt); this.previews.forEach((p) => p(t)) }
}
