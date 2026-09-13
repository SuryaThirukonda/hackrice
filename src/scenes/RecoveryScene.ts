import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { tempoFlow } from '../wellness/tempoFlow'
import { buildPlayerState } from '../wellness/playerState'
import { AdaptationEngine, adaptationCopy } from '../wellness/adaptation'
import { recoveryLabel, recoveryProgress } from '../wellness/recovery'
import { bowlingParams, boxingParams, golfParams } from '../agent/sliders'

type Vitals = { source: 'camera' | 'demo' | null; validation: string; pulse: { value: number; confidence: number; stable: boolean; at: number } | null }
export class RecoveryScene extends Phaser.Scene {
  private city!: ComicBackdrop; private content: Phaser.GameObjects.GameObject[] = []; private started = 0; private post: number | null = null; private current: number | null = null; private recovery: number | null = null; private adapted = false
  constructor() { super('recovery') }
  create(): void {
    ensureTextures(this); this.city = new ComicBackdrop(this, 83); this.started = Date.now()
    const kb = this.input.keyboard!; kb.on('keydown-ENTER', () => this.adapted ? this.continue() : this.adapt()); kb.on('keydown-SPACE', () => this.adapted ? this.continue() : this.adapt()); kb.on('keydown-S', () => { this.recovery = null; this.adapt() }); kb.on('keydown-ESC', () => wipeTo(this, 'menu'))
    this.time.addEvent({ delay: 1000, loop: true, callback: () => void this.poll() }); this.draw()
  }
  private async poll(): Promise<void> {
    if (this.adapted) return
    try {
      const r = await fetch('/vitals', { cache: 'no-store' }); if (!r.ok) throw new Error(); const v = await r.json() as Vitals
      if (v.source === 'demo' && tempoFlow.baselinePulse !== null) { const t = Math.min(1, (Date.now() - this.started) / 12_000); this.post = tempoFlow.baselinePulse + 28; this.current = this.post - 22 * t }
      else if (v.pulse && v.validation === 'Ok' && v.pulse.stable && v.pulse.confidence >= 40 && Date.now() - v.pulse.at <= 5000) { this.post ??= v.pulse.value; this.current = v.pulse.value }
      this.recovery = recoveryProgress({ baselinePulse: tempoFlow.baselinePulse, postActivityPulse: this.post, currentPulse: this.current, sampleAt: Date.now(), now: Date.now(), valid: this.current !== null })
    } catch { this.recovery = null }
    if (Date.now() - this.started >= 6_000) this.adapt(); else this.draw()
  }
  private adapt(): void {
    if (this.adapted) return
    const latest = tempoFlow.latest; if (!latest) return this.continue()
    const player = buildPlayerState({ performance: latest.performance, consistency: latest.consistency, motionIntensity: latest.summary?.motionLoad ?? 0, engagement: latest.summary?.source === 'phone' ? Math.min(1, (latest.summary.activeSeconds + latest.summary.swings * 2) / 60) : .25, recovery: this.recovery, physiologyConfidence: this.recovery === null ? 0 : .8 })
    const engine = new AdaptationEngine(), decision = engine.decide(player, latest.sport), previous = tempoFlow.difficulty.reaction, next = engine.apply(previous, decision)
    latest.player = player; latest.decision = decision
    for (const key of ['reaction', 'accuracy', 'defense'] as const) tempoFlow.difficulty[key] = engine.apply(tempoFlow.difficulty[key], decision)
    if (latest.summary && latest.summary.id > 0) void fetch(`/health/session/${latest.summary.id}/adaptation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at: Date.now(), player, previousDifficulty: previous, newDifficulty: next, decision }) }).catch(() => {})
    this.adapted = true; this.draw()
  }
  private continue(): void {
    const sport = tempoFlow.nextSport(); if (!sport) return wipeTo(this, 'session-summary')
    const d = tempoFlow.difficulty, data = sport === 'boxing' ? { mode: '1p', bot: boxingParams(d), tempo: true } : sport === 'bowling' ? { mode: '1p', bot: bowlingParams(d), tempo: true } : { mode: '1p', bot: golfParams(d), tempo: true }
    wipeTo(this, sport, data)
  }
  private draw(): void {
    this.content.forEach((o) => o.destroy()); this.content = []
    const { width: W, height: H } = this.scale, k = Math.min(W / 1280, H / 720), add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.content.push(o); return o }
    const panel = (x: number, y: number, w: number, h: number, color = P.paper, tilt = 0) => add(comicPanel(this, x, y, w, h, color, tilt, 1))
    const text = (x: number, y: number, t: string, n: number, c = P.ink, origin = 0, wrap = W * .52) => add(this.add.text(x, y, t, { fontFamily: DISPLAY, fontSize: `${Math.round(n * k)}px`, color: HEX(c), fontStyle: '900', align: 'center', wordWrap: { width: wrap } }).setOrigin(origin, 0).setDepth(12))
    panel(W * .08, 30 * k, W * .84, H - 60 * k, P.paper, -.5)
    text(W / 2, 58 * k, this.adapted ? 'TEMPO ADAPTED' : 'RECOVER', 45, this.adapted ? P.purple : P.blue, .5)
    text(W / 2, 116 * k, this.adapted ? 'Your next challenge is locked in.' : 'Face the screen and stay relatively still.', 15, 0x5a4632, .5)
    const left = W * .16, top = 180 * k, cardW = W * .29, cardH = 310 * k
    panel(left, top, cardW, cardH, P.paper, .4); panel(W - left - cardW, top, cardW, cardH, P.paper, -.4)
    text(left + 24 * k, top + 24 * k, 'BODY RESPONSE', 18, P.blue)
    const rows: [string, string][] = [['STARTING', tempoFlow.baselinePulse ? `${Math.round(tempoFlow.baselinePulse)} BPM` : 'NOT MEASURED'], ['POST ACTIVITY', this.post ? `${Math.round(this.post)} BPM` : 'MEASURING'], ['CURRENT', this.current ? `${Math.round(this.current)} BPM` : '—']]
    rows.forEach(([a, b], i) => { text(left + 24 * k, top + (72 + i * 58) * k, a, 11, 0x5a4632); text(left + cardW - 24 * k, top + (66 + i * 58) * k, b, 18, P.blue, 1) })
    const ry = top + 252 * k; text(left + 24 * k, ry, 'RECOVERY TREND', 11, P.purple); const g = add(this.add.graphics().setDepth(12)); g.fillStyle(0xd6c9aa).fillRoundedRect(left + 24 * k, ry + 28 * k, cardW - 48 * k, 18 * k, 9 * k); if (this.recovery !== null) g.fillStyle(P.purple).fillRoundedRect(left + 24 * k, ry + 28 * k, Math.max(12 * k, (cardW - 48 * k) * this.recovery), 18 * k, 9 * k)
    text(W - left - cardW + 24 * k, top + 24 * k, 'NEXT CHALLENGE', 18, P.purple)
    const latest = tempoFlow.latest, decision = latest?.decision
    text(W - left - cardW + 24 * k, top + 76 * k, latest ? `PERFORMANCE  ${latest.performance >= .72 ? 'STRONG' : latest.performance >= .45 ? 'STEADY' : 'BUILDING'}` : 'PERFORMANCE  —', 14, P.ink)
    text(W - left - cardW + 24 * k, top + 112 * k, `RECOVERY  ${recoveryLabel(this.recovery)}`, 14, P.ink)
    if (decision) text(W - left - cardW + 24 * k, top + 146 * k, `NEXT SPORT  ${tempoFlow.peekNextSport()?.toUpperCase() ?? 'COOLDOWN'}`, 14, P.blue)
    text(W - left - cardW + 24 * k, top + (decision ? 184 : 168) * k, decision ? decision.difficultyDelta > 0 ? `REACTION +${Math.round(decision.difficultyDelta * 100)}%` : decision.difficultyDelta < 0 ? `CHALLENGE ${Math.round(decision.difficultyDelta * 100)}%` : 'CHALLENGE HELD' : 'PREPARING…', 25, decision ? P.purple : P.orange)
    if (decision) text(W - left - cardW + 24 * k, top + 232 * k, adaptationCopy(decision.reasonCode) ?? 'Tempo kept the next segment steady.', 11, 0x5a4632, 0, cardW - 48 * k)
    const status = this.recovery === null ? 'Physiology unavailable · continuing with movement + performance.' : `Signal good · ${Math.round(this.recovery * 100)}% toward starting pulse.`
    text(W / 2, H - 138 * k, status, 12, this.recovery === null ? P.orange : P.green, .5)
    if (this.adapted) add(new ComicButton(this, W / 2, H - 78 * k, 'CONTINUE', () => this.continue(), { color: P.green, w: 300 * k, h: 58 * k, size: Math.round(24 * k) }))
    else text(W / 2, H - 78 * k, 'Tempo is preparing your next challenge…  ·  S skip sensing', 12, P.ink, .5)
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}
