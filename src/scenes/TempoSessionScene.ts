import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { tempoFlow } from '../wellness/tempoFlow'
import type { SessionGoal } from '../wellness/sessionPlanner'

const GOALS: { id: SessionGoal; title: string; sub: string; color: number }[] = [
  { id: 'energize', title: 'ENERGIZE', sub: 'higher-intensity bursts', color: P.red }, { id: 'move', title: 'MOVE', sub: 'balanced activity', color: P.teal },
  { id: 'focus', title: 'FOCUS', sub: 'precision + coordination', color: P.blue }, { id: 'reset', title: 'RESET', sub: 'lower-intensity play', color: P.purple },
  { id: 'just-play', title: 'JUST PLAY', sub: 'adaptive mixed arcade', color: P.orange },
]
export class TempoSessionScene extends Phaser.Scene {
  private city!: ComicBackdrop; private goal = 1; private duration = 1; private items: Phaser.GameObjects.GameObject[] = []
  constructor() { super('tempo-session') }
  create(): void {
    ensureTextures(this); this.city = new ComicBackdrop(this, 81)
    const kb = this.input.keyboard!; kb.on('keydown-UP', () => { this.goal = (this.goal + GOALS.length - 1) % GOALS.length; this.draw() }); kb.on('keydown-DOWN', () => { this.goal = (this.goal + 1) % GOALS.length; this.draw() })
    kb.on('keydown-LEFT', () => { this.duration = (this.duration + 2) % 3; this.draw() }); kb.on('keydown-RIGHT', () => { this.duration = (this.duration + 1) % 3; this.draw() })
    kb.on('keydown-ENTER', () => this.begin()); kb.on('keydown-SPACE', () => this.begin()); kb.on('keydown-ESC', () => wipeTo(this, 'menu')); this.draw()
  }
  private begin(): void { const mins = [5, 10, 15] as const; tempoFlow.start(GOALS[this.goal].id, mins[this.duration]); wipeTo(this, 'baseline') }
  private draw(): void {
    this.items.forEach((x) => x.destroy()); this.items = []
    const { width: W, height: H } = this.scale, k = Math.min(W / 1280, H / 720), add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.items.push(o); return o }
    add(comicPanel(this, W * .12, 28 * k, W * .76, 92 * k, P.paper, -1, 1)); add(this.add.text(W / 2, 46 * k, 'HOW DO YOU WANT TO MOVE?', { fontFamily: DISPLAY, fontSize: `${Math.round(38 * k)}px`, color: HEX(P.ink) }).setOrigin(.5, 0))
    const cardW = Math.min(760 * k, W * .72), y0 = 156 * k
    GOALS.forEach((g, i) => {
      const y = y0 + i * 70 * k, active = i === this.goal
      add(comicPanel(this, W / 2 - cardW / 2, y, cardW, 56 * k, active ? g.color : P.paper, active ? -1 : 0, 1))
      add(this.add.text(W / 2 - cardW / 2 + 24 * k, y + 14 * k, g.title, { fontFamily: DISPLAY, fontSize: `${Math.round(22 * k)}px`, color: HEX(active ? 0xffffff : g.color), stroke: active ? HEX(P.ink) : undefined, strokeThickness: active ? 4 * k : 0 }).setDepth(12))
      add(this.add.text(W / 2 + cardW * .05, y + 20 * k, g.sub, { fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, color: HEX(P.ink), fontStyle: '900' }).setDepth(12))
    })
    const mins = [5, 10, 15]; const by = Math.min(H - 86 * k, y0 + 400 * k)
    add(this.add.text(W / 2, by - 36 * k, 'SESSION LENGTH', { fontFamily: DISPLAY, fontSize: `${Math.round(17 * k)}px`, color: HEX(P.ink) }).setOrigin(.5))
    mins.forEach((m, i) => add(new ComicButton(this, W / 2 + (i - 1) * 180 * k, by, `${m} MIN`, () => { this.duration = i; this.draw() }, { color: i === this.duration ? P.gold : P.paper, w: 150 * k, h: 44 * k, size: Math.round(18 * k) })))
    add(this.add.text(W / 2, H - 28 * k, '↑↓ goal  ·  ←→ duration  ·  Enter check in  ·  Esc back', { fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 12, y: 5 } }).setOrigin(.5))
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}
