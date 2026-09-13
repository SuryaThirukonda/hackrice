import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, MenuNav, comicPanel, doodles, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { openControllerConnect } from './ControllerScene'
import { loadSettings } from '../agent/sliders'
import { activeMinutesFromSeconds, formatActive, formatGoalProgress } from '../health/energy'
import { Announcer, MENU_CAPTIONS } from '../announcer'

/** Home menu: big playful logo on a tilted comic panel, a mascot chip bouncing, stacked comic buttons that slide in. */
export class MainMenuScene extends Phaser.Scene {
  private city!: ComicBackdrop
  constructor() { super('menu') }
  create(): void {
    ensureTextures(this)
    const { width: W, height: H } = this.scale
    this.city = new ComicBackdrop(this, 5)
    doodles(this, 12)
    const compact = H < 700 || W < 1100, leftW = W * (compact ? .38 : .42)
    const panel = comicPanel(this, W * 0.06, H * 0.1, leftW, H * 0.28, P.paper, -2)
    const logo = this.add.text(W * (compact ? .25 : .29), H * 0.24, 'TEMPO', { fontFamily: DISPLAY, fontSize: compact ? '76px' : '104px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: compact ? 9 : 12, align: 'center' }).setOrigin(0.5).setAngle(-2).setScale(0)
    this.tweens.add({ targets: logo, scale: 1, duration: 500, ease: 'Back.Out' })
    this.tweens.add({ targets: [logo, panel], y: '-=6', duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    // bouncing chip mascot
    const chip = this.add.container(W * 0.19, H * (compact ? .72 : .62)).setScale(compact ? .76 : 1)
    const cg = this.add.graphics()
    cg.fillStyle(P.ink).fillCircle(6, 8, 62); cg.fillStyle(P.gold).fillCircle(0, 0, 60); cg.lineStyle(6, P.ink).strokeCircle(0, 0, 60)
    cg.lineStyle(6, P.red); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; cg.lineBetween(Math.cos(a) * 44, Math.sin(a) * 44, Math.cos(a) * 58, Math.sin(a) * 58) }
    cg.fillStyle(P.ink).fillCircle(-16, -8, 6).fillCircle(16, -8, 6); cg.lineStyle(5, P.ink).beginPath(); cg.arc(0, 8, 22, 0.2, Math.PI - 0.2); cg.strokePath()
    chip.add(cg)
    this.tweens.add({ targets: chip, y: chip.y - 40, duration: 700, yoyo: true, repeat: -1, ease: 'Quad.Out' })
    this.tweens.add({ targets: chip, angle: 10, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    const shadow = this.add.ellipse(W * 0.19, H * (compact ? .72 : .62) + (compact ? 56 : 74), compact ? 92 : 120, compact ? 20 : 26, P.ink, 0.5)
    this.tweens.add({ targets: shadow, scaleX: 0.7, alpha: 0.25, duration: 700, yoyo: true, repeat: -1, ease: 'Quad.Out' })
    const items: [string, number, string, () => void][] = [
      ['TEMPO SESSION', P.red, 'pick a sport · ready up · play', () => wipeTo(this, 'tempo-session')],
      ['FREE PLAY', P.teal, 'pick a sport and opponent', () => wipeTo(this, 'mode')],
      ['FIGHT NIGHT', P.orange, 'two AI fighters, bet your chips', () => wipeTo(this, 'fightnight')],
      ['CONNECT A PHONE', P.magenta, 'scan a QR to use a phone as a controller', () => openControllerConnect(this)],
      ['WELLNESS', P.blue, 'activity, body response and adaptation', () => wipeTo(this, 'health')],
      ['HOW TO PLAY', P.green, 'controls and a guided practice', () => wipeTo(this, 'tutorial', { game: 'boxing', from: 'menu' })],
      ['SETTINGS', P.cyan, 'sound, announcer and key bindings', () => wipeTo(this, 'settings')],
      ['CREDITS', P.purple, 'HackRice 16', () => wipeTo(this, 'credits')],
    ]
    const buttonX = W * (compact ? .72 : .73), buttonW = compact ? W * .43 : Math.min(440, W * .46), spacing = compact ? (H - 112) / items.length : 76, buttonH = compact ? spacing - 6 : 70, firstY = compact ? 36 + buttonH / 2 : H < 800 ? 58 : H * .13
    const buttons = items.map(([t, c, sub, cb], i) => {
      const b = new ComicButton(this, buttonX + W, firstY + i * spacing, t, cb, { color: c, sub, w: buttonW, h: buttonH, size: compact ? 22 : 34 })
      this.tweens.add({ targets: b, x: buttonX, duration: 500, delay: 120 + i * 60, ease: 'Back.Out' })
      return b
    })
    new MenuNav(this, buttons, (i) => items[i][3]())
    Announcer.once(this, 'menu.welcome', MENU_CAPTIONS)
    void this.goalCard(W, H)
  }
  /** Today's activity goal, read from the local health service. Silent when that service is off. */
  private async goalCard(W: number, H: number): Promise<void> {
    let todayActiveSeconds: number | null = null, swings = 0
    try {
      const r = await fetch('/health/summary?days=1', { cache: 'no-store' })
      if (r.ok) {
        const s = await r.json() as { todayActiveSeconds?: number; today: { kcal: number; swings: number; activeSeconds: number } }
        todayActiveSeconds = typeof s.todayActiveSeconds === 'number' ? s.todayActiveSeconds : s.today.activeSeconds
        swings = s.today.swings
      }
    } catch { /* service off */ }
    if (todayActiveSeconds === null || !this.scene.isActive()) return
    const goal = loadSettings().dailyGoalMinutes, minutes = activeMinutesFromSeconds(todayActiveSeconds), done = Math.min(1, minutes / goal)
    const compact = H < 700 || W < 1100, x = W * 0.06, y = H * (compact ? .43 : .47), w = W * (compact ? .38 : .42), h = compact ? 86 : 92
    comicPanel(this, x, y, w, h, P.paper, 1).setDepth(5)
    this.add.text(x + 22, y + 18, done >= 1 ? 'GOAL HIT' : 'TODAY', { fontFamily: DISPLAY, fontSize: compact ? '18px' : '22px', color: HEX(done >= 1 ? P.green : P.teal), stroke: HEX(P.ink), strokeThickness: 4 }).setDepth(6)
    this.add.text(x + w - 22, y + 21, `${formatGoalProgress(todayActiveSeconds, goal)} ACTIVE MIN`, { fontFamily: DISPLAY, fontSize: compact ? '14px' : '20px', color: HEX(P.ink) }).setOrigin(1, 0).setDepth(6)
    const g = this.add.graphics().setDepth(6)
    const barY = y + (compact ? 46 : 54)
    g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 26, barY + 4, w - 44, 16, 8).fillStyle(P.paper).fillRoundedRect(x + 22, barY, w - 44, 16, 8)
    if (done > 0) g.fillStyle(done >= 1 ? P.green : P.teal).fillRoundedRect(x + 22, barY, Math.max(16, (w - 44) * done), 16, 8)
    g.lineStyle(3, P.ink).strokeRoundedRect(x + 22, barY, w - 44, 16, 8)
    const hint = done >= 1 ? `${swings} actions and ${formatActive(todayActiveSeconds)} active. Great work.` : `${Math.ceil(goal - minutes)} active minutes to go · energy is secondary and estimated`
    this.add.text(x + 22, y + (compact ? 70 : 76), hint, { fontFamily: FONT, fontSize: compact ? '9px' : '12px', color: HEX(0x5a4632), fontStyle: '900', wordWrap: { width: w - 44 } }).setOrigin(0, 0.5).setDepth(6)
  }

  update(_t: number, dt: number): void { this.city.update(dt) }
}
