import Phaser from 'phaser'
import { ComicBackdrop, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { tempoFlow } from '../wellness/tempoFlow'
import type { HealthSport } from '../health/energy'

const SPORTS: { id: HealthSport | 'mix'; title: string; sub: string; color: number }[] = [
  { id: 'boxing', title: 'BOXING', sub: 'high movement · punches', color: P.red },
  { id: 'bowling', title: 'BOWLING', sub: 'timing · swings', color: P.blue },
  { id: 'golf', title: 'GOLF', sub: 'precision · control', color: P.green },
  { id: 'mix', title: 'ADAPTIVE MIX', sub: 'Tempo picks the sequence', color: P.orange },
]

/** Pick what to play, then Ready-Up. No intent/duration maze. */
export class TempoSessionScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private index = 0
  private items: Phaser.GameObjects.GameObject[] = []
  constructor() { super('tempo-session') }

  create(): void {
    ensureTextures(this)
    this.city = new ComicBackdrop(this, 81)
    const kb = this.input.keyboard!
    kb.on('keydown-UP', () => { this.index = (this.index + SPORTS.length - 1) % SPORTS.length; this.draw() })
    kb.on('keydown-DOWN', () => { this.index = (this.index + 1) % SPORTS.length; this.draw() })
    kb.on('keydown-ENTER', () => this.begin())
    kb.on('keydown-SPACE', () => this.begin())
    kb.on('keydown-ESC', () => wipeTo(this, 'menu'))
    this.draw()
  }

  private begin(): void {
    const pick = SPORTS[this.index]
    if (pick.id === 'mix') tempoFlow.start('just-play', 10)
    else tempoFlow.startSport(pick.id)
    wipeTo(this, 'ready-up')
  }

  private draw(): void {
    this.items.forEach((o) => o.destroy())
    this.items = []
    const { width: W, height: H } = this.scale
    const k = Math.min(W / 1280, H / 720)
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.items.push(o); return o }

    add(comicPanel(this, W * .14, 36 * k, W * .72, 100 * k, P.paper, -1, 1))
    add(this.add.text(W / 2, 52 * k, 'TEMPO SESSION', { fontFamily: DISPLAY, fontSize: `${Math.round(42 * k)}px`, color: HEX(P.ink) }).setOrigin(.5, 0))
    add(this.add.text(W / 2, 104 * k, 'Choose what to play. Ready-Up is next.', { fontFamily: FONT, fontSize: `${Math.round(15 * k)}px`, color: HEX(0x5a4632), fontStyle: '900' }).setOrigin(.5))

    const cardW = Math.min(720 * k, W * .7)
    SPORTS.forEach((g, i) => {
      const y = 170 * k + i * 88 * k
      const active = i === this.index
      add(comicPanel(this, W / 2 - cardW / 2, y, cardW, 72 * k, active ? g.color : P.paper, active ? -1 : 0, 1))
      add(this.add.text(W / 2 - cardW / 2 + 28 * k, y + 16 * k, g.title, {
        fontFamily: DISPLAY, fontSize: `${Math.round(28 * k)}px`, color: HEX(active ? 0xffffff : g.color),
        stroke: active ? HEX(P.ink) : undefined, strokeThickness: active ? 5 * k : 0,
      }).setDepth(12))
      add(this.add.text(W / 2 - cardW / 2 + 28 * k, y + 46 * k, g.sub, {
        fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, color: HEX(active ? 0xffffff : P.ink), fontStyle: '900',
      }).setDepth(12))
    })

    add(this.add.text(W / 2, H - 28 * k, '↑↓ choose  ·  Enter continue  ·  Esc back', {
      fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, color: HEX(P.ink), fontStyle: '900',
      backgroundColor: HEX(P.paper), padding: { x: 12, y: 5 },
    }).setOrigin(.5))
  }

  update(_t: number, dt: number): void { this.city.update(dt) }
}
