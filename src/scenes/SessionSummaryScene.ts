import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { tempoFlow } from '../wellness/tempoFlow'
import { formatActive, type HealthSport } from '../health/energy'
import { formatEstimatedEnergyLine, intensityBar, movementIntensity, sessionRomLabel } from '../health/display'
import { sensingSession } from '../camera/sensingSession'
import { EXPRESSION_EMOJI, expressionLabel, type Expression } from '../wellness/expressions'

/** Post-session summary — sections only when data exists; no generic Performance %. */
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
    const load = seg.length ? seg.reduce((n, s) => n + (s.summary?.motionLoad ?? 0), 0) / seg.length : 0
    let kcal: number | null = null
    for (const s of seg) {
      if (s.summary?.kcal !== null && s.summary?.kcal !== undefined) kcal = (kcal ?? 0) + s.summary.kcal
    }
    const last = seg.at(-1)
    const sport = (tempoFlow.selectedSport ?? last?.sport ?? 'golf') as HealthSport
    const romMean = seg.reduce((n, s) => n + (s.summary?.romMean ?? 0), 0) / Math.max(1, seg.filter((s) => (s.summary?.swings ?? 0) > 0).length)
    const romMax = Math.max(0, ...seg.map((s) => s.summary?.romMax ?? 0))
    const rom = sessionRomLabel(sport, romMean || 0, romMax, actions)

    comicPanel(this, W * .08, 20 * k, W * .84, H - 40 * k, P.paper, -.4, 1)
    const t = (x: number, y: number, text: string, size: number, color = P.ink, ox = 0, font = DISPLAY) =>
      this.add.text(x, y, text, {
        fontFamily: font, fontSize: `${Math.round(size * k)}px`, color: HEX(color), fontStyle: '900',
        wordWrap: { width: W * .72 },
      }).setOrigin(ox, 0).setDepth(12)

    t(W / 2, 36 * k, 'TEMPO SUMMARY', 36, P.ink, .5)
    t(W / 2, 78 * k, `${sport.toUpperCase()}  ·  ${formatActive(active)}`, 14, 0x5a4632, .5)

    const colW = W * .36
    const leftX = W * .12
    const rightX = W * .52
    let yL = 120 * k
    let yR = 120 * k

    const card = (x: number, y: number, title: string, color: number, body: string[]) => {
      const h = 36 * k + body.length * 26 * k
      comicPanel(this, x, y, colW, h, P.paper, 0, .92).setDepth(11)
      t(x + 16 * k, y + 12 * k, title, 14, color)
      body.forEach((line, i) => t(x + 16 * k, y + 38 * k + i * 26 * k, line, 16, P.ink, 0, FONT))
      return h + 14 * k
    }

    const intensity = movementIntensity(load)
    yL += card(leftX, yL, 'MOVEMENT', P.teal, [
      intensity,
      intensityBar(load),
      `${actions} actions`,
      ...(rom ? [`${rom.label}  ${rom.degrees}°`] : []),
    ])

    yL += card(leftX, yL, 'ESTIMATED ACTIVE ENERGY', P.orange, [
      formatEstimatedEnergyLine(kcal),
    ])

    const bodyLines: string[] = []
    if (tempoFlow.baselinePulse !== null) bodyLines.push(`Pulse  ${Math.round(tempoFlow.baselinePulse)}`)
    const snap = sensingSession.snapshot
    if (snap.breathing) bodyLines.push(`Breathing  ${Math.round(snap.breathing)} / min`)
    else bodyLines.push('Breathing  —')
    if (seg.some((s) => s.player?.recovery !== null && s.player?.recovery !== undefined)) bodyLines.push('Recovery  Measured')
    yR += card(rightX, yR, 'BODY', P.blue, bodyLines)

    const expr = sensingSession.expressionSummary
    if (expr.coverage >= 0.15 && Object.keys(expr.distribution).length) {
      const rows = Object.entries(expr.distribution)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 5)
        .map(([key, p]) => {
          const e = key as Expression
          const pct = Math.round((p ?? 0) * 100)
          const bar = intensityBar(p ?? 0, 8)
          return `${EXPRESSION_EMOJI[e] ?? ''} ${expressionLabel(e).padEnd(9)} ${bar} ${pct}%`
        })
      const header = expr.mixed || !expr.dominant ? 'MIXED EXPRESSIONS' : expressionLabel(expr.dominant)
      yR += card(rightX, yR, 'SESSION EXPRESSIONS', P.magenta, [header, ...rows])
    }

    if (last?.sportResult) {
      yL += card(leftX, yL, last.sportResult.title, P.gold, last.sportResult.lines)
    }

    if (last?.decision) {
      const d = last.decision.difficultyDelta
      yR += card(rightX, yR, 'TEMPO RESPONSE', P.purple, [
        d ? `Challenge  ${d > 0 ? '+' : ''}${Math.round(d * 100)}%` : 'Challenge  Hold',
      ])
    }

    const done = () => {
      void sensingSession.stop()
      void fetch('/vitals/stop', { method: 'POST' }).catch(() => {})
      wipeTo(this, 'menu')
    }
    new ComicButton(this, W / 2, H - 56 * k, 'DONE', done, { color: P.green, w: 240 * k, h: 48 * k, size: Math.round(22 * k) })
    this.input.keyboard!.on('keydown-ENTER', done)
    this.input.keyboard!.on('keydown-ESC', done)
  }

  update(_t: number, dt: number): void { this.city.update(dt) }
}
