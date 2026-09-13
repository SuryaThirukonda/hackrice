import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { tempoFlow } from '../wellness/tempoFlow'
import { formatActive } from '../health/energy'

export class SessionSummaryScene extends Phaser.Scene {
  private city!: ComicBackdrop
  constructor() { super('session-summary') }
  create(): void {
    ensureTextures(this); this.city = new ComicBackdrop(this, 84)
    const { width: W, height: H } = this.scale, k = Math.min(W / 1280, H / 720), seg = tempoFlow.segments
    const active = seg.reduce((n, s) => n + (s.summary?.activeSeconds ?? 0), 0), actions = seg.reduce((n, s) => n + (s.summary?.swings ?? 0), 0)
    const energyRows = seg.filter((s) => s.summary?.kcal !== null), kcal = energyRows.reduce((n, s) => n + (s.summary?.kcal ?? 0), 0)
    comicPanel(this, W * .08, 25 * k, W * .84, H - 50 * k, P.paper, -.5, 1)
    const text = (x: number, y: number, t: string, n: number, c = P.ink, origin = 0) => this.add.text(x, y, t, { fontFamily: DISPLAY, fontSize: `${Math.round(n * k)}px`, color: HEX(c), fontStyle: '900', wordWrap: { width: W * .35 }, align: origin ? 'center' : 'left' }).setOrigin(origin, 0).setDepth(12)
    text(W / 2, 50 * k, 'TEMPO SUMMARY', 42, P.ink, .5); text(W / 2, 102 * k, `${tempoFlow.goal.toUpperCase()} · ${tempoFlow.duration} MIN PLAN`, 13, 0x5a4632, .5)
    const metrics = [['ACTIVE TIME', formatActive(active), P.teal], ['MOVEMENT', `${actions} ACTIONS`, P.teal], ['ACTIVE ENERGY', energyRows.length ? `~${Math.round(kcal)} KCAL` : 'NOT CALCULATED', P.orange], ['RECOVERY', seg.some((s) => s.player?.recovery !== null) ? 'MEASURED' : 'NOT MEASURED', P.purple]] as const
    metrics.forEach(([a, b, c], i) => { const x = W * .185 + i * W * .19; text(x, 160 * k, a, 12, c, .5); text(x, 190 * k, b, 23, c, .5) })
    this.add.rectangle(W / 2, 250 * k, W * .7, 3 * k, P.ink, .2).setDepth(12)
    text(W * .16, 282 * k, 'SESSION STORY', 18, P.blue)
    seg.slice(0, 4).forEach((s, i) => { const y = (328 + i * 55) * k; text(W * .17, y, s.sport.toUpperCase(), 17, s.sport === 'boxing' ? P.red : s.sport === 'bowling' ? P.blue : P.green); text(W * .34, y + 2 * k, `${formatActive(s.summary?.activeSeconds ?? 0)} active · ${Math.round((s.summary?.motionLoad ?? 0) * 100)}% load · ${Math.round(s.performance * 100)}% performance`, 12, P.ink); text(W * .77, y, s.decision?.difficultyDelta ? `${s.decision.difficultyDelta > 0 ? '+' : ''}${Math.round(s.decision.difficultyDelta * 100)}%` : 'HOLD', 17, P.purple, 1) })
    const last = seg.at(-1); text(W * .16, 560 * k, 'TEMPO ADAPTATION', 18, P.purple); text(W * .16, 600 * k, last?.decision ? `Challenge progression: ${last.decision.difficultyDelta > 0 ? '+' : ''}${Math.round(last.decision.difficultyDelta * 100)}% · ${last.decision.reasonCode.replaceAll('_', ' ')}` : 'No adaptation recorded.', 13, P.ink)
    new ComicButton(this, W / 2, H - 76 * k, 'DONE', () => { void fetch('/vitals/stop', { method: 'POST' }).catch(() => {}); wipeTo(this, 'menu') }, { color: P.green, w: 260 * k, h: 56 * k, size: Math.round(23 * k) })
    this.input.keyboard!.on('keydown-ENTER', () => wipeTo(this, 'menu')); this.input.keyboard!.on('keydown-ESC', () => wipeTo(this, 'menu'))
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}
