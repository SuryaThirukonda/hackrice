import Phaser from 'phaser'
import { ComicBackdrop, doodles, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'

/** Attract screen: the logo drops in with squash and stretch, letters bob, "press any key" pulses. */
export class TitleScene extends Phaser.Scene {
  private city!: ComicBackdrop
  constructor() { super('title') }
  create(): void {
    ensureTextures(this)
    const { width: W, height: H } = this.scale
    this.city = new ComicBackdrop(this, 3)
    doodles(this, 16)
    // One word, so each letter gets the bounce the old four words shared: they land left to right.
    const letters = [...'TEMPO']
    const colors = [P.blue, P.red, P.gold, P.green, P.magenta]
    const size = Math.min(190, W * 0.17), gap = size * 0.78
    const x0 = W / 2 - gap * (letters.length - 1) / 2
    letters.forEach((ch, i) => {
      const t = this.add.text(x0 + i * gap, -160, ch, { fontFamily: DISPLAY, fontSize: `${size}px`, color: HEX(colors[i]), stroke: HEX(P.ink), strokeThickness: 16, shadow: { offsetX: 8, offsetY: 10, color: HEX(P.ink), fill: true } }).setOrigin(0.5).setAngle(i % 2 ? 3 : -3)
      const target = H * 0.34
      this.tweens.add({ targets: t, y: target, duration: 650, delay: i * 110, ease: 'Bounce.Out', onComplete: () => { sfx.stamp(); this.tweens.add({ targets: t, scaleY: 0.86, scaleX: 1.12, duration: 90, yoyo: true }); this.tweens.add({ targets: t, y: target - 8, duration: 1300 + i * 160, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: 300 }) } })
    })
    const sub = this.add.text(W / 2, H * 0.72, 'a casino sports arcade  ·  the room bets on you', { fontFamily: FONT, fontSize: '22px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 18, y: 8 } }).setOrigin(0.5).setAlpha(0)
    this.tweens.add({ targets: sub, alpha: 1, duration: 500, delay: 900 })
    const press = this.add.text(W / 2, H * 0.84, 'PRESS ANY KEY', { fontFamily: DISPLAY, fontSize: '36px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 8 }).setOrigin(0.5).setAlpha(0)
    this.tweens.add({ targets: press, alpha: 1, duration: 600, delay: 1200, onComplete: () => this.tweens.add({ targets: press, scale: 1.08, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' }) })
    const go = () => { sfx.unlock(); sfx.sparkle(); wipeTo(this, 'menu') }
    this.time.delayedCall(900, () => { this.input.keyboard!.once('keydown', go); this.input.once('pointerdown', go) })
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}
