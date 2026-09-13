import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, doodles, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'
import { loadSettings, saveSettings } from '../agent/sliders'
import type { HealthSummary } from '../../server/health'
import { formatActive, praise, type HealthSport } from '../health/energy'

/**
 * The health tab: what the last week of play did, from the phone's motion. Active minutes and swing
 * counts are exact; calories and range of motion are estimates and say so. Everything is read from the
 * local health service on this machine; nothing here leaves it.
 */
const SPORTS: HealthSport[] = ['boxing', 'bowling', 'golf']
const SPORT_COLOR: Record<HealthSport, number> = { boxing: P.red, bowling: P.blue, golf: P.green }
const DAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export class HealthScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private summary: HealthSummary | null = null
  private drawn: Phaser.GameObjects.GameObject[] = []
  private status!: Phaser.GameObjects.Text
  private weightKg = 70
  private goalKcal = 100
  private clearArmed = false
  constructor() { super('health') }

  create(): void {
    ensureTextures(this)
    const { width: W, height: H } = this.scale
    this.city = new ComicBackdrop(this, 4)
    doodles(this, 8)
    this.weightKg = loadSettings().weightKg
    this.goalKcal = loadSettings().dailyGoalKcal
    this.time.addEvent({ delay: 5000, loop: true, callback: () => void this.refresh() })
    comicPanel(this, 30, 18, Math.min(520, W * 0.42), 92, P.paper, -1.5).setDepth(10)
    this.add.text(60, 40, 'HEALTH', { fontFamily: DISPLAY, fontSize: '54px', color: HEX(P.teal), stroke: HEX(P.ink), strokeThickness: 10 }).setDepth(11).setAngle(-1.5)
    this.add.text(300, 52, 'from phone motion · estimates,\nnot medical measurements', { fontFamily: FONT, fontSize: '13px', color: HEX(0x5a4632), fontStyle: '900' }).setOrigin(0, 0.5).setDepth(11)
    this.status = this.add.text(W / 2, H / 2, 'reading your movement history…', { fontFamily: FONT, fontSize: '18px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 14, y: 8 } }).setOrigin(0.5).setDepth(20)
    const back = new ComicButton(this, W - 150, 62, '◀ BACK', () => { sfx.back(); wipeTo(this, 'menu') }, { color: P.gold, w: 200, h: 56, size: 24 }).setDepth(12)
    back.setFocus(true)
    this.input.keyboard!.on('keydown-ESC', () => wipeTo(this, 'menu'))
    this.input.keyboard!.on('keydown-BACKSPACE', () => wipeTo(this, 'menu'))
    this.input.keyboard!.on('keydown-LEFT', () => this.weight(-1))
    this.input.keyboard!.on('keydown-RIGHT', () => this.weight(1))
    this.input.keyboard!.on('keydown-UP', () => this.goal(10))
    this.input.keyboard!.on('keydown-DOWN', () => this.goal(-10))
    this.input.keyboard!.on('keydown-R', () => void this.refresh())
    this.input.keyboard!.on('keydown-C', () => void this.clear())
    this.add.text(W / 2, H - 22, '←→ body weight  ·  ↑↓ daily goal  ·  R refresh  ·  C clear history (press twice)  ·  Esc back', { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 12, y: 5 } }).setOrigin(0.5).setDepth(11)
    void this.refresh()
  }

  update(_t: number, dt: number): void { this.city.update(dt) }

  private weight(d: number): void {
    this.weightKg = Math.max(30, Math.min(200, this.weightKg + d))
    saveSettings({ ...loadSettings(), weightKg: this.weightKg })
    if (this.summary) this.render(this.summary)
  }

  private goal(d: number): void {
    this.goalKcal = Math.max(20, Math.min(2000, this.goalKcal + d))
    saveSettings({ ...loadSettings(), dailyGoalKcal: this.goalKcal })
    if (this.summary) this.render(this.summary)
  }

  private async clear(): Promise<void> {
    if (!this.clearArmed) { this.clearArmed = true; this.status.setText('press C again to erase the whole history').setVisible(true); this.time.delayedCall(2500, () => { this.clearArmed = false; if (this.summary) this.status.setVisible(false) }); return }
    this.clearArmed = false
    try { await fetch('/health', { method: 'DELETE' }) } catch { /* offline: nothing to clear */ }
    await this.refresh()
  }

  private async refresh(): Promise<void> {
    try {
      const r = await fetch('/health/summary?days=7', { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      this.summary = await r.json() as HealthSummary
      this.status.setVisible(false)
      this.render(this.summary)
    } catch {
      this.status.setText('health service offline · start it with  npm run agent').setVisible(true)
    }
  }

  private render(s: HealthSummary): void {
    for (const o of this.drawn) o.destroy()
    this.drawn = []
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.drawn.push(o); return o }
    const { width: W, height: H } = this.scale
    const k = Math.min(1, W / 1280, H / 800)
    const font = (n: number): string => `${Math.round(n * k)}px`
    const col = (x: number): number => 30 + x * k, row = (y: number): number => 130 + y * k
    const text = (x: number, y: number, t: string, size: number, color = P.ink, style = FONT): Phaser.GameObjects.Text =>
      add(this.add.text(col(x), row(y), t, { fontFamily: style, fontSize: font(size), color: HEX(color), fontStyle: style === FONT ? '900' : undefined }).setDepth(11))
    const panel = (x: number, y: number, w: number, h: number, tilt = -0.6): void => { add(comicPanel(this, col(x), row(y), w * k, h * k, P.paper, tilt, 0.94).setDepth(10)) }
    const big = (x: number, y: number, value: string, label: string, color: number): void => {
      text(x, y, value, 44, color, DISPLAY); text(x, y + 50, label, 12, 0x5a4632)
    }

    // today
    panel(0, 0, 380, 250)
    text(20, 16, 'TODAY', 22, P.ink, DISPLAY)
    const t = s.today
    big(20, 56, formatActive(t.activeSeconds), 'active time', P.teal)
    big(200, 56, `~${Math.round(t.kcal)}`, 'kcal, estimated', P.orange)
    big(20, 140, `${t.swings}`, 'swings', P.blue)
    big(200, 140, `${t.sessions}`, `session${t.sessions === 1 ? '' : 's'}`, P.purple)
    text(20, 222, s.streakDays > 1 ? `${s.streakDays}-day streak` : s.streakDays === 1 ? 'first day of a streak' : 'no active day yet', 13, 0x5a4632)
    // today's goal, and a word on how it is going
    panel(0, 560, 1250, 74, 0.2)
    const goalDone = Math.min(1, t.kcal / this.goalKcal)
    text(20, 574, `TODAY'S GOAL  ${Math.round(t.kcal)} / ${this.goalKcal} kcal`, 18, goalDone >= 1 ? P.green : P.ink, DISPLAY)
    const gb = add(this.add.graphics().setDepth(11))
    gb.fillStyle(P.ink, 0.9).fillRoundedRect(col(24), row(606), 500 * k, 16 * k, 8).fillStyle(P.paper).fillRoundedRect(col(20), row(602), 500 * k, 16 * k, 8)
    if (goalDone > 0) gb.fillStyle(goalDone >= 1 ? P.green : P.teal).fillRoundedRect(col(20), row(602), Math.max(16 * k, 500 * k * goalDone), 16 * k, 8)
    gb.lineStyle(3, P.ink).strokeRoundedRect(col(20), row(602), 500 * k, 16 * k, 8)
    add(this.add.text(col(560), row(600), praise(t.kcal, t.swings, t.activeSeconds, this.goalKcal), { fontFamily: FONT, fontSize: font(14), color: HEX(0x5a4632), fontStyle: '900', wordWrap: { width: 660 * k } }).setDepth(11))

    // week strip
    panel(410, 0, 440, 250)
    text(430, 16, 'THIS WEEK', 22, P.ink, DISPLAY); text(560, 22, 'active minutes per day', 12, 0x5a4632)
    const g = add(this.add.graphics().setDepth(11))
    const maxMin = Math.max(10, ...s.days.map((d) => d.activeSeconds / 60))
    s.days.forEach((d, i) => {
      const x = col(440 + i * 58), base = row(210), h = (d.activeSeconds / 60 / maxMin) * 130 * k
      g.fillStyle(P.ink, 0.9).fillRoundedRect(x + 4, base - h + 4, 38 * k, h, 6)
      g.fillStyle(d.activeSeconds > 0 ? P.teal : 0xd9cdb5).fillRoundedRect(x, base - h, 38 * k, h, 6)
      g.lineStyle(3, P.ink).strokeRoundedRect(x, base - h, 38 * k, h, 6)
      const day = new Date(d.day + 'T12:00:00')
      add(this.add.text(x + 19 * k, row(222), DAY[day.getDay()], { fontFamily: FONT, fontSize: font(12), color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5, 0).setDepth(11))
      if (d.activeSeconds > 0) add(this.add.text(x + 19 * k, base - h - 6 * k, `${Math.round(d.activeSeconds / 60)}`, { fontFamily: FONT, fontSize: font(11), color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5, 1).setDepth(11))
    })
    const weekly = s.days.reduce((a, d) => a + d.activeSeconds, 0) / 60
    text(430, 60, `${Math.round(weekly)} of 150 min`, 16, P.teal); text(430, 82, 'the usual weekly guideline for moderate activity', 11, 0x5a4632)

    // by sport
    panel(0, 270, 380, 190)
    text(20, 286, 'BY SPORT', 22, P.ink, DISPLAY)
    SPORTS.forEach((sp, i) => {
      const b = s.bySport[sp], y = 326 + i * 44
      text(20, y, sp.toUpperCase(), 15, SPORT_COLOR[sp], DISPLAY)
      text(120, y - 2, `${b.sessions} session${b.sessions === 1 ? '' : 's'} · ${formatActive(b.activeSeconds)} active · ~${Math.round(b.kcal)} kcal`, 12, 0x5a4632)
      text(120, y + 15, `${b.swings} swing${b.swings === 1 ? '' : 's'}${b.romMean ? ` · ${Math.round(b.romMean)}° per swing` : ''}`, 12, 0x5a4632)
    })

    // range of motion trend
    panel(410, 270, 440, 190)
    text(430, 286, 'RANGE OF MOTION', 22, P.ink, DISPLAY); text(430, 312, 'mean degrees per swing, by session', 11, 0x5a4632)
    if (s.romTrend.length < 2) text(430, 344, s.romTrend.length === 1 ? `${Math.round(s.romTrend[0].romMean)}° per swing so far · play another session to see a trend` : 'play two sessions with the phone to see a trend', 13, 0x5a4632)
    else {
      const gr = add(this.add.graphics().setDepth(11))
      const xs = s.romTrend.map((_, i) => col(440 + i * (400 / Math.max(1, s.romTrend.length - 1))))
      const maxR = Math.max(30, ...s.romTrend.map((r) => r.romMax))
      const y = (v: number): number => row(440) - (v / maxR) * 110 * k
      gr.lineStyle(4, P.ink)
      s.romTrend.forEach((r, i) => { if (i) gr.lineBetween(xs[i - 1], y(s.romTrend[i - 1].romMean), xs[i], y(r.romMean)) })
      s.romTrend.forEach((r, i) => { gr.fillStyle(SPORT_COLOR[r.sport]).fillCircle(xs[i], y(r.romMean), 7 * k); gr.lineStyle(3, P.ink).strokeCircle(xs[i], y(r.romMean), 7 * k) })
      const last = s.romTrend[s.romTrend.length - 1], first = s.romTrend[0]
      text(430, 444, `${Math.round(first.romMean)}° → ${Math.round(last.romMean)}° over ${s.romTrend.length} sessions`, 13, 0x5a4632)
    }

    // last session: effort over time
    panel(870, 0, 380, 460)
    text(890, 16, 'LAST SESSION', 22, P.ink, DISPLAY)
    const L = s.lastSession
    if (!L) text(890, 60, 'nothing recorded yet.\nplay a match with the phone\nconnected and it appears here.', 13, 0x5a4632)
    else {
      text(890, 52, `${L.sport} · ${L.source === 'phone' ? 'phone' : 'keyboard, no movement'}`, 14, SPORT_COLOR[L.sport])
      text(890, 74, `${new Date(L.endedAt ?? L.startedAt).toLocaleString()}`, 11, 0x5a4632)
      big(890, 100, formatActive(L.activeSeconds), 'active time', P.teal); big(1060, 100, `~${Math.round(L.kcal)}`, 'kcal est.', P.orange)
      big(890, 180, `${L.swings}`, 'swings', P.blue); big(1060, 180, L.swings ? `${Math.round(L.romMean)}°` : '—', 'per swing', P.purple)
      text(890, 262, 'EFFORT OVER TIME', 14, P.ink, DISPLAY)
      const ge = add(this.add.graphics().setDepth(11))
      const ep = L.epochs
      if (ep.length > 5) {
        const maxI = Math.max(2, ...ep.map((e) => e.mean))
        const x0 = col(890), w = 340 * k, y0 = row(410), h = 110 * k
        ge.fillStyle(0xffffff, 0.5).fillRect(x0, y0 - h, w, h)
        ge.lineStyle(3, P.teal)
        ep.forEach((e, i) => { const x = x0 + (i / (ep.length - 1)) * w, y = y0 - (e.mean / maxI) * h; if (i) ge.lineTo(x, y); else { ge.beginPath(); ge.moveTo(x, y) } })
        ge.strokePath()
        ge.lineStyle(2, P.ink).strokeRect(x0, y0 - h, w, h)
        const fade = L.fatigue
        text(890, 418, fade < 0.8 ? `effort faded to ${Math.round(fade * 100)}% of the start` : fade > 1.2 ? `effort grew to ${Math.round(fade * 100)}% of the start` : 'effort held steady', 12, 0x5a4632)
      } else text(890, 300, 'too short for a curve', 12, 0x5a4632)
    }

    // weight + privacy
    panel(0, 480, 1250, 66, 0.3)
    text(20, 496, `BODY WEIGHT ${this.weightKg} kg`, 18, P.ink, DISPLAY); text(260, 502, '←→ to adjust · calories: one per swing plus movement intensity at this weight', 12, 0x5a4632)
    text(20, 522, 'Stored in a local database on this machine only. Not a medical device, not a diagnosis. Active time and swings are measured; calories and range of motion are estimates.', 11, 0x5a4632)
  }
}
