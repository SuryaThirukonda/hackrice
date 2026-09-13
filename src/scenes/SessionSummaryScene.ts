import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { tempoFlow } from '../wellness/tempoFlow'
import { formatActive } from '../health/energy'
import { sensingSession } from '../camera/sensingSession'
import { expressionLabel, type Expression } from '../wellness/expressions'

/** Clean post-session summary — only sections with real data. */
export class SessionSummaryScene extends Phaser.Scene {
  private city!: ComicBackdrop
  constructor() { super('session-summary') }

  create(): void {
    ensureTextures(this)
    this.city = new ComicBackdrop(this, 84)
    const { width: W, height: H } = this.scale
    const k = Math.min(W / 1280, H / 720)
    const seg = tempoFlow.segments
    const active = seg.reduce((n, s) => n + (s.summary?.activeSeconds ?? 0), 0)
    const actions = seg.reduce((n, s) => n + (s.summary?.swings ?? 0), 0)
    const energyRows = seg.filter((s) => s.summary && s.summary.kcal !== null)
    const kcal = energyRows.reduce((n, s) => n + (s.summary?.kcal ?? 0), 0)
    const load = seg.length ? seg.reduce((n, s) => n + (s.summary?.motionLoad ?? 0), 0) / seg.length : 0
    const perf = seg.length ? seg.reduce((n, s) => n + s.performance, 0) / seg.length : 0
    const recovered = seg.some((s) => s.player?.recovery !== null && s.player?.recovery !== undefined)
    const last = seg.at(-1)
    const sport = (tempoFlow.selectedSport ?? last?.sport ?? 'tempo').toUpperCase()

    comicPanel(this, W * .1, 28 * k, W * .8, H - 56 * k, P.paper, -.4, 1)
    const t = (x: number, y: number, text: string, size: number, color = P.ink, ox = 0) =>
      this.add.text(x, y, text, {
        fontFamily: DISPLAY, fontSize: `${Math.round(size * k)}px`, color: HEX(color), fontStyle: '900',
        wordWrap: { width: W * .7 },
      }).setOrigin(ox, 0).setDepth(12)

    t(W / 2, 48 * k, 'TEMPO SUMMARY', 40, P.ink, .5)
    t(W / 2, 96 * k, `${sport}  ·  ${formatActive(active)}`, 14, 0x5a4632, .5)

    let y = 140 * k
    const section = (title: string, color: number, lines: string[]) => {
      if (!lines.length) return
      t(W * .16, y, title, 16, color)
      y += 28 * k
      for (const line of lines) { t(W * .18, y, line, 18, P.ink); y += 28 * k }
      y += 18 * k
    }

    section('MOVEMENT', P.teal, [
      `${actions} actions`,
      `${Math.round(load * 100)}% movement load`,
    ])
    if (energyRows.length) section('ENERGY', P.orange, [`~${Math.round(kcal)} kcal estimated active energy`])
    if (tempoFlow.baselinePulse !== null || recovered) {
      const body: string[] = []
      if (tempoFlow.baselinePulse !== null) body.push(`Starting pulse  ${Math.round(tempoFlow.baselinePulse)}`)
      if (recovered) body.push('Recovery  Measured')
      else body.push('Recovery  Not measured')
      section('BODY RESPONSE', P.blue, body)
    }
    // Expressions from last sensing snapshot if any face data was present this session
    const snap = sensingSession.snapshot
    if (snap.dominantExpression && snap.facePresent) {
      section('EXPRESSIONS', P.magenta, [
        `Mostly  ${expressionLabel(snap.dominantExpression as Expression)}`,
        'Camera-derived session expressions',
      ])
    }
    section('PERFORMANCE', P.gold, [`${Math.round(perf * 100)}%`])
    if (last?.decision) {
      const d = last.decision.difficultyDelta
      section('TEMPO RESPONSE', P.purple, [
        d ? `Next challenge  ${d > 0 ? '+' : ''}${Math.round(d * 100)}%` : 'Next challenge  Hold',
      ])
    }

    const done = () => {
      void sensingSession.stop()
      void fetch('/vitals/stop', { method: 'POST' }).catch(() => {})
      wipeTo(this, 'menu')
    }
    new ComicButton(this, W / 2, H - 70 * k, 'DONE', done, { color: P.green, w: 240 * k, h: 52 * k, size: Math.round(22 * k) })
    this.input.keyboard!.on('keydown-ENTER', done)
    this.input.keyboard!.on('keydown-ESC', done)
  }

  update(_t: number, dt: number): void { this.city.update(dt) }
}
