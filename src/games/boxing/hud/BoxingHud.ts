import Phaser from 'phaser'
import { DISPLAY, FONT, HEX, P } from '../../../theme'
import { actionBurst, ComicButton, comicPanel, MenuNav } from '../../../ui/widgets'
import { pauseOverlay, type PauseAction, type PauseRow } from '../../../ui/pauseOverlay'
import type { Snapshot } from '../sim/types'

const WORDS = ['POW!', 'BAM!', 'WHAM!', 'SMACK!', 'THWACK!']

/** Comic fight HUD: bars, timer, cards, bursts, flash, result and pause panels. Everything is re-laid out by layout(). */
export class BoxingHud {
  private scene: Phaser.Scene
  private W = 0; private H = 0
  private bars!: Phaser.GameObjects.Graphics
  private timer!: Phaser.GameObjects.Text
  private roundTxt!: Phaser.GameObjects.Text
  private nameA!: Phaser.GameObjects.Text
  private nameB!: Phaser.GameObjects.Text
  private hint!: Phaser.GameObjects.Text
  private flash!: Phaser.GameObjects.Rectangle
  private card: Phaser.GameObjects.GameObject[] = []
  private ghostA = 100; private ghostB = 100
  private timerPanel!: Phaser.GameObjects.Graphics
  private punchWash!: Phaser.GameObjects.Rectangle
  private punchRing!: Phaser.GameObjects.Arc
  private static: Phaser.GameObjects.GameObject[] = []
  private overlay: Phaser.GameObjects.GameObject[] = []
  names: [string, string] = ['YOU', 'THE HOUSE']

  constructor(scene: Phaser.Scene) { this.scene = scene; this.layout(scene.scale.width, scene.scale.height) }

  layout(W: number, H: number): void {
    this.W = W; this.H = H
    for (const o of this.static) o.destroy()
    this.static = []
    const s = this.scene
    this.bars = s.add.graphics().setDepth(100)
    this.timerPanel = comicPanel(s, W / 2 - 76, 12, 152, 70, P.paper, -1.5).setDepth(100)
    this.timer = s.add.text(W / 2, 40, '1:30', { fontFamily: DISPLAY, fontSize: '40px', color: HEX(P.ink) }).setOrigin(0.5).setDepth(101).setAngle(-1.5)
    this.roundTxt = s.add.text(W / 2, 70, 'ROUND 1', { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5).setDepth(101).setAngle(-1.5)
    this.nameA = s.add.text(30, 14, this.names[0], { fontFamily: DISPLAY, fontSize: '24px', color: HEX(P.blue), stroke: HEX(P.ink), strokeThickness: 6 }).setDepth(101)
    this.nameB = s.add.text(W - 30, 14, this.names[1], { fontFamily: DISPLAY, fontSize: '24px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 6 }).setOrigin(1, 0).setDepth(101)
    this.hint = s.add.text(W / 2, H - 26, 'J jab · K cross · Space block · A/D step · Q/E sway · W duck · ↑↓ in/out · Esc pause · H help', { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 12, y: 5 } }).setOrigin(0.5).setDepth(101)
    this.flash = s.add.rectangle(0, 0, W, H, P.red, 0).setOrigin(0).setDepth(90)
    // One wash and one ring for the phone-punch flash, reused every swing. Per-swing objects leaked:
    // the scene slows the tween clock during hit-stop, so their fade-out tweens could outlive a fight.
    this.punchWash = s.add.rectangle(14, 6, Math.min(430, W * 0.42), 96, P.green, 0).setOrigin(0).setDepth(99)
    this.punchRing = s.add.circle(214, 50, 26).setStrokeStyle(8, P.green).setAlpha(0).setDepth(102)
    this.static.push(this.bars, this.timerPanel, this.timer, this.roundTxt, this.nameA, this.nameB, this.hint, this.flash, this.punchWash, this.punchRing)
  }

  private bar(x: number, y: number, w: number, h: number, ratio: number, ghost: number, color: number, rtl: boolean): void {
    const g = this.bars
    g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 4, y + 5, w, h, 8)
    g.fillStyle(P.paper).fillRoundedRect(x, y, w, h, 8)
    const gw = Math.max(0, Math.min(1, ghost)) * (w - 8), fw = Math.max(0, Math.min(1, ratio)) * (w - 8)
    const gx = rtl ? x + 4 + (w - 8) - gw : x + 4, fx = rtl ? x + 4 + (w - 8) - fw : x + 4
    if (gw > 0) g.fillStyle(P.orange, 0.8).fillRoundedRect(gx, y + 4, gw, h - 8, 5)
    if (fw > 0) g.fillStyle(color).fillRoundedRect(fx, y + 4, fw, h - 8, 5)
    g.lineStyle(4, P.ink).strokeRoundedRect(x, y, w, h, 8)
  }

  private gassedFlash = 0
  /** Flash the stamina bar red when a punch is refused. */
  gassed(): void { this.gassedFlash = 0.5 }

  /** One slim stamina bar under the health bar, split into ten segments (punches and blocks spend it, idle refills it). A shield marks a held guard. */
  private stamina(x: number, y: number, w: number, stamina: number, guard: boolean, rtl: boolean, flash: number): void {
    const g = this.bars, n = 10, gap = 3, h = 10, sw = (w - gap * (n - 1)) / n
    const blink = flash > 0 && Math.floor(flash * 12) % 2 === 0
    g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 2, y + 3, w, h, 4)
    g.fillStyle(blink ? P.red : P.paper).fillRoundedRect(x, y, w, h, 4)
    for (let i = 0; i < n; i++) {
      const k = rtl ? n - 1 - i : i
      const fill = Math.max(0, Math.min(1, stamina / 10 - i))
      if (fill > 0) g.fillStyle(stamina < 20 ? P.orange : P.cyan).fillRect(x + k * (sw + gap) + (rtl ? sw * (1 - fill) : 0) + 1, y + 2, (sw - 2) * fill, h - 4)
    }
    g.lineStyle(2, P.ink).strokeRoundedRect(x, y, w, h, 4)
    for (let i = 1; i < n; i++) g.fillStyle(P.ink).fillRect(x + i * (sw + gap) - gap, y, gap, h)
    if (guard) {
      const sx = rtl ? x - 24 : x + w + 8, sy = y - 4
      g.fillStyle(P.blue).fillRoundedRect(sx, sy, 16, 18, 4); g.lineStyle(2, P.ink).strokeRoundedRect(sx, sy, 16, 18, 4)
      g.fillStyle(P.paper).fillRect(sx + 3, sy + 5, 10, 3)
    }
  }

  update(v: Snapshot, dt: number): void {
    const W = this.W
    this.gassedFlash = Math.max(0, this.gassedFlash - dt)
    this.ghostA += (v.a.hp - this.ghostA) * Math.min(1, dt * 2.5); this.ghostB += (v.b.hp - this.ghostB) * Math.min(1, dt * 2.5)
    this.bars.clear()
    const bw = Math.min(420, W * 0.36)
    const hpCol = (r: number) => (r > 0.5 ? P.green : r > 0.25 ? P.gold : P.red)
    this.bar(30, 48, bw, 28, v.a.hp / 100, this.ghostA / 100, hpCol(v.a.hp / 100), false)
    this.stamina(30, 82, bw, v.a.stamina, v.a.guard, false, this.gassedFlash)
    this.bar(W - 30 - bw, 48, bw, 28, v.b.hp / 100, this.ghostB / 100, hpCol(v.b.hp / 100), true)
    this.stamina(W - 30 - bw, 82, bw, v.b.stamina, v.b.guard, true, 0)
    // knockdown pips
    for (let i = 0; i < 3; i++) {
      this.bars.fillStyle(i < v.a.kd ? P.red : P.paper).fillCircle(40 + i * 20, 108, 7); this.bars.lineStyle(3, P.ink).strokeCircle(40 + i * 20, 108, 7)
      this.bars.fillStyle(i < v.b.kd ? P.red : P.paper).fillCircle(W - 40 - i * 20, 108, 7); this.bars.lineStyle(3, P.ink).strokeCircle(W - 40 - i * 20, 108, 7)
    }
    const c = Math.ceil(v.clock)
    this.timer.setText(`${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`)
    this.roundTxt.setText(v.phase === 'count' ? `COUNT ${v.count}` : `ROUND ${v.round}`)
  }

  hitFlash(alpha = 0.35): void { this.flash.setAlpha(alpha); this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 180 }) }

  /** A phone swing was accepted as a punch. A green ring swells off the player's bars and a green wash
   *  crosses their corner, so a player watching the screen rather than the phone sees the swing
   *  register before the punch itself resolves. Keyboard punches never trigger this. */
  phonePunch(): void {
    const s = this.scene
    s.tweens.killTweensOf([this.punchWash, this.punchRing])
    this.punchWash.setAlpha(0.3)
    this.punchRing.setScale(1).setAlpha(1)
    s.tweens.add({ targets: this.punchWash, alpha: 0, duration: 340, ease: 'Quad.Out' })
    s.tweens.add({ targets: this.punchRing, scale: 3.6, alpha: 0, duration: 440, ease: 'Cubic.Out' })
  }

  burst(word?: string, color = P.gold, size = 70): void {
    const W = this.W, H = this.H
    const b = actionBurst(this.scene, W / 2 + Phaser.Math.Between(-W * 0.12, W * 0.12), H * 0.4 + Phaser.Math.Between(-H * 0.08, H * 0.08), word ?? Phaser.Utils.Array.GetRandom(WORDS), color, size).setDepth(110).setScale(0)
    this.scene.tweens.add({ targets: b, scale: 1.1, duration: 140, ease: 'Back.Out', onComplete: () => this.scene.tweens.add({ targets: b, scale: 1, y: b.y - 40, alpha: 0, duration: 450, delay: 120, onComplete: () => b.destroy() }) })
  }

  /** Big centre card (round, countdown, KO). Replaces any current card. */
  showCard(title: string, color: number, sub = '', ms = 900): void {
    this.clearCard()
    const W = this.W, H = this.H
    const panel = comicPanel(this.scene, W / 2 - 280, H * 0.3, 560, 160, color, 2).setDepth(120).setScale(0)
    const t = this.scene.add.text(W / 2, H * 0.3 + 66, title, { fontFamily: DISPLAY, fontSize: '72px', color: '#fff6e5', stroke: HEX(P.ink), strokeThickness: 12 }).setOrigin(0.5).setDepth(121).setAngle(2).setScale(0)
    const s = this.scene.add.text(W / 2, H * 0.3 + 128, sub, { fontFamily: FONT, fontSize: '18px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5).setDepth(121).setAngle(2).setAlpha(0)
    this.card = [panel, t, s]
    this.scene.tweens.add({ targets: [panel, t], scale: 1, duration: 260, ease: 'Back.Out' })
    this.scene.tweens.add({ targets: s, alpha: 1, duration: 200, delay: 150 })
    if (ms > 0) this.scene.time.delayedCall(ms, () => { if (this.card[0] === panel) this.scene.tweens.add({ targets: this.card, alpha: 0, y: '-=40', duration: 220, onComplete: () => this.clearCard() }) })
  }
  countdownNumber(n: number): void {
    this.clearCard()
    const W = this.W, H = this.H
    const t = this.scene.add.text(W / 2, H * 0.45, n === 0 ? 'FIGHT!' : String(n), { fontFamily: DISPLAY, fontSize: n === 0 ? '140px' : '180px', color: HEX(n === 0 ? P.red : P.gold), stroke: HEX(P.ink), strokeThickness: 16 }).setOrigin(0.5).setDepth(121).setScale(2).setAlpha(0)
    this.card = [t]
    this.scene.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 260, ease: 'Cubic.Out', onComplete: () => this.scene.tweens.add({ targets: t, alpha: 0, duration: 300, delay: n === 0 ? 350 : 380, onComplete: () => { if (this.card[0] === t) this.clearCard() } }) })
  }
  clearCard(): void { for (const o of this.card) o.destroy(); this.card = [] }

  /** End-of-match panel with rematch and menu buttons. */
  result(title: string, lines: string[], color: number, onRematch: () => void, onMenu: () => void, labels: [string, string] = ['REMATCH', 'BACK TO MENU']): MenuNav {
    this.clearOverlay()
    const W = this.W, H = this.H, s = this.scene
    const dim = s.add.rectangle(0, 0, W, H, P.ink, 0.45).setOrigin(0).setDepth(130)
    const panel = comicPanel(s, W / 2 - 340, H * 0.12, 680, 440, P.paper, -1.5).setDepth(131)
    const t = s.add.text(W / 2, H * 0.12 + 66, title, { fontFamily: DISPLAY, fontSize: '64px', color: HEX(color), stroke: HEX(P.ink), strokeThickness: 10 }).setOrigin(0.5).setDepth(132).setAngle(-1.5)
    const body = s.add.text(W / 2, H * 0.12 + 130, lines.join('\n'), { fontFamily: FONT, fontSize: '20px', color: HEX(P.ink), fontStyle: '900', align: 'center', lineSpacing: 6 }).setOrigin(0.5, 0).setDepth(132).setAngle(-1.5)
    const b1 = new ComicButton(s, W / 2, H * 0.12 + 292, labels[0], onRematch, { color: P.green, w: 340, h: 62, size: 28 }).setDepth(133)
    const b2 = new ComicButton(s, W / 2, H * 0.12 + 370, labels[1], onMenu, { color: P.blue, w: 340, h: 62, size: 28 }).setDepth(133)
    this.overlay = [dim, panel, t, body, b1, b2]
    return new MenuNav(s, [b1, b2], (i) => (i === 0 ? onRematch() : onMenu()))
  }
  private pause: { destroy: () => void } | null = null
  pauseOverlay(rows: PauseRow[], actions: PauseAction[]): void { this.clearOverlay(); this.pause = pauseOverlay(this.scene, rows, actions) }
  clearOverlay(): void { for (const o of this.overlay) o.destroy(); this.overlay = []; this.pause?.destroy(); this.pause = null }

  private bubbles: Phaser.GameObjects.GameObject[] = []
  /** Comic speech bubble near a corner's bar. */
  taunt(side: 'a' | 'b', text: string): void {
    const W = this.W, s = this.scene
    const x = side === 'a' ? 60 : W - 60 - 360, y = 160
    const g = s.add.graphics().setDepth(112)
    g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 5, y + 6, 360, 54, 14); g.fillStyle(P.paper).fillRoundedRect(x, y, 360, 54, 14); g.lineStyle(4, P.ink).strokeRoundedRect(x, y, 360, 54, 14)
    g.fillStyle(P.paper).fillTriangle(x + 40, y, x + 62, y, x + 44, y - 16); g.lineStyle(4, P.ink).lineBetween(x + 40, y, x + 44, y - 16); g.lineBetween(x + 44, y - 16, x + 62, y)
    const t = s.add.text(x + 180, y + 27, text, { fontFamily: FONT, fontSize: '16px', color: HEX(P.ink), fontStyle: '900', wordWrap: { width: 340 }, align: 'center' }).setOrigin(0.5).setDepth(113)
    for (const o of this.bubbles) o.destroy()
    this.bubbles = [g, t]
    s.tweens.add({ targets: [g, t], alpha: 0, delay: 3200, duration: 400, onComplete: () => { g.destroy(); t.destroy() } })
  }
  private status: Phaser.GameObjects.Text[] = []
  /** Per-corner agent status line (latency, source). */
  cornerStatus(a: string, b: string): void {
    if (!this.status.length) {
      this.status = [
        this.scene.add.text(30, 126, '', { fontFamily: FONT, fontSize: '13px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 6, y: 2 } }).setDepth(101),
        this.scene.add.text(this.W - 30, 126, '', { fontFamily: FONT, fontSize: '13px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 6, y: 2 } }).setOrigin(1, 0).setDepth(101),
      ]
      this.static.push(...this.status)
    }
    this.status[0].setText(a); this.status[1].setText(b)
  }
  private betObjs: Phaser.GameObjects.GameObject[] = []
  /** Betting window panel. */
  betPanel(o: { round: number; odds: { a: number; b: number }; names: [string, string]; corner: 'a' | 'b'; stake: number; balance: number; kind: string; secondsLeft: number; placed: string | null }): void {
    for (const x of this.betObjs) x.destroy()
    this.betObjs = []
    const W = this.W, H = this.H, s = this.scene
    const add = <T extends Phaser.GameObjects.GameObject>(g: T): T => { this.betObjs.push(g); return g }
    add(comicPanel(s, W / 2 - 330, H * 0.22, 660, 300, P.paper, -1).setDepth(125))
    add(s.add.text(W / 2, H * 0.22 + 44, `PLACE YOUR BETS · ${o.kind.toUpperCase()} ${o.kind === 'round' ? o.round : ''}`, { fontFamily: DISPLAY, fontSize: '34px', color: HEX(P.ink) }).setOrigin(0.5).setDepth(126).setAngle(-1))
    for (const [i, side] of (['a', 'b'] as const).entries()) {
      const x = W / 2 - 160 + i * 320, sel = o.corner === side
      const g = add(s.add.graphics().setDepth(126))
      g.fillStyle(P.ink, 0.9).fillRoundedRect(x - 130 + 5, H * 0.22 + 80 + 6, 260, 90, 14)
      g.fillStyle(sel ? (side === 'a' ? P.blue : P.red) : P.paper).fillRoundedRect(x - 130, H * 0.22 + 80, 260, 90, 14); g.lineStyle(5, P.ink).strokeRoundedRect(x - 130, H * 0.22 + 80, 260, 90, 14)
      add(s.add.text(x, H * 0.22 + 108, o.names[i], { fontFamily: DISPLAY, fontSize: '24px', color: sel ? '#fff6e5' : HEX(P.ink), stroke: HEX(P.ink), strokeThickness: sel ? 5 : 0 }).setOrigin(0.5).setDepth(127))
      add(s.add.text(x, H * 0.22 + 145, `pays ${o.odds[side].toFixed(2)}x`, { fontFamily: FONT, fontSize: '16px', color: sel ? '#fff6e5' : HEX(P.ink), fontStyle: '900' }).setOrigin(0.5).setDepth(127))
    }
    add(s.add.text(W / 2, H * 0.22 + 205, o.placed ?? `stake ${o.stake} chips  ·  balance ${o.balance}`, { fontFamily: DISPLAY, fontSize: '26px', color: HEX(o.placed ? P.green : P.ink) }).setOrigin(0.5).setDepth(127))
    add(s.add.text(W / 2, H * 0.22 + 250, `A/D corner · ↑↓ stake · Enter place · Space skip · ${o.secondsLeft}s`, { fontFamily: FONT, fontSize: '15px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5).setDepth(127))
  }
  clearBet(): void { for (const x of this.betObjs) x.destroy(); this.betObjs = [] }
  setHint(text: string): void { this.hint.setText(text) }
  destroy(): void { this.clearCard(); this.clearOverlay(); this.clearBet(); for (const o of this.bubbles) o.destroy(); for (const o of this.static) o.destroy() }
}
