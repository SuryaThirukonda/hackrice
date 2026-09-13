import Phaser from 'phaser'
import { DISPLAY, FONT, HEX, P } from '../../../theme'
import { actionBurst, ComicButton, comicPanel, MenuNav } from '../../../ui/widgets'
import { pauseOverlay, type PauseAction, type PauseRow } from '../../../ui/pauseOverlay'
import { ACC_SWEET, type MeterState } from '../keymap'
import { carryTable } from '../sim/clubs'
import type { Club, GolfSnapshot, Hole, V2 } from '../sim/types'

export const CLUB_NAMES: Record<Club, string> = { driver: 'DRIVER', wood3: '3 WOOD', iron5: '5 IRON', iron7: '7 IRON', wedge: 'WEDGE', putter: 'PUTTER' }
const MAP = 170
const RAD = Math.PI / 180

/** Per-frame scene state the HUD draws that the sim snapshot does not carry. */
export interface HudState { club: Club; heading: number; myTurn: boolean; meter: { state: MeterState; value: number; power: number; accuracy: number }; nHoles: number }

export const toParText = (n: number): string => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`)

/** Comic golf HUD: hole banner, strokes, club, wind, swing meter, scorecard, minimap, bursts, cards, result and pause panels. */
export class GolfHud {
  private scene: Phaser.Scene
  private W = 0; private H = 0
  private dyn!: Phaser.GameObjects.Graphics
  private holeTxt!: Phaser.GameObjects.Text
  private distTxt!: Phaser.GameObjects.Text
  private nameA!: Phaser.GameObjects.Text
  private nameB!: Phaser.GameObjects.Text
  private strokesA!: Phaser.GameObjects.Text
  private strokesB!: Phaser.GameObjects.Text
  private clubTxt!: Phaser.GameObjects.Text
  private carryTxt!: Phaser.GameObjects.Text
  private windTxt!: Phaser.GameObjects.Text
  private meterTxt!: Phaser.GameObjects.Text
  private cardCols: Phaser.GameObjects.Text[] = []
  private hint!: Phaser.GameObjects.Text
  private turnTxt!: Phaser.GameObjects.Text
  private card: Phaser.GameObjects.GameObject[] = []
  private static: Phaser.GameObjects.GameObject[] = []
  private overlay: Phaser.GameObjects.GameObject[] = []
  private mapBox = { x: 0, y: 0 }
  private meterBox = { x: 0, y: 0, w: 400, h: 30 }
  private windBox = { x: 0, y: 0 }
  names: [string, string] = ['YOU', 'THE HOUSE']
  private courseName = ''

  constructor(scene: Phaser.Scene) { this.scene = scene; this.layout(scene.scale.width, scene.scale.height) }

  layout(W: number, H: number): void {
    this.W = W; this.H = H
    for (const o of this.static) o.destroy()
    this.static = []
    const s = this.scene
    const add = <T extends Phaser.GameObjects.GameObject>(g: T): T => { this.static.push(g); return g }
    const label = (x: number, y: number, text: string, size: number, color: number, origin: [number, number] = [0, 0]) =>
      add(s.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color: HEX(color), fontStyle: '900' }).setOrigin(origin[0], origin[1]).setDepth(101))
    // hole banner (top-left, under the player block, so the centre of the screen stays clear)
    add(comicPanel(s, 30, 104, 330, 56, P.paper, -1, 0.85).setDepth(100))
    this.holeTxt = add(s.add.text(42, 118, 'HOLE 1 · PAR 3', { fontFamily: DISPLAY, fontSize: '19px', color: HEX(P.ink) }).setOrigin(0, 0.5).setDepth(101).setAngle(-1))
    this.distTxt = add(s.add.text(42, 144, '150 m to the cup', { fontFamily: FONT, fontSize: '13px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0, 0.5).setDepth(101).setAngle(-1))
    // players
    this.nameA = add(s.add.text(30, 14, this.names[0], { fontFamily: DISPLAY, fontSize: '24px', color: HEX(P.blue), stroke: HEX(P.ink), strokeThickness: 6 }).setDepth(101))
    this.nameB = add(s.add.text(W - 30, 14, this.names[1], { fontFamily: DISPLAY, fontSize: '24px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 6 }).setOrigin(1, 0).setDepth(101))
    this.strokesA = label(30, 48, 'STROKES 0', 16, P.ink)
    this.strokesB = label(W - 30, 48, 'STROKES 0', 16, P.ink, [1, 0])
    this.turnTxt = add(s.add.text(30, 74, '', { fontFamily: DISPLAY, fontSize: '20px', color: HEX(P.gold), stroke: HEX(P.ink), strokeThickness: 5 }).setDepth(101))
    // club (bottom-left)
    add(comicPanel(s, 30, H - 132, 250, 80, P.paper, 1, 0.85).setDepth(100))
    this.clubTxt = add(s.add.text(44, H - 120, '7 IRON', { fontFamily: DISPLAY, fontSize: '30px', color: HEX(P.ink) }).setDepth(101).setAngle(1))
    this.carryTxt = label(44, H - 84, 'carries 135 m · W/S to change', 13, P.ink)
    // wind (top-right, under the name)
    this.windBox = { x: W - 30 - 150, y: 76 }
    add(comicPanel(s, this.windBox.x, this.windBox.y, 150, 48, P.paper, 1, 0.85).setDepth(100))
    this.windTxt = label(this.windBox.x + 12, this.windBox.y + 8, 'WIND\n0.0 m/s', 13, P.ink)
    // scorecard (right)
    const sy = 138, sx = W - 30 - 200
    add(comicPanel(s, sx, sy, 200, 120, P.paper, -1, 0.85).setDepth(100))
    this.cardCols = [34, 80, 122, 166].map((cx, i) => add(s.add.text(sx + cx, sy + 10, '', { fontFamily: FONT, fontSize: '13px', color: HEX(i === 2 ? P.blue : i === 3 ? P.red : P.ink), fontStyle: '900', align: 'center', lineSpacing: 1 }).setOrigin(0.5, 0).setDepth(101)))
    // minimap (bottom-right)
    this.mapBox = { x: W - 30 - MAP, y: H - 56 - MAP }
    // swing meter (bottom-centre)
    this.meterBox = { x: W / 2 - 200, y: H - 100, w: 400, h: 30 }
    this.meterTxt = add(s.add.text(W / 2, H - 112, '', { fontFamily: DISPLAY, fontSize: '20px', color: '#fff6e5', stroke: HEX(P.ink), strokeThickness: 5 }).setOrigin(0.5, 1).setDepth(101))
    this.hint = add(s.add.text(W / 2, H - 26, 'W/S club · A/D aim · Space swing ×3 · Tab map · Esc pause · H help', { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 12, y: 5 } }).setOrigin(0.5).setDepth(101).setInteractive({ cursor: 'pointer' }))
    this.hint.on('pointerdown', () => (this.scene as unknown as { togglePause?: () => void }).togglePause?.())
    add(new ComicButton(s, W - 66, H - 26, '⏸ PAUSE', () => (this.scene as unknown as { togglePause?: () => void }).togglePause?.(), { color: P.gold, w: 104, h: 32, size: 14 }).setDepth(102))
    this.dyn = add(s.add.graphics().setDepth(100))
  }

  update(v: GolfSnapshot, st: HudState, dt: number): void {
    void dt
    const hole = v.holeData, cup = hole.cup
    const who = st.myTurn ? 'a' : v.current
    const bp = v.balls[who].pos
    const dist = Math.hypot(bp.x - cup.x, bp.z - cup.z)
    this.holeTxt.setText(`HOLE ${v.hole + 1} · PAR ${hole.par}${this.courseName ? ` · ${this.courseName.toUpperCase()}` : ''}`)
    this.distTxt.setText(`${dist < 10 ? dist.toFixed(1) : Math.round(dist)} m to the cup · ${v.balls[who].surface}`)
    this.strokesA.setText(`STROKES ${v.balls.a.strokes}${v.balls.a.holed ? ' · IN' : ''}`)
    this.strokesB.setText(`STROKES ${v.balls.b.strokes}${v.balls.b.holed ? ' · IN' : ''}`)
    this.turnTxt.setText(v.phase === 'aim' ? (st.myTurn ? 'YOUR SHOT' : `${this.names[1]} is lining up…`) : v.phase === 'flying' ? 'in the air' : v.phase === 'rolling' ? 'rolling…' : '')
    this.clubTxt.setText(CLUB_NAMES[st.club])
    this.carryTxt.setText(st.club === 'putter' ? 'rolls on the green · W/S to change' : `carries ${carryTable[st.club]} m · W/S to change`)
    const ws = Math.hypot(v.wind.x, v.wind.z)
    this.windTxt.setText(`WIND\n${ws.toFixed(1)} m/s`)
    this.scorecard(v, st.nHoles)
    const g = this.dyn
    g.clear()
    this.windArrow(g, v.wind, st.heading)
    this.meter(g, st)
    this.minimap(g, hole, v, st)
  }

  private scorecard(v: GolfSnapshot, nHoles: number): void {
    const sc = v.scorecard
    const done = v.phase === 'round_end' ? sc.holes.length : v.hole // the sim's to-par counts the live hole; only finished holes count here
    const cols = [['HOLE'], ['PAR'], ['YOU'], ['HOUSE']]
    const toPar = { a: 0, b: 0 }
    for (let i = 0; i < nHoles; i++) {
      const row = sc.holes[i]
      cols[0].push(String(i + 1)); cols[1].push(row ? String(row.par) : '-')
      cols[2].push(row ? String(row.strokes.a) : '-'); cols[3].push(row ? String(row.strokes.b) : '-')
      if (row && i < done) { toPar.a += row.toPar.a; toPar.b += row.toPar.b }
    }
    cols[0].push('TOTAL'); cols[1].push('')
    cols[2].push(`${sc.totals.a} (${toParText(toPar.a)})`); cols[3].push(`${sc.totals.b} (${toParText(toPar.b)})`)
    cols.forEach((c, i) => this.cardCols[i].setText(c.join('\n')))
  }

  /** Arrow relative to the aim heading: up = tailwind, down = headwind. */
  private windArrow(g: Phaser.GameObjects.Graphics, wind: V2, heading: number): void {
    const ws = Math.hypot(wind.x, wind.z)
    const cx = this.windBox.x + 118, cy = this.windBox.y + 24
    g.fillStyle(P.paper).fillCircle(cx, cy, 20); g.lineStyle(3, P.ink).strokeCircle(cx, cy, 20)
    if (ws < 0.05) return
    const rel = Math.atan2(wind.x, wind.z) - heading * RAD
    const dx = Math.sin(rel), dy = -Math.cos(rel), len = 8 + Math.min(1, ws / 6) * 8
    const tx = cx + dx * len, ty = cy + dy * len
    g.lineStyle(4, P.ink).lineBetween(cx - dx * len, cy - dy * len, tx, ty)
    const hx = -dy, hy = dx
    g.fillStyle(ws > 4 ? P.red : P.ink).fillTriangle(tx + dx * 6, ty + dy * 6, tx - dx * 4 + hx * 5, ty - dy * 4 + hy * 5, tx - dx * 4 - hx * 5, ty - dy * 4 - hy * 5)
  }

  private meter(g: Phaser.GameObjects.Graphics, st: HudState): void {
    const m = st.meter, b = this.meterBox
    if (!st.myTurn) { this.meterTxt.setText(''); return }
    g.fillStyle(P.ink, 0.9).fillRoundedRect(b.x + 4, b.y + 5, b.w, b.h, 8)
    g.fillStyle(P.paper).fillRoundedRect(b.x, b.y, b.w, b.h, 8)
    if (m.state === 'idle') this.meterTxt.setText('SPACE to start the swing  ·  or A on the phone')
    else if (m.state === 'armed') {
      g.fillStyle(P.green, 0.35).fillRoundedRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8, 5)
      this.meterTxt.setText('ARMED  ·  swing the phone, any direction')
    } else if (m.state === 'power') {
      const fw = Math.max(0, Math.min(1, m.value)) * (b.w - 8)
      g.fillStyle(m.value > 0.85 ? P.red : m.value > 0.5 ? P.gold : P.green).fillRoundedRect(b.x + 4, b.y + 4, fw, b.h - 8, 5)
      this.meterTxt.setText(`POWER ${Math.round(m.value * 100)}%  ·  SPACE`)
    } else {
      const pw = Math.max(0, Math.min(1, m.power)) * (b.w - 8)
      g.fillStyle(P.gold, 0.35).fillRoundedRect(b.x + 4, b.y + 4, pw, b.h - 8, 5)
      const cx = b.x + b.w / 2, travel = b.w / 2 - 10
      const half = ACC_SWEET * travel // the green window: stops inside it count as a perfect shot
      g.fillStyle(P.green).fillRect(cx - half, b.y + 2, half * 2, b.h - 4)
      g.lineStyle(2, P.ink).strokeRect(cx - half, b.y + 2, half * 2, b.h - 4)
      const stop = m.state === 'accuracy' ? m.value : m.accuracy
      const perfect = m.state === 'done' && Math.abs(stop) <= ACC_SWEET
      const x = cx + stop * travel
      g.fillStyle(m.state === 'done' ? (perfect ? P.green : P.blue) : P.red).fillRect(x - 3, b.y - 4, 6, b.h + 8)
      g.lineStyle(2, P.ink).strokeRect(x - 3, b.y - 4, 6, b.h + 8)
      this.meterTxt.setText(m.state === 'accuracy' ? `ACCURACY  ·  SPACE inside the green window` : perfect ? 'PERFECT' : `POWER ${Math.round(m.power * 100)}%`)
    }
    g.lineStyle(4, P.ink).strokeRoundedRect(b.x, b.y, b.w, b.h, 8)
  }

  /** Top-down hole map from the hole data, fitted into a MAP-sized box, north up. */
  private minimap(g: Phaser.GameObjects.Graphics, hole: Hole, v: GolfSnapshot, st: HudState): void {
    const bx = this.mapBox.x, by = this.mapBox.y
    const xs = hole.course.map((p) => p.x), zs = hole.course.map((p) => p.z)
    const minX = Math.min(...xs) - 6, maxX = Math.max(...xs) + 6, minZ = Math.min(...zs) - 6, maxZ = Math.max(...zs) + 6
    const k = Math.min((MAP - 12) / (maxX - minX), (MAP - 12) / (maxZ - minZ))
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
    const px = (x: number) => bx + MAP / 2 + (x - cx) * k, pz = (z: number) => by + MAP / 2 - (z - cz) * k
    const poly = (pts: V2[]) => pts.map((p) => ({ x: px(p.x), y: pz(p.z) }))
    g.fillStyle(P.ink, 0.75).fillRoundedRect(bx + 5, by + 6, MAP, MAP, 12)
    g.fillStyle(0x2f7d3a, 0.85).fillRoundedRect(bx, by, MAP, MAP, 12)
    g.fillStyle(0x45a04f).fillPoints(poly(hole.course), true)
    g.fillStyle(0x7ed957).fillPoints(poly(hole.fairway), true)
    g.lineStyle(1.5, P.ink, 0.5).strokePoints(poly(hole.fairway), true)
    for (const w of hole.water) g.fillStyle(0x2ad4ff).fillPoints(poly(w), true)
    for (const b of hole.bunkers) g.fillStyle(0xf1dfb8).fillCircle(px(b.c.x), pz(b.c.z), Math.max(2, b.r * k))
    g.fillStyle(0xa8f06a).fillCircle(px(hole.cup.x), pz(hole.cup.z), Math.max(3, hole.greenR * k))
    g.fillStyle(P.blue).fillRect(px(hole.tee.x) - 3, pz(hole.tee.z) - 1.5, 6, 3)
    g.fillStyle(P.red).fillCircle(px(hole.cup.x), pz(hole.cup.z), 2.5)
    if (st.myTurn && v.phase === 'aim') {
      const a = v.balls.a.pos, dx = Math.sin(st.heading * RAD), dz = Math.cos(st.heading * RAD)
      g.lineStyle(2, P.gold, 0.9).lineBetween(px(a.x), pz(a.z), px(a.x) + dx * 40, pz(a.z) - dz * 40)
    }
    for (const p of ['b', 'a'] as const) {
      const b = v.balls[p]
      if (b.holed) continue
      g.fillStyle(p === 'a' ? 0xffffff : 0xfff1a0).fillCircle(px(b.pos.x), pz(b.pos.z), 4); g.lineStyle(2, P.ink).strokeCircle(px(b.pos.x), pz(b.pos.z), 4)
    }
    g.lineStyle(5, P.ink).strokeRoundedRect(bx, by, MAP, MAP, 12)
  }

  burst(word: string, color = P.gold, size = 70): void {
    const W = this.W, H = this.H
    const b = actionBurst(this.scene, W / 2 + Phaser.Math.Between(-W * 0.08, W * 0.08), H * 0.38 + Phaser.Math.Between(-H * 0.05, H * 0.05), word, color, size).setDepth(110).setScale(0)
    this.scene.tweens.add({ targets: b, scale: 1.1, duration: 140, ease: 'Back.Out', onComplete: () => this.scene.tweens.add({ targets: b, scale: 1, y: b.y - 40, alpha: 0, duration: 450, delay: 260, onComplete: () => b.destroy() }) })
  }

  /** Big centre card (new hole, hole result). Replaces any current card. */
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

  /** End-of-round panel with replay and menu buttons. */
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
  /** Course name shown after the par in the hole banner (`HOLE 1 · PAR 3 · DESERT CANYON`). */
  setCourseName(name: string): void { this.courseName = name }
  setNames(a: string, b: string): void { this.names = [a, b]; this.nameA.setText(a); this.nameB.setText(b) }
  destroy(): void { this.clearCard(); this.clearOverlay(); for (const o of this.static) o.destroy() }
}
