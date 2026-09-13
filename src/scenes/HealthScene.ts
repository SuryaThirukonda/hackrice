import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { loadSettings } from '../agent/sliders'
import type { HealthSummary } from '../../server/health'
import { formatActive, formatGoalProgress, type HealthSport } from '../health/energy'
import { adaptationCopy, type AdaptationReason } from '../wellness/adaptation'

const SPORT_COLOR: Record<HealthSport, number> = { boxing: P.red, bowling: P.blue, golf: P.green }
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
/** Local calendar weekday from a YYYY-MM-DD day key (avoids UTC midnight shift). */
const weekday = (day: string, fallbackIndex: number): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return DAYS[fallbackIndex] ?? '·'
  return DAYS[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] ?? DAYS[fallbackIndex]
}

/** Consumer wellness history: one strong summary, then body response, adaptation and useful trends. */
export class HealthScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private drawn: Phaser.GameObjects.GameObject[] = []
  private status!: Phaser.GameObjects.Text
  constructor() { super('health') }

  create(): void {
    ensureTextures(this); this.city = new ComicBackdrop(this, 4)
    const { width: W, height: H } = this.scale
    this.status = this.add.text(W / 2, H / 2, 'LOADING YOUR TEMPO…', { fontFamily: DISPLAY, fontSize: '22px', color: HEX(P.ink), backgroundColor: HEX(P.paper), padding: { x: 18, y: 10 } }).setOrigin(.5).setDepth(30)
    this.input.keyboard!.on('keydown-ESC', () => wipeTo(this, 'menu'))
    this.input.keyboard!.on('keydown-S', () => wipeTo(this, 'settings'))
    this.input.keyboard!.on('keydown-R', () => void this.refresh())
    new ComicButton(this, W - Math.min(120, W * .11), 54, 'BACK', () => wipeTo(this, 'menu'), { color: P.gold, w: Math.min(170, W * .2), h: 52, size: 22 }).setDepth(20)
    void this.refresh()
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
  private async refresh(): Promise<void> {
    try {
      const r = await fetch('/health/summary?days=7', { cache: 'no-store' }); if (!r.ok) throw new Error()
      const s = await r.json() as HealthSummary; this.status.setVisible(false); this.render(s)
    } catch { this.status.setText('WELLNESS HISTORY OFFLINE\nstart  npm run agent').setAlign('center').setVisible(true); this.render(null) }
  }

  private render(s: HealthSummary | null): void {
    for (const o of this.drawn) o.destroy(); this.drawn = []
    const { width: W, height: H } = this.scale, k = Math.min(W / 1280, H / 720)
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.drawn.push(o); return o }
    const txt = (x: number, y: number, value: string, size: number, color = P.ink, display = false, originX = 0) => add(this.add.text(x, y, value, { fontFamily: display ? DISPLAY : FONT, fontSize: `${Math.max(10, Math.round(size * k))}px`, color: HEX(color), fontStyle: '900', lineSpacing: Math.round(3 * k) }).setOrigin(originX, 0).setDepth(12))
    const panel = (x: number, y: number, w: number, h: number, tilt = 0, strong = false) => add(comicPanel(this, x, y, w, h, P.paper, tilt, strong ? 1 : .96).setDepth(10))
    const section = (x: number, y: number, label: string, color: number) => { txt(x, y, label, 18, color, true); add(this.add.rectangle(x, y + 25 * k, 54 * k, 5 * k, color).setOrigin(0).setDepth(12)) }

    panel(24 * k, 14 * k, W - 48 * k, 82 * k, -0.4, true)
    txt(48 * k, 28 * k, 'TEMPO WELLNESS', 38, P.ink, true)
    txt(50 * k, 68 * k, 'Movement, activity and recovery from your Tempo sessions.', 13, 0x5a4632)

    const pad = 24 * k, top = 112 * k, summaryH = 138 * k
    panel(pad, top, W - pad * 2, summaryH, .25, true)
    const today = s?.today, last = s?.lastSession, settings = loadSettings()
    const todaySec = s?.todayActiveSeconds ?? today?.activeSeconds ?? 0
    const goal = settings.dailyGoalMinutes
    const primary: readonly (readonly [string, string, string, number])[] = [
      ['ACTIVE TIME', formatActive(todaySec), `${formatGoalProgress(todaySec, goal)} MIN GOAL`, P.teal],
      ['MOVEMENT', String(today?.swings ?? 0), 'ACTIONS', P.teal],
      settings.weightKg ? ['ACTIVE ENERGY', `~${Math.round(today?.kcal ?? 0)}`, 'KCAL · ESTIMATED', P.orange] : ['ACTIVITY LOAD', `${Math.round((last?.motionLoad ?? 0) * 100)}%`, 'PHONE MOTION', P.teal],
      ['RECOVERY', s?.latestVitals?.pulse ? 'MEASURED' : '—', s?.latestVitals?.pulse ? `${Math.round(s.latestVitals.pulse)} BPM LATEST` : 'NOT MEASURED', s?.latestVitals?.pulse ? P.purple : 0x7a6b58],
    ]
    primary.forEach(([label, value, note, color], i) => {
      const cellW = (W - pad * 2) / 4, x = pad + cellW * i
      if (i) add(this.add.rectangle(x, top + 22 * k, 2 * k, summaryH - 44 * k, P.ink, .16).setOrigin(.5, 0).setDepth(11))
      txt(x + 22 * k, top + 20 * k, label, 13, color, true); txt(x + 22 * k, top + 46 * k, value, 40, color, true); txt(x + 22 * k, top + 104 * k, note, 11, 0x5a4632)
    })

    const gap = 16 * k, lowerY = top + summaryH + 18 * k, lowerH = H - lowerY - 36 * k
    const leftW = (W - pad * 2 - gap) * .54, rightX = pad + leftW + gap, rightW = W - pad - rightX
    const half = (lowerH - gap) / 2
    panel(pad, lowerY, leftW, half, -.25); section(pad + 20 * k, lowerY + 16 * k, 'LAST SESSION', last ? SPORT_COLOR[last.sport] : P.blue)
    if (!last) {
      txt(pad + 20 * k, lowerY + 56 * k, 'NO SESSION YET', 24, P.ink, true)
      txt(pad + 20 * k, lowerY + 94 * k, 'Start a Tempo Session to build your movement story.', 13, 0x5a4632)
    } else {
      txt(pad + 20 * k, lowerY + 54 * k, last.sport.toUpperCase(), 27, SPORT_COLOR[last.sport], true)
      txt(pad + leftW - 20 * k, lowerY + 58 * k, new Date(last.endedAt ?? last.startedAt).toLocaleDateString(), 11, 0x5a4632, false, 1)
      txt(pad + 20 * k, lowerY + 94 * k, `${formatActive(last.activeSeconds)} active  ·  ${last.swings} actions  ·  ${Math.round(last.motionLoad * 100)}% movement load`, 13, P.ink)
      txt(pad + 20 * k, lowerY + 122 * k, last.weightKg ? `~${Math.round(last.kcal ?? 0)} kcal estimated · ${last.energyConfidence.toLowerCase()} confidence` : 'Energy not calculated · add optional weight in Settings', 11, 0x5a4632)
    }

    panel(pad, lowerY + half + gap, leftW, half, .25); section(pad + 20 * k, lowerY + half + gap + 16 * k, 'TEMPO ADAPTED', P.purple)
    const a = s?.lastAdaptation
    if (!a) {
      txt(pad + 20 * k, lowerY + half + gap + 58 * k, 'NO ADAPTATION YET', 21, P.ink, true)
      txt(pad + 20 * k, lowerY + half + gap + 92 * k, 'Complete recovery to let Tempo shape the next challenge.', 12, 0x5a4632)
    } else {
      const delta = Math.round((a.newDifficulty - a.previousDifficulty) * 100)
      txt(pad + 20 * k, lowerY + half + gap + 56 * k, delta > 0 ? `CHALLENGE +${delta}%` : delta < 0 ? `CHALLENGE ${delta}%` : 'CHALLENGE HELD', 24, P.purple, true)
      const copy = adaptationCopy(a.reasonCode as AdaptationReason)
      txt(pad + 20 * k, lowerY + half + gap + 92 * k, copy ?? 'Tempo kept the next segment steady.', 11, 0x5a4632)
    }

    panel(rightX, lowerY, rightW, half, .2); section(rightX + 20 * k, lowerY + 16 * k, 'BODY RESPONSE', P.blue)
    const v = s?.latestVitals
    if (!v?.pulse) {
      txt(rightX + 20 * k, lowerY + 58 * k, 'NOT MEASURED', 23, 0x7a6b58, true)
      txt(rightX + 20 * k, lowerY + 94 * k, 'Enable camera sensing during a Tempo Session.', 12, 0x5a4632)
    } else {
      txt(rightX + 20 * k, lowerY + 56 * k, `${Math.round(v.pulse)} BPM`, 31, P.blue, true)
      txt(rightX + 20 * k, lowerY + 101 * k, `LATEST USABLE PULSE  ·  ${Math.round(v.confidence)}% CONFIDENCE`, 10, 0x5a4632)
    }

    panel(rightX, lowerY + half + gap, rightW, half, -.2); section(rightX + 20 * k, lowerY + half + gap + 16 * k, 'ACTIVE MINUTES · THIS WEEK', P.teal)
    const days = s?.days ?? Array.from({ length: 7 }, () => ({ day: '', activeSeconds: 0 }))
    const chartY = lowerY + lowerH - 30 * k, chartTop = lowerY + half + gap + 58 * k, max = Math.max(goal, ...days.map((d) => d.activeSeconds / 60))
    days.forEach((d, i) => {
      const cell = (rightW - 42 * k) / 7, x = rightX + 22 * k + i * cell, h = Math.max(3 * k, (chartY - chartTop) * (d.activeSeconds / 60) / max)
      add(this.add.rectangle(x + cell * .18, chartY - h, cell * .55, h, d.activeSeconds ? P.teal : 0xcfc3a7).setOrigin(0).setDepth(12))
      txt(x + cell * .45, chartY + 4 * k, weekday((d as { day?: string }).day ?? '', i), 10, 0x5a4632, false, .5)
    })
    txt(W - pad, H - 22 * k, 'S  SETTINGS   ·   R  REFRESH   ·   Activity energy is estimated. Physiology is wellness-only.', 10, P.ink, false, 1)
  }
}
