import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, MenuNav, comicPanel, doodles, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'

export class ModeSelectScene extends Phaser.Scene {
  private city!: ComicBackdrop
  constructor() { super('mode') }
  create(): void {
    ensureTextures(this)
    const { width: W, height: H } = this.scale
    this.city = new ComicBackdrop(this, 9)
    doodles(this, 10)
    comicPanel(this, W / 2 - 300, H * 0.08, 600, 90, P.paper, 1.5)
    this.add.text(W / 2, H * 0.08 + 45, 'CHOOSE A MODE', { fontFamily: DISPLAY, fontSize: '54px', color: HEX(P.ink) }).setOrigin(0.5).setAngle(1.5)
    const modes: [string, string, string, number, string][] = [
      ['1 PLAYER', 'you vs the House', '🥊', P.red, '1p'],
      ['2 PLAYERS', 'head to head on one keyboard', '👥', P.blue, '2p'],
      ['FIGHT NIGHT', 'House vs House, the room bets', '🎰', P.orange, 'card'],
    ]
    const buttons = modes.map(([t, sub, icon, c, mode], i) => {
      const b = new ComicButton(this, W / 2, H * 0.36 + i * 120, t, () => (mode === 'card' ? wipeTo(this, 'fightnight') : wipeTo(this, 'games', { mode })), { color: c, sub, icon, w: 560, h: 96, size: 40 })
      b.setScale(0); this.tweens.add({ targets: b, scale: 1, duration: 420, delay: 100 + i * 110, ease: 'Back.Out' })
      return b
    })
    new MenuNav(this, buttons, (i) => (modes[i][4] === 'card' ? wipeTo(this, 'fightnight') : wipeTo(this, 'games', { mode: modes[i][4] })), () => wipeTo(this, 'menu'))
    this.add.text(W / 2, H - 28, 'Esc back', { fontFamily: FONT, fontSize: '16px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 12, y: 5 } }).setOrigin(0.5)
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}
