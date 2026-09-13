import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, MenuNav, comicPanel, doodles, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { openControllerConnect } from './ControllerScene'
import { loadSettings } from '../agent/sliders'
import { formatActive } from '../health/energy'

/** Home menu: big playful logo on a tilted comic panel, a mascot chip bouncing, stacked comic buttons that slide in. */
export class MainMenuScene extends Phaser.Scene {
  private city!: ComicBackdrop
  constructor() { super('menu') }
  create(): void {
    ensureTextures(this)
    const { width: W, height: H } = this.scale
    this.city = new ComicBackdrop(this, 5)
    doodles(this, 12)
    const panel = comicPanel(this, W * 0.08, H * 0.12, W * 0.42, H * 0.3, P.paper, -2)
    const logo = this.add.text(W * 0.29, H * 0.27, 'TEMPO', { fontFamily: DISPLAY, fontSize: '104px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 12, align: 'center' }).setOrigin(0.5).setAngle(-2).setScale(0)
    this.tweens.add({ targets: logo, scale: 1, duration: 500, ease: 'Back.Out' })
    this.tweens.add({ targets: [logo, panel], y: '-=6', duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    // bouncing chip mascot
    const chip = this.add.container(W * 0.2, H * 0.62)
    const cg = this.add.graphics()
    cg.fillStyle(P.ink).fillCircle(6, 8, 62); cg.fillStyle(P.gold).fillCircle(0, 0, 60); cg.lineStyle(6, P.ink).strokeCircle(0, 0, 60)
    cg.lineStyle(6, P.red); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; cg.lineBetween(Math.cos(a) * 44, Math.sin(a) * 44, Math.cos(a) * 58, Math.sin(a) * 58) }
    cg.fillStyle(P.ink).fillCircle(-16, -8, 6).fillCircle(16, -8, 6); cg.lineStyle(5, P.ink).beginPath(); cg.arc(0, 8, 22, 0.2, Math.PI - 0.2); cg.strokePath()
    chip.add(cg)
    this.tweens.add({ targets: chip, y: chip.y - 40, duration: 700, yoyo: true, repeat: -1, ease: 'Quad.Out' })
    this.tweens.add({ targets: chip, angle: 10, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    const shadow = this.add.ellipse(W * 0.2, H * 0.62 + 74, 120, 26, P.ink, 0.5)
    this.tweens.add({ targets: shadow, scaleX: 0.7, alpha: 0.25, duration: 700, yoyo: true, repeat: -1, ease: 'Quad.Out' })
    const items: [string, number, string, () => void][] = [
      ['PLAY', P.red, 'pick a mode and a game', () => wipeTo(this, 'mode')],
      ['FIGHT NIGHT', P.orange, 'two AI fighters, bet your chips', () => wipeTo(this, 'fightnight')],
      ['HOST A GAME', P.blue, 'projector, host and rail links', () => wipeTo(this, 'placeholder', { title: 'HOST A GAME', sub: 'projector · host · rail · coming in the full build' })],
      ['CONNECT A PHONE', P.magenta, 'scan a QR to use a phone as a controller', () => openControllerConnect(this)],
      ['HEALTH', P.teal, 'active minutes, calories and range of motion', () => wipeTo(this, 'health')],
      ['HOW TO PLAY', P.green, 'controls and a guided practice', () => wipeTo(this, 'tutorial', { game: 'boxing', from: 'menu' })],
      ['SETTINGS', P.cyan, 'sound, announcer and key bindings', () => wipeTo(this, 'settings')],
      ['CREDITS', P.purple, 'HackRice 16', () => wipeTo(this, 'credits')],
    ]
    const buttons = items.map(([t, c, sub, cb], i) => {
      const b = new ComicButton(this, W * 0.72 + W, H * 0.13 + i * 76, t, cb, { color: c, sub, w: 440, h: 70 })
      this.tweens.add({ targets: b, x: W * 0.72, duration: 500, delay: 120 + i * 80, ease: 'Back.Out' })
      return b
    })
    new MenuNav(this, buttons, (i) => items[i][3]())
    void this.goalCard(W, H)
  }
  /** Today's activity goal, read from the local health service. Silent when that service is off. */
  private async goalCard(W: number, H: number): Promise<void> {
    let today: { kcal: number; swings: number; activeSeconds: number } | null = null
    try { const r = await fetch('/health/summary?days=1', { cache: 'no-store' }); if (r.ok) today = (await r.json() as { today: { kcal: number; swings: number; activeSeconds: number } }).today } catch { /* service off */ }
    if (!today || !this.scene.isActive()) return
    const goal = loadSettings().dailyGoalKcal, done = Math.min(1, today.kcal / goal)
    const x = W * 0.08, y = H * 0.47, w = W * 0.42, h = 92
    comicPanel(this, x, y, w, h, P.paper, 1).setDepth(5)
    this.add.text(x + 22, y + 22, done >= 1 ? 'GOAL HIT TODAY' : "TODAY'S GOAL", { fontFamily: DISPLAY, fontSize: '22px', color: HEX(done >= 1 ? P.green : P.teal), stroke: HEX(P.ink), strokeThickness: 5 }).setDepth(6)
    this.add.text(x + w - 22, y + 24, `${Math.round(today.kcal)} / ${goal} kcal`, { fontFamily: DISPLAY, fontSize: '20px', color: HEX(P.ink) }).setOrigin(1, 0).setDepth(6)
    const g = this.add.graphics().setDepth(6)
    g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 26, y + 58, w - 44, 16, 8).fillStyle(P.paper).fillRoundedRect(x + 22, y + 54, w - 44, 16, 8)
    if (done > 0) g.fillStyle(done >= 1 ? P.green : P.teal).fillRoundedRect(x + 22, y + 54, Math.max(16, (w - 44) * done), 16, 8)
    g.lineStyle(3, P.ink).strokeRoundedRect(x + 22, y + 54, w - 44, 16, 8)
    const hint = done >= 1 ? `${today.swings} swings and ${formatActive(today.activeSeconds)} active. Great work.` : `${Math.ceil(goal - today.kcal)} kcal to go · every swing counts one`
    this.add.text(x + 22, y + 76, hint, { fontFamily: FONT, fontSize: '12px', color: HEX(0x5a4632), fontStyle: '900' }).setOrigin(0, 0.5).setDepth(6)
  }

  update(_t: number, dt: number): void { this.city.update(dt) }
}
