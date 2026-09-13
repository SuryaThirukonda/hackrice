import Phaser from 'phaser'
import { FONT, HEX, P } from '../theme'

/** Where a caption strip sits for a screen size: centre x, centre y, and the wrap width. */
export interface CaptionPlace {
  x(W: number, H: number): number
  y(W: number, H: number): number
  wrap(W: number, H: number): number
}

/** Sports: the band just above golf's club panel, swing meter and minimap, clear of every HUD at 1280×720 and up. */
export const SPORT_CAPTIONS: CaptionPlace = { x: (W) => W / 2, y: (_W, H) => H - 168, wrap: (W) => Math.max(320, Math.min(W - 600, 760)) }
/** Main menu: under the mascot, left of the button column. */
export const MENU_CAPTIONS: CaptionPlace = { x: (W) => W * 0.29, y: (_W, H) => H - 64, wrap: (W) => Math.max(260, W * 0.4) }
/** Fight Night lobby: above RING THE BELL. */
export const LOBBY_CAPTIONS: CaptionPlace = { x: (W) => W / 2, y: (_W, H) => H - 160, wrap: (W) => Math.max(320, Math.min(W - 200, 700)) }

/** Above the HUD, bursts and taunts (100 to 113); below cards, the bet panel, overlays and the victory animation (120 and up). */
export const CAPTION_DEPTH = 116

/** One line of announcer text in the hint-bar style, faded in when a line starts and out after it ends. */
export class Captions {
  private readonly scene: Phaser.Scene
  private readonly place: CaptionPlace
  private readonly text: Phaser.GameObjects.Text
  private fade: Phaser.Tweens.Tween | null = null
  private timer: Phaser.Time.TimerEvent | null = null

  constructor(scene: Phaser.Scene, place: CaptionPlace = SPORT_CAPTIONS) {
    this.scene = scene
    this.place = place
    const { width: W, height: H } = scene.scale
    this.text = scene.add.text(place.x(W, H), place.y(W, H), '', {
      fontFamily: FONT, fontSize: '20px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper),
      padding: { x: 14, y: 6 }, align: 'center', wordWrap: { width: place.wrap(W, H), useAdvancedWrap: true },
    }).setOrigin(0.5).setDepth(CAPTION_DEPTH).setScrollFactor(0).setAlpha(0).setVisible(false)
  }

  show(line: string): void {
    if (!this.text.active) return
    this.timer?.remove(); this.timer = null
    this.text.setText(line).setVisible(true)
    this.fadeTo(1, 120)
  }

  /** Fade out `afterMs` after the line ends. */
  hide(afterMs = 400): void {
    if (!this.text.active) return
    this.timer?.remove()
    this.timer = this.scene.time.delayedCall(afterMs, () => { this.timer = null; this.fadeTo(0, 200, () => this.text.setVisible(false)) })
  }

  /** Remove the caption at once (pause, a cut line, shutdown). */
  clear(): void {
    this.timer?.remove(); this.timer = null
    this.fade?.stop(); this.fade = null
    if (this.text.active) this.text.setAlpha(0).setVisible(false)
  }

  layout(W: number, H: number): void {
    if (!this.text.active) return
    this.text.setPosition(this.place.x(W, H), this.place.y(W, H)).setWordWrapWidth(this.place.wrap(W, H), true)
  }

  destroy(): void {
    this.clear()
    if (this.text.active) this.text.destroy()
  }

  private fadeTo(alpha: number, ms: number, done?: () => void): void {
    this.fade?.stop()
    this.fade = this.scene.tweens.add({ targets: this.text, alpha, duration: ms, onComplete: () => { this.fade = null; done?.() } })
  }
}
