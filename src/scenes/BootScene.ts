import Phaser from 'phaser'
import { ensureTextures } from '../ui/widgets'
import { DISPLAY, HEX, P } from '../theme'
import { sfx } from '../fx/sfx'

/** Generates UI textures, shows the loading beat, then starts the title. */
export class BootScene extends Phaser.Scene {
  constructor() { super('boot') }
  create(): void {
    ensureTextures(this)
    const { width: W, height: H } = this.scale
    this.cameras.main.setBackgroundColor(HEX(P.sky2))
    const label = this.add.text(W / 2, H / 2 - 40, 'LOADING THE HOUSE', { fontFamily: DISPLAY, fontSize: '40px', color: HEX(P.gold), stroke: HEX(P.ink), strokeThickness: 8 }).setOrigin(0.5)
    const bar = this.add.graphics()
    const chip = this.add.circle(W / 2 - 190, H / 2 + 20, 16, P.magenta).setStrokeStyle(4, P.ink)
    const prog = { v: 0 }
    const draw = () => { bar.clear(); bar.fillStyle(P.ink).fillRoundedRect(W / 2 - 200, H / 2 + 6, 400, 28, 14); bar.fillStyle(P.cyan).fillRoundedRect(W / 2 - 194, H / 2 + 12, 388 * prog.v, 16, 8); chip.x = W / 2 - 190 + 380 * prog.v; chip.rotation += 0.2 + prog.v }
    this.input.once('pointerdown', () => sfx.unlock()); this.input.keyboard?.once('keydown', () => sfx.unlock())
    this.tweens.add({ targets: prog, v: 1, duration: 700, ease: 'Sine.InOut', onUpdate: draw, onComplete: () => { label.setText('READY'); this.time.delayedCall(150, () => this.scene.start('title')) } })
  }
}
