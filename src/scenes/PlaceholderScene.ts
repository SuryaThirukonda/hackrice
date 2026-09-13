import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, MenuNav, comicPanel, doodles, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'

/** Stub for screens that come later (a match, host tools, settings). Shows a comic "COMING SOON" panel. */
export class PlaceholderScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private title = ''; private sub = ''; private color = P.gold; private hideStamp = false
  constructor() { super('placeholder') }
  init(d: { title?: string; sub?: string; color?: number; hideStamp?: boolean }): void {
    this.title = d?.title ?? 'SOON'
    this.sub = d?.sub ?? ''
    this.color = d?.color ?? P.gold
    this.hideStamp = d?.hideStamp ?? (this.title === 'CREDITS')
  }
  create(): void {
    ensureTextures(this)
    const { width: W, height: H } = this.scale
    this.city = new ComicBackdrop(this, 13)
    doodles(this, 10)
    const p = comicPanel(this, W / 2 - 340, H * 0.22, 680, 260, P.paper, 2)
    p.setAlpha(0); this.tweens.add({ targets: p, alpha: 1, duration: 300 })
    new ComicButton(this, 90, 48, '◀ BACK', () => { sfx.back(); wipeTo(this, 'menu') }, { color: P.blue, w: 110, h: 42, size: 16 })
    const t = this.add.text(W / 2, H * 0.22 + 90, this.title, { fontFamily: DISPLAY, fontSize: '64px', color: HEX(this.color), stroke: HEX(P.ink), strokeThickness: 10 }).setOrigin(0.5).setAngle(2).setScale(0)
    this.tweens.add({ targets: t, scale: 1, duration: 450, ease: 'Back.Out' })
    this.add.text(W / 2, H * 0.22 + 170, this.sub, { fontFamily: FONT, fontSize: '20px', color: HEX(P.ink), fontStyle: '900', align: 'center', wordWrap: { width: 600 } }).setOrigin(0.5).setAngle(2)
    if (!this.hideStamp) {
      const stamp = this.add.text(W / 2 + 200, H * 0.22 + 40, 'COMING SOON', { fontFamily: DISPLAY, fontSize: '28px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 6 }).setOrigin(0.5).setAngle(-14).setScale(3).setAlpha(0)
      this.tweens.add({ targets: stamp, scale: 1, alpha: 1, duration: 260, delay: 400, ease: 'Cubic.In' })
    }
    const back = new ComicButton(this, W / 2, H * 0.72, 'BACK TO MENU', () => wipeTo(this, 'menu'), { color: P.blue, w: 380, h: 72, size: 30 })
    new MenuNav(this, [back], () => wipeTo(this, 'menu'), () => wipeTo(this, 'menu'))
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}
