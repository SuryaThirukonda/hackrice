import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { loadSettings } from '../agent/sliders'
import type { HealthSummary } from '../../server/health'
import { formatActive, formatGoalProgress, type HealthSport } from '../health/energy'
import { formatEstimatedEnergy, intensityBar, movementIntensity, sessionRomLabel } from '../health/display'
import { adaptationCopy } from '../wellness/adaptation'

const SPORT_COLOR: Record<HealthSport, number> = { boxing: P.red, bowling: P.blue, golf: P.green }
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const weekday = (day: string, fallbackIndex: number): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return DAYS[fallbackIndex] ?? '·'
  return DAYS[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] ?? DAYS[fallbackIndex]
}

/** Wellness history: Today → Last session → Body → ROM → Tempo → Week. */
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
      const w = loadSettings().weightKg
      const q = w !== null ? `&weightKg=${encodeURIComponent(String(w))}` : ''
      const r = await fetch(`/health/summary?days=7${q}`, { cache: 'no-store' }); if (!r.ok) throw new Error()
      const s = await r.json() as HealthSummary; this.status.setVisible(false); this.render(s)
    } catch { this.status.setText('WELLNESS HISTORY OFFLINE\nstart  npm run agent').setAlign('center').setVisible(true); this.render(null) }
  }

  private render(s: HealthSummary | null): void {
    for (const o of this.drawn) o.destroy(); this.drawn = []
    const { width: W, height: H } = this.scale, k = Math.min(W / 1280, H / 720)
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.drawn.push(o); return o }
    const txt = (x: number, y: number, value: string, size: number, color = P.ink, display = false, originX = 0) =>
      add(this.add.text(x, y, value, { fontFamily: display ? DISPLAY : FONT, fontSize: `${Math.max(10, Math.round(size * k))}px`, color: HEX(color), fontStyle: '900', lineSpacing: Math.round(3 * k) }).setOrigin(originX, 0).setDepth(12))
    const panel = (x: number, y: number, w: number, h: number, tilt = 0, strong = false) => add(comicPanel(this, x, y, w, h, P.paper, tilt, strong ? 1 : .96).setDepth(10))
    const section = (x: number, y: number, label: string, color: number) => { txt(x, y, label, 17, color, true); add(this.add.rectangle(x, y + 24 * k, 48 * k, 4 * k, color).setOrigin(0).setDepth(12)) }

    panel(24 * k, 14 * k, W - 48 * k, 78 * k, -0.4, true)
    txt(48 * k, 26 * k, 'TEMPO WELLNESS', 36, P.ink, true)
    txt(50 * k, 64 * k, 'Movement, energy, body response — from your sessions.', 12, 0x5a4632)

    const pad = 24 * k, top = 108 * k, settings = loadSettings(), goal = settings.dailyGoalMinutes
    const todaySec = s?.todayActiveSeconds ?? s?.today?.activeSeconds ?? 0
    const today = s?.today, last = s?.lastSession
    const energy = formatEstimatedEnergy(today?.kcal)
    const intensity = movementIntensity(last?.motionLoad ?? 0)

    panel(pad, top, W - pad * 2, 128 * k, .2, true)
    const primary: readonly (readonly [string, string, string, number])[] = [
      ['ACTIVE TIME', formatActive(todaySec), `${formatGoalProgress(todaySec, goal)} MIN`, P.teal],
      ['MOVEMENT', String(today?.swings ?? 0), 'ACTIONS', P.teal],
      ['EST. ACTIVE ENERGY', energy.value, energy.estimated ? `${energy.unit.toUpperCase()} EST.` : 'ADD WEIGHT', P.orange],
      ['SESSIONS', String(today?.sessions ?? 0), 'TODAY', P.blue],
    ]
    primary.forEach(([label, value, note, color], i) => {
      const cellW = (W - pad * 2) / 4, x = pad + cellW * i
      if (i) add(this.add.rectangle(x, top + 18 * k, 2 * k, 92 * k, P.ink, .14).setOrigin(.5, 0).setDepth(11))
      txt(x + 20 * k, top + 16 * k, label, 11, color, true)
      txt(x + 20 * k, top + 42 * k, value, 32, color, true)
      txt(x + 20 * k, top + 92 * k, note, 11, 0x5a4632)
    })

    const gap = 14 * k, lowerY = top + 144 * k, lowerH = H - lowerY - 32 * k
    const leftW = (W - pad * 2 - gap) * .55, rightX = pad + leftW + gap, rightW = W - pad - rightX
    const half = (lowerH - gap) / 2

    panel(pad, lowerY, leftW, half, -.2)
    section(pad + 18 * k, lowerY + 14 * k, 'LAST SESSION', last ? SPORT_COLOR[last.sport] : P.blue)
    if (!last) {
      txt(pad + 18 * k, lowerY + 52 * k, 'NO SESSION YET', 22, P.ink, true)
      txt(pad + 18 * k, lowerY + 86 * k, 'Finish a Tempo Session to build your story.', 12, 0x5a4632)
    } else {
      const rom = sessionRomLabel(last.sport, last.romMean, last.romMax, last.swings)
      const lastEnergy = formatEstimatedEnergy(last.kcal)
      txt(pad + 18 * k, lowerY + 50 * k, last.sport.toUpperCase(), 26, SPORT_COLOR[last.sport], true)
      txt(pad + leftW - 18 * k, lowerY + 54 * k, new Date(last.endedAt ?? last.startedAt).toLocaleDateString(), 11, 0x5a4632, false, 1)
      txt(pad + 18 * k, lowerY + 88 * k, `${formatActive(last.activeSeconds)} active  ·  ${last.swings} actions`, 13, P.ink)
      txt(pad + 18 * k, lowerY + 112 * k, `MOVEMENT INTENSITY  ${intensity}`, 12, 0x5a4632)
      txt(pad + 18 * k, lowerY + 132 * k, intensityBar(last.motionLoad), 12, P.teal)
      txt(pad + 18 * k, lowerY + 156 * k, lastEnergy.estimated ? `Est. active energy  ${lastEnergy.value} ${lastEnergy.unit}` : 'Est. active energy  NOT ESTIMATED', 11, 0x5a4632)
      if (rom) txt(pad + 18 * k, lowerY + 178 * k, `${rom.label}  ${rom.degrees}°`, 11, 0x5a4632)
      const epochs = last.epochs ?? []
      if (epochs.length > 4) {
        const chartX = pad + 18 * k, chartY = lowerY + half - 20 * k, chartW = leftW - 40 * k, chartH = 28 * k
        const step = Math.max(1, Math.floor(epochs.length / 40))
        const samples = epochs.filter((_, i) => i % step === 0).slice(0, 40)
        const maxLoad = Math.max(0.2, ...samples.map((e) => e.motionLoad ?? 0))
        samples.forEach((e, i) => {
          const h = Math.max(2 * k, chartH * ((e.motionLoad ?? 0) / maxLoad))
          const x = chartX + (i / samples.length) * chartW
          add(this.add.rectangle(x, chartY - h, Math.max(2, chartW / samples.length - 1), h, P.teal).setOrigin(0).setDepth(12))
        })
      }
    }

    panel(pad, lowerY + half + gap, leftW, half, .25)
    section(pad + 18 * k, lowerY + half + gap + 14 * k, 'TEMPO RESPONSE', P.purple)
    const a = s?.lastAdaptation
    if (!a) {
      txt(pad + 18 * k, lowerY + half + gap + 54 * k, 'NO ADAPTATION YET', 20, P.ink, true)
      txt(pad + 18 * k, lowerY + half + gap + 88 * k, 'Complete recovery after a session to adapt challenge.', 12, 0x5a4632)
    } else {
      const delta = Math.round((a.newDifficulty - a.previousDifficulty) * 100)
      txt(pad + 18 * k, lowerY + half + gap + 52 * k, delta > 0 ? `CHALLENGE +${delta}%` : delta < 0 ? `CHALLENGE ${delta}%` : 'CHALLENGE HELD', 24, P.purple, true)
      txt(pad + 18 * k, lowerY + half + gap + 90 * k, adaptationCopy(a.reasonCode) ?? 'Tempo kept the next segment steady.', 11, 0x5a4632)
    }

    panel(rightX, lowerY, rightW, half, .2)
    section(rightX + 18 * k, lowerY + 14 * k, 'BODY RESPONSE', P.blue)
    const v = s?.latestVitals
    if (!v?.pulse) {
      txt(rightX + 18 * k, lowerY + 54 * k, 'NOT MEASURED', 22, 0x7a6b58, true)
      txt(rightX + 18 * k, lowerY + 88 * k, 'Enable camera on Ready-Up for pulse.', 12, 0x5a4632)
    } else {
      txt(rightX + 18 * k, lowerY + 52 * k, `${Math.round(v.pulse)} BPM`, 30, P.blue, true)
      txt(rightX + 18 * k, lowerY + 96 * k, 'LATEST PULSE', 11, 0x5a4632)
      if (v.breathing) txt(rightX + 18 * k, lowerY + 120 * k, `Breathing  ${Math.round(v.breathing)} / min`, 12, 0x5a4632)
      if (v.hrvRmssd) txt(rightX + 18 * k, lowerY + 144 * k, `HRV RMSSD  ${Math.round(v.hrvRmssd)}  (extended)`, 11, 0x5a4632)
    }

    // ROM trend (same sport only)
    panel(rightX, lowerY + half + gap, rightW, half, -.2)
    section(rightX + 18 * k, lowerY + half + gap + 14 * k, 'ROM · ACTIVE MIN', P.teal)
    const trendSport = last?.sport
    const romTrend = (s?.romTrend ?? []).filter((r) => !trendSport || r.sport === trendSport).slice(-7)
    if (romTrend.length >= 2) {
      txt(rightX + 18 * k, lowerY + half + gap + 48 * k, `ROM TREND · ${trendSport?.toUpperCase() ?? 'SPORT'}`, 11, 0x5a4632)
      const maxRom = Math.max(1, ...romTrend.map((r) => r.romMean))
      romTrend.forEach((r, i) => {
        const cell = (rightW - 36 * k) / Math.max(7, romTrend.length)
        const x = rightX + 18 * k + i * cell
        const h = Math.max(4 * k, 36 * k * (r.romMean / maxRom))
        const base = lowerY + half + gap + 100 * k
        add(this.add.rectangle(x + cell * .2, base - h, cell * .5, h, P.magenta).setOrigin(0).setDepth(12))
      })
    }
    const days = s?.days ?? Array.from({ length: 7 }, () => ({ day: '', activeSeconds: 0 }))
    const chartY = lowerY + lowerH - 28 * k, chartTop = lowerY + half + gap + (romTrend.length >= 2 ? 120 * k : 52 * k)
    const max = Math.max(goal, ...days.map((d) => d.activeSeconds / 60), 1)
    days.forEach((d, i) => {
      const cell = (rightW - 36 * k) / 7, x = rightX + 18 * k + i * cell
      const h = Math.max(3 * k, Math.max(0, chartY - chartTop) * (d.activeSeconds / 60) / max)
      add(this.add.rectangle(x + cell * .18, chartY - h, cell * .55, h, d.activeSeconds ? P.teal : 0xcfc3a7).setOrigin(0).setDepth(12))
      txt(x + cell * .45, chartY + 4 * k, weekday(d.day ?? '', i), 10, 0x5a4632, false, .5)
    })

    txt(W - pad, H - 18 * k, 'S SETTINGS  ·  R REFRESH  ·  Energy estimated from motion + weight  ·  Not a diagnosis', 10, P.ink, false, 1)
  }
}
