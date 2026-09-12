import Phaser from 'phaser'
import { DISPLAY, FONT, HEX, P } from '../../../theme'
import { actionBurst, ComicButton, comicPanel, MenuNav } from '../../../ui/widgets'
import { pauseOverlay, type PauseAction, type PauseRow } from '../../../ui/pauseOverlay'
import { FRAMES } from '../sim/constants'
import type { AimState } from '../keymap'
import type { Scoreboard, Side, Snapshot } from '../sim/types'

const HINT = 'A/D move · Q/E aim · ←→ hook · Space: lock the sweeping line, then hold + release for power · Esc pause · H help'

/** Comic bowling HUD: scoresheet, power meter, aim readout, turn banner, bursts, cards, result and pause panels. Everything is re-laid out by layout(). */
export class BowlingHud {
  private scene: Phaser.Scene
  private W = 0; private H = 0
  private static: Phaser.GameObjects.GameObject[] = []
  private sheet!: Phaser.GameObjects.Graphics
  private sheetTexts: Phaser.GameObjects.Text[] = []
  private rollTxt: Phaser.GameObjects.Text[][] = []
  private scoreTxt: Phaser.GameObjects.Text[][] = []
  private nameTxt: Phaser.GameObjects.Text[] = []
  private meterG!: Phaser.GameObjects.Graphics
  private meterLabel!: Phaser.GameObjects.Text
  private aimG!: Phaser.GameObjects.Graphics
  private aimTxt!: Phaser.GameObjects.Text
  private banner!: Phaser.GameObjects.Text
  private hint!: Phaser.GameObjects.Text
  private card: Phaser.GameObjects.GameObject[] = []
  private overlay: Phaser.GameObjects.GameObject[] = []
  private sheetKey = ''
  private lastAim: AimState | null = null
  private lastMeter: number | null = null
  private lastBanner: [string, number] = ['', P.gold]
  names: [string, string] = ['YOU', 'THE HOUSE']

  constructor(scene: Phaser.Scene) { this.scene = scene; this.layout(scene.scale.width, scene.scale.height) }

  private get nameW(): number { return 200 }
  private get cellW(): number { return Math.min(74, Math.floor((this.W - 60 - this.nameW - 20) / FRAMES)) }
  private get sheetW(): number { return this.nameW + 20 + this.cellW * FRAMES }
  private get sheetX(): number { return Math.round(this.W / 2 - this.sheetW / 2) }

  layout(W: number, H: number): void {
    this.W = W; this.H = H
    for (const o of this.static) o.destroy()
    this.static = []; this.sheetTexts = []; this.rollTxt = []; this.scoreTxt = []; this.nameTxt = []
    const s = this.scene
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.static.push(o); return o }
    // scoresheet: header row of frame numbers, one row per player
    this.sheet = add(s.add.graphics().setDepth(100))
    const sx = this.sheetX, cw = this.cellW
    for (let f = 0; f < FRAMES; f++) this.sheetTexts.push(add(s.add.text(sx + this.nameW + f * cw + cw / 2, 34, String(f + 1), { fontFamily: FONT, fontSize: '12px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5).setDepth(101)))
    for (let p = 0; p < 2; p++) {
      const y = 52 + p * 64
      this.nameTxt.push(add(s.add.text(sx + 16, y + 28, this.names[p], { fontFamily: DISPLAY, fontSize: '20px', color: HEX(p === 0 ? P.blue : P.red), stroke: HEX(P.ink), strokeThickness: 4 }).setOrigin(0, 0.5).setDepth(101)))
      const rolls: Phaser.GameObjects.Text[] = [], scores: Phaser.GameObjects.Text[] = []
      for (let f = 0; f < FRAMES; f++) {
        const x = sx + this.nameW + f * cw
        rolls.push(add(s.add.text(x + cw - 5, y + 4, '', { fontFamily: FONT, fontSize: '13px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(1, 0).setDepth(101)))
        scores.push(add(s.add.text(x + cw / 2, y + 41, '', { fontFamily: DISPLAY, fontSize: '20px', color: HEX(P.ink) }).setOrigin(0.5).setDepth(101)))
      }
      this.rollTxt.push(rolls); this.scoreTxt.push(scores)
    }
    // turn banner under the sheet
    this.banner = add(s.add.text(W / 2, 210, '', { fontFamily: DISPLAY, fontSize: '26px', color: '#fff6e5', stroke: HEX(P.ink), strokeThickness: 7 }).setOrigin(0.5).setDepth(101).setAngle(-1))
    // power meter (right side) and aim readout (bottom left)
    this.meterG = add(s.add.graphics().setDepth(100))
    this.meterLabel = add(s.add.text(W - 52, H * 0.2 - 18, 'POWER', { fontFamily: DISPLAY, fontSize: '18px', color: HEX(P.ink) }).setOrigin(0.5).setDepth(101).setVisible(false))
    this.aimG = add(s.add.graphics().setDepth(100))
    this.aimTxt = add(s.add.text(44, H - 208, '', { fontFamily: FONT, fontSize: '17px', color: HEX(P.ink), fontStyle: '900', lineSpacing: 6 }).setDepth(101).setAngle(-1))
    this.hint = add(s.add.text(W / 2, H - 26, HINT, { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 12, y: 5 } }).setOrigin(0.5).setDepth(101))
    // re-apply the last known state so a resize does not blank the HUD
    this.sheetKey = ''
    this.aimReadout(this.lastAim, this.lastSway)
    this.meter(this.lastMeter)
    this.setTurn(this.lastBanner[0], this.lastBanner[1])
  }

  private static rollMark(rolls: number[], i: number, tenth: boolean): string {
    const r = rolls[i]
    if (r === undefined) return ''
    if (r === 10 && (i === 0 || tenth)) return 'X'
    if (i > 0 && rolls[i - 1] !== 10 && rolls[i - 1] + r === 10) return '/'
    return r === 0 ? '-' : String(r)
  }

  private drawSheet(sb: Record<Side, Scoreboard>, current: Side, frame: number, over: boolean): void {
    const g = this.sheet, sx = this.sheetX, cw = this.cellW, W = this.sheetW
    g.clear()
    g.fillStyle(P.ink, 0.9).fillRoundedRect(sx + 8, 12 + 8, W, 184, 12)
    g.fillStyle(P.paper).fillRoundedRect(sx, 12, W, 184, 12)
    for (let p = 0; p < 2; p++) {
      const side: Side = p === 0 ? 'a' : 'b', y = 52 + p * 64, board = sb[side]
      this.nameTxt[p].setText(this.names[p])
      for (let f = 0; f < FRAMES; f++) {
        const x = sx + this.nameW + f * cw, tenth = f === FRAMES - 1
        const live = !over && side === current && f === frame - 1
        g.fillStyle(live ? P.gold : f % 2 ? 0xfff8e6 : P.paper).fillRect(x, y, cw, 56)
        g.lineStyle(2, P.ink, 0.5).strokeRect(x, y, cw, 56)
        const boxes = tenth ? 3 : 2, bw = Math.min(20, (cw - 6) / boxes)
        for (let b = 0; b < boxes; b++) g.strokeRect(x + cw - 3 - bw * (boxes - b), y, bw, 20)
        const fr = board.frames[f]
        const marks = Array.from({ length: boxes }, (_, i) => BowlingHud.rollMark(fr.rolls, i, tenth).padStart(1, ' ')).join(' ')
        this.rollTxt[p][f].setText(marks.trimEnd()).setX(x + cw - 4)
        this.scoreTxt[p][f].setText(fr.score === null ? '' : String(fr.score))
      }
      g.lineStyle(3, P.ink).strokeRect(sx + this.nameW, y, cw * FRAMES, 56)
    }
    g.lineStyle(6, P.ink).strokeRoundedRect(sx, 12, W, 184, 12)
  }

  update(v: Snapshot, _dt: number): void {
    const over = v.phase === 'game_end'
    const key = `${JSON.stringify(v.scoreboard)}|${v.current}|${v.frame}|${over}|${this.names.join()}`
    if (key !== this.sheetKey) { this.sheetKey = key; this.drawSheet(v.scoreboard, v.current, v.frame, over) }
  }

  /** Vertical power bar on the right; null hides it. */
  meter(value: number | null): void {
    this.lastMeter = value
    const g = this.meterG
    g.clear()
    this.meterLabel.setVisible(value !== null)
    if (value === null) return
    const H = this.H, x = this.W - 70, y0 = H * 0.2, h = H * 0.58, w = 36
    g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 5, y0 + 6, w, h, 10)
    g.fillStyle(P.paper).fillRoundedRect(x, y0, w, h, 10)
    // sweet spot band
    g.fillStyle(P.green, 0.35).fillRect(x + 4, y0 + h * (1 - 0.85), w - 8, h * 0.2)
    const fh = Math.max(0, Math.min(1, value)) * (h - 8)
    g.fillStyle(value > 0.9 ? P.red : value > 0.6 ? P.gold : P.cyan).fillRoundedRect(x + 4, y0 + 4 + (h - 8) - fh, w - 8, fh, 6)
    g.lineStyle(4, P.ink).strokeRoundedRect(x, y0, w, h, 10)
    const my = y0 + 4 + (h - 8) - fh
    g.fillStyle(P.ink).fillTriangle(x - 4, my, x - 18, my - 8, x - 18, my + 8)
    g.fillStyle(P.paper).fillRoundedRect(x - 10, y0 + h + 12, 56, 24, 6); g.lineStyle(3, P.ink).strokeRoundedRect(x - 10, y0 + h + 12, 56, 24, 6)
    this.meterLabel.setText(`${Math.round(value * 100)}%`).setPosition(x + 18, y0 + h + 24).setVisible(true)
  }

  /** Lane position, angle and hook; null hides it (the House's turn). */
  private lastSway = 0
  private lastLocked = false
  aimReadout(aim: AimState | null, sway = this.lastSway, locked = this.lastLocked): void {
    this.lastAim = aim; this.lastSway = sway; this.lastLocked = locked
    const g = this.aimG
    g.clear()
    this.aimTxt.setVisible(aim !== null)
    if (!aim) return
    const H = this.H, x = 30, y = H - 220, w = 270, h = 156
    g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 6, y + 8, w, h, 12)
    g.fillStyle(P.paper).fillRoundedRect(x, y, w, h, 12)
    g.lineStyle(4, P.ink).strokeRoundedRect(x, y, w, h, 12)
    const arrows = (v: number, n: number): string => (v < 0 ? '◀'.repeat(n) : v > 0 ? '▶'.repeat(n) : '·')
    const lane = `${aim.lanePos >= 0 ? '+' : ''}${aim.lanePos.toFixed(2)} m`
    const ang = `${aim.angleDeg >= 0 ? '+' : ''}${aim.angleDeg.toFixed(1)}°`
    const hookN = Math.round(Math.abs(aim.hook) * 5)
    const sw = `${sway >= 0 ? '+' : ''}${sway.toFixed(1)}°${this.lastLocked ? ' LOCKED' : ''}`
    this.aimTxt.setText([`LANE   ${lane.padStart(8)}  ${arrows(aim.lanePos, 1)}`, `ANGLE  ${ang.padStart(8)}  ${arrows(aim.angleDeg, 1)}`, `SWAY   ${sw.padStart(8)}  ${arrows(sway, 1)}`, `HOOK   ${arrows(aim.hook, hookN).padStart(8)}`].join('\n'))
    // sway gauge: a marker sliding on a bar; release when it sits in the centre
    const gx = x + 16, gy = y + h - 18, gw = w - 32
    g.fillStyle(P.ink).fillRoundedRect(gx, gy - 4, gw, 8, 4)
    g.fillStyle(P.green, 0.6).fillRect(gx + gw / 2 - 8, gy - 6, 16, 12)
    const mx = gx + gw / 2 + (sway / 1.6) * (gw / 2 - 6)
    g.fillStyle(locked ? P.green : P.gold).fillCircle(mx, gy, 9); g.lineStyle(3, P.ink).strokeCircle(mx, gy, 9)
  }

  /** Turn banner under the scoresheet ("YOUR ROLL", "THE HOUSE ROLLS"). */
  setTurn(text: string, color = P.gold): void {
    this.lastBanner = [text, color]
    this.banner.setText(text).setColor(HEX(color)).setVisible(text.length > 0)
  }

  burst(word: string, color = P.gold, size = 70): void {
    const W = this.W, H = this.H
    const b = actionBurst(this.scene, W / 2 + Phaser.Math.Between(-W * 0.1, W * 0.1), H * 0.42 + Phaser.Math.Between(-H * 0.06, H * 0.06), word, color, size).setDepth(110).setScale(0)
    this.scene.tweens.add({ targets: b, scale: 1.1, duration: 140, ease: 'Back.Out', onComplete: () => this.scene.tweens.add({ targets: b, scale: 1, y: b.y - 40, alpha: 0, duration: 450, delay: 260, onComplete: () => b.destroy() }) })
  }

  /** Big centre card (loading, frame results). Replaces any current card. */
  showCard(title: string, color: number, sub = '', ms = 900): void {
    this.clearCard()
    const W = this.W, H = this.H
    const panel = comicPanel(this.scene, W / 2 - 280, H * 0.3, 560, 160, color, 2).setDepth(120).setScale(0)
    const t = this.scene.add.text(W / 2, H * 0.3 + 66, title, { fontFamily: DISPLAY, fontSize: '64px', color: '#fff6e5', stroke: HEX(P.ink), strokeThickness: 12 }).setOrigin(0.5).setDepth(121).setAngle(2).setScale(0)
    const s = this.scene.add.text(W / 2, H * 0.3 + 128, sub, { fontFamily: FONT, fontSize: '18px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5).setDepth(121).setAngle(2).setAlpha(0)
    this.card = [panel, t, s]
    this.scene.tweens.add({ targets: [panel, t], scale: 1, duration: 260, ease: 'Back.Out' })
    this.scene.tweens.add({ targets: s, alpha: 1, duration: 200, delay: 150 })
    if (ms > 0) this.scene.time.delayedCall(ms, () => { if (this.card[0] === panel) this.scene.tweens.add({ targets: this.card, alpha: 0, y: '-=40', duration: 220, onComplete: () => this.clearCard() }) })
  }
  clearCard(): void { for (const o of this.card) o.destroy(); this.card = [] }

  /** End-of-game panel with replay and menu buttons. */
  result(title: string, lines: string[], color: number, onReplay: () => void, onMenu: () => void, labels: [string, string] = ['REPLAY', 'BACK TO MENU']): MenuNav {
    this.clearOverlay()
    const W = this.W, H = this.H, s = this.scene
    const dim = s.add.rectangle(0, 0, W, H, P.ink, 0.45).setOrigin(0).setDepth(130)
    const panel = comicPanel(s, W / 2 - 340, H * 0.12, 680, 440, P.paper, -1.5).setDepth(131)
    const t = s.add.text(W / 2, H * 0.12 + 66, title, { fontFamily: DISPLAY, fontSize: '64px', color: HEX(color), stroke: HEX(P.ink), strokeThickness: 10 }).setOrigin(0.5).setDepth(132).setAngle(-1.5)
    const body = s.add.text(W / 2, H * 0.12 + 130, lines.join('\n'), { fontFamily: FONT, fontSize: '20px', color: HEX(P.ink), fontStyle: '900', align: 'center', lineSpacing: 6 }).setOrigin(0.5, 0).setDepth(132).setAngle(-1.5)
    const b1 = new ComicButton(s, W / 2, H * 0.12 + 292, labels[0], onReplay, { color: P.green, w: 340, h: 62, size: 28 }).setDepth(133)
    const b2 = new ComicButton(s, W / 2, H * 0.12 + 370, labels[1], onMenu, { color: P.blue, w: 340, h: 62, size: 28 }).setDepth(133)
    this.overlay = [dim, panel, t, body, b1, b2]
    return new MenuNav(s, [b1, b2], (i) => (i === 0 ? onReplay() : onMenu()))
  }
  private pause: { destroy: () => void } | null = null
  pauseOverlay(rows: PauseRow[], actions: PauseAction[]): void { this.clearOverlay(); this.pause = pauseOverlay(this.scene, rows, actions) }
  clearOverlay(): void { for (const o of this.overlay) o.destroy(); this.overlay = []; this.pause?.destroy(); this.pause = null }
  setHint(text: string): void { this.hint.setText(text) }
  destroy(): void { this.clearCard(); this.clearOverlay(); for (const o of this.static) o.destroy(); this.static = [] }
}
