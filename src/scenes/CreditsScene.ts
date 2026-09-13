import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, MenuNav, comicPanel, doodles, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'

export class CreditsScene extends Phaser.Scene {
  private city!: ComicBackdrop

  constructor() {
    super('credits')
  }

  create(): void {
    ensureTextures(this)
    const { width: W, height: H } = this.scale

    this.city = new ComicBackdrop(this, 13)
    doodles(this, 12)

    const panelW = Math.min(680, W * 0.88)
    const panelH = 430
    const panelX = W / 2 - panelW / 2
    const panelY = H * 0.14

    // Main credits comic card
    const p = comicPanel(this, panelX, panelY, panelW, panelH, P.paper, 1.5)
    p.setAlpha(0)
    this.tweens.add({ targets: p, alpha: 1, duration: 280 })
    new ComicButton(this, 90, 48, '◀ BACK', () => { sfx.back(); wipeTo(this, 'menu') }, { color: P.blue, w: 110, h: 42, size: 16 })

    // Title
    const title = this.add.text(W / 2, panelY + 54, 'CREDITS', {
      fontFamily: DISPLAY,
      fontSize: '56px',
      color: HEX(P.purple),
      stroke: HEX(P.ink),
      strokeThickness: 10,
    }).setOrigin(0.5).setAngle(1.5).setScale(0)
    this.tweens.add({ targets: title, scale: 1, duration: 400, ease: 'Back.Out' })

    // "MADE BY"
    this.add.text(W / 2, panelY + 106, 'MADE BY', {
      fontFamily: DISPLAY,
      fontSize: '26px',
      color: HEX(P.red),
      stroke: HEX(P.ink),
      strokeThickness: 6,
    }).setOrigin(0.5).setAngle(1.5)

    // The creators
    const creators = [
      { name: 'Atreya Jariwala', color: P.blue },
      { name: 'Surya Thirukonda', color: P.gold },
      { name: 'Gaurav Yadav', color: P.green },
    ]

    const cardStartX = W / 2
    const cardStartY = panelY + 162
    const cardGap = 64

    creators.forEach((c, i) => {
      const y = cardStartY + i * cardGap
      const badge = this.add.graphics()
      const bw = panelW * 0.72
      const bh = 50

      // Shadow + pill background
      badge.fillStyle(P.ink, 0.8).fillRoundedRect(cardStartX - bw / 2 + 4, y - bh / 2 + 5, bw, bh, 14)
      badge.fillStyle(c.color, 1).fillRoundedRect(cardStartX - bw / 2, y - bh / 2, bw, bh, 14)
      badge.lineStyle(4, P.ink, 1).strokeRoundedRect(cardStartX - bw / 2, y - bh / 2, bw, bh, 14)
      badge.setAlpha(0).setScale(0.8)

      const nameText = this.add.text(cardStartX, y, c.name, {
        fontFamily: DISPLAY,
        fontSize: '30px',
        color: '#ffffff',
        stroke: HEX(P.ink),
        strokeThickness: 8,
      }).setOrigin(0.5).setAlpha(0)

      this.tweens.add({
        targets: [badge, nameText],
        alpha: 1,
        scale: 1,
        duration: 320,
        delay: 150 + i * 110,
        ease: 'Back.Out',
      })
    })

    // The announcer voice is made with ElevenLabs, whose free plan asks published work to credit it.
    this.add.text(W / 2, panelY + panelH - 66, 'ANNOUNCER VOICE: ELEVENLABS · elevenlabs.io', {
      fontFamily: FONT,
      fontSize: '14px',
      color: HEX(P.ink),
      fontStyle: '900',
    }).setOrigin(0.5).setAngle(1.5)

    // HackRice badge at bottom of panel
    this.add.text(W / 2, panelY + panelH - 34, '★ HACKRICE 16 · RICE UNIVERSITY ★', {
      fontFamily: FONT,
      fontSize: '16px',
      color: HEX(P.ink),
      fontStyle: '900',
    }).setOrigin(0.5).setAngle(1.5)

    // Back button
    const backBtn = new ComicButton(this, W / 2, H * 0.82, 'BACK TO MENU', () => wipeTo(this, 'menu'), {
      color: P.blue,
      w: 360,
      h: 68,
      size: 28,
    })
    new MenuNav(this, [backBtn], () => wipeTo(this, 'menu'), () => wipeTo(this, 'menu'))
  }

  update(_t: number, dt: number): void {
    this.city.update(dt)
  }
}
