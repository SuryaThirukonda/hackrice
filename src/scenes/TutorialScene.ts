import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, MenuNav, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'
import { boxingPages, type TutorialPage } from '../games/boxing/tutorial'
import { loadSettings } from '../agent/sliders'
import { BOXING_KEYS } from '../games/boxing/keymap'
import { BOWLING_KEYS } from '../games/bowling/keymap'
import { bowlingPages } from '../games/bowling/tutorial'
import { GOLF_KEYS } from '../games/golf/keymap'
import { golfPages } from '../games/golf/tutorial'

export type TutorialGame = 'boxing' | 'bowling' | 'golf'
export interface TutorialData { game?: TutorialGame; from?: string }

const TABS: TutorialGame[] = ['boxing', 'bowling', 'golf']

/** "How to play" pages per game with key caps, plus a guided practice mode. Tabs switch games, arrows page, Enter tries it. */
export class TutorialScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private game3: TutorialGame = 'boxing'
  private page = 0
  private from = 'menu'
  private content: Phaser.GameObjects.GameObject[] = []
  constructor() { super('tutorial') }
  init(d: TutorialData): void { this.game3 = d?.game ?? 'boxing'; this.page = 0; this.from = d?.from ?? 'menu' }

  pages(): TutorialPage[] {
    const s = loadSettings()
    if (this.game3 === 'boxing') return boxingPages({ ...BOXING_KEYS, ...(s.bindings.boxing as Partial<typeof BOXING_KEYS> | undefined) })
    if (this.game3 === 'bowling') return bowlingPages({ ...BOWLING_KEYS, ...(s.bindings.bowling as Partial<typeof BOWLING_KEYS> | undefined) })
    if (this.game3 === 'golf') return golfPages({ ...GOLF_KEYS, ...(s.bindings.golf as Partial<typeof GOLF_KEYS> | undefined) })
    return []
  }

  create(): void {
    ensureTextures(this)
    this.city = new ComicBackdrop(this, 21)
    const kb = this.input.keyboard!
    kb.on('keydown-RIGHT', () => this.turn(1)); kb.on('keydown-LEFT', () => this.turn(-1))
    kb.on('keydown-TAB', (e: KeyboardEvent) => { e.preventDefault(); this.game3 = TABS[(TABS.indexOf(this.game3) + 1) % TABS.length]; this.page = 0; sfx.hover(); this.draw() })
    kb.on('keydown-ESC', () => wipeTo(this, this.from))
    kb.on('keydown-ENTER', () => this.tryIt())
    this.draw()
  }
  private turn(d: number): void { const n = this.pages().length; this.page = (this.page + d + n) % n; sfx.hover(); this.draw() }
  private canTry(): boolean { return this.game3 === 'boxing' || this.game3 === 'bowling' || this.game3 === 'golf' }
  private tryIt(): void { if (this.canTry()) wipeTo(this, this.game3, { mode: '1p', practice: true, seed: 7 }) }

  private draw(): void {
    for (const o of this.content) o.destroy()
    this.content = []
    const { width: W, height: H } = this.scale
    const pages = this.pages(), pg = pages[this.page]
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.content.push(o); return o }
    // tabs
    add(new ComicButton(this, 90, 56, '◀ BACK', () => { sfx.back(); wipeTo(this, this.from) }, { color: P.blue, w: 110, h: 46, size: 16 }))
    TABS.forEach((g, i) => {
      const x = W / 2 + (i - 1) * 220
      const b = add(new ComicButton(this, x, 56, g.toUpperCase(), () => { this.game3 = g; this.page = 0; this.draw() }, { color: g === this.game3 ? P.red : P.paper, w: 200, h: 54, size: 24 }))
      if (g === this.game3) b.setScale(1.06)
    })
    add(comicPanel(this, W / 2 - 440, 110, 880, H - 250, P.paper, -1))
    add(this.add.text(W / 2, 150, `HOW TO PLAY · ${pg.heading}`, { fontFamily: DISPLAY, fontSize: '44px', color: HEX(P.ink) }).setOrigin(0.5).setAngle(-1))
    pg.rows.forEach((r, i) => {
      const y = 215 + i * 74
      const cap = add(new ComicButton(this, W / 2 - 300, y, r.keys, () => undefined, { color: P.gold, w: 200, h: 54, size: 22 }))
      cap.disableInteractive()
      add(this.add.text(W / 2 - 180, y - 14, r.label, { fontFamily: DISPLAY, fontSize: '26px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 5 }).setOrigin(0, 0.5))
      add(this.add.text(W / 2 - 180, y + 16, r.hint, { fontFamily: FONT, fontSize: '16px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0, 0.5))
    })
    if (pg.note) add(this.add.text(W / 2, H - 200, pg.note, { fontFamily: FONT, fontSize: '17px', color: HEX(P.ink), fontStyle: '900', wordWrap: { width: 780 }, align: 'center' }).setOrigin(0.5, 0))
    const dots = pages.map((_, i) => (i === this.page ? '●' : '○')).join(' ')
    add(this.add.text(W / 2, H - 118, `${dots}   ← → pages · Tab switch game`, { fontFamily: FONT, fontSize: '15px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 10, y: 4 } }).setOrigin(0.5))
    const buttons: ComicButton[] = []
    const tryable = this.canTry()
    if (tryable) buttons.push(add(new ComicButton(this, W / 2 - 170, H - 62, 'TRY IT', () => this.tryIt(), { color: P.green, w: 300, h: 60, size: 26 })))
    buttons.push(add(new ComicButton(this, W / 2 + (tryable ? 170 : 0), H - 62, 'BACK', () => wipeTo(this, this.from), { color: P.blue, w: 300, h: 60, size: 26 })))
    new MenuNav(this, buttons, (i) => (tryable && i === 0 ? this.tryIt() : wipeTo(this, this.from)), () => wipeTo(this, this.from))
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}
