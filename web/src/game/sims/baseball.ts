// Baseball: the House pitches on the client clock; a swing's time is compared to the pitch's arrival (backend/app/games/baseball.py port).
import { Rng } from './rng'
import type { DecisionReq, Gesture, Sim, StartPayload, TurnPlan, TurnResult } from './types'

export interface Side { runs: number; hits: number; outs: number; bases: boolean[] }
export interface Pitch { kind: string; release_ts: number; arrival_ts: number; travel_ms: number; height: number; brk: number; late_break_ms: number; no: number; strikes: number }
export interface BbEvent { kind: string; result?: string; strikes?: number; dt_ms?: number | null; dir?: number; dist?: number; quality?: number; swung?: boolean; pitch_no?: number; no_pitch?: boolean; pitch?: Pitch }
const OFFSPEED = ['changeup', 'curve', 'knuckle'], LOCATION = ['high', 'low', 'inside', 'outside']

export class BaseballSim implements Sim {
  readonly sport = 'baseball'
  rng = new Rng(1)
  start!: StartPayload
  params: Record<string, unknown> = {}
  adjustments: Record<string, number> = {}
  innings = 3; outsPerHalf = 3; pitchGapS = 2.5; atBatWindowS = 45
  pitchDefs: Record<string, { travel_ms: number; brk: number; height: number; late_break?: number }> = {}
  human: Side = { runs: 0, hits: 0, outs: 0, bases: [false, false, false] }
  house: Side = { runs: 0, hits: 0, outs: 0, bases: [false, false, false] }
  inning = 1; suddenDeath = false
  pitch: Pitch | null = null; pitchNo = 0; arrivalMs = -1; actualArrival = -1; nextReleaseMs = -1
  strikes = 0; atBatOver = false; atBatResult: Record<string, unknown> = {}; swung = false
  events: BbEvent[] = []
  dts: number[] = []; swingN = 0; swingS = 0; pmode = 'mix'
  seats: string[] = []
  private plan: TurnPlan | null = null
  turnNo = 0

  setup(start: StartPayload): void {
    this.start = start; this.rng = new Rng(start.seed); this.params = { ...start.tier.params }
    const g = (start.game.baseball ?? {}) as Record<string, unknown>
    this.innings = Number(g.innings ?? 3); this.outsPerHalf = Number(g.outs_per_half ?? 3); this.pitchGapS = Number(g.pitch_gap_s ?? 2.5); this.atBatWindowS = Number(g.at_bat_window_s ?? 45)
    this.pitchDefs = (g.pitches ?? {}) as typeof this.pitchDefs
    this.suddenDeath = !!this.params.sudden_death
    this.seats = start.seats.map((s) => s.seat_id)
    for (const [k, v] of Object.entries(start.adjustments ?? {})) this.adjust(k, v, 'adaptive')
  }
  param(n: string, d: number): number { return Number(this.params[n] ?? d) + (this.adjustments[n] ?? 0) }
  adjust(name: string, delta: number, reason: string): void { this.adjustments[name] = reason === 'adaptive' ? delta : (this.adjustments[name] ?? 0) + delta }
  grant(): void {}
  humanLabel(): string { return Object.values(this.start.players).join(', ') || 'Player' }

  planTurn(): TurnPlan | null {
    if (this.inning > this.innings || this.atBatResult.sudden_death_over) return null
    this.strikes = 0; this.atBatOver = false; this.atBatResult = {}; this.pitch = null; this.arrivalMs = -1; this.swung = false; this.nextReleaseMs = -1; this.events = []
    const label = `Inning ${this.inning} · ${this.humanLabel()} at bat`
    this.plan = { label, input_seats: [this.seats[0]], input_window_s: this.atBatWindowS, betting: true, live: true,
      markets: [{ kind: 'turn_outcome', label, outcomes: [['hit', 'Hit'], ['out', 'Out']] }],
      prompt: { inning: this.inning, outs: this.human.outs, bases: this.human.bases, sudden_death: this.suddenDeath } }
    return this.plan
  }
  currentPlan(): TurnPlan | null { return this.plan }
  meanDt(): number { return this.dts.length ? this.dts.reduce((a, b) => a + b, 0) / this.dts.length : 0 }
  swingRate(): number { return this.swingN ? this.swingS / this.swingN : 1 }
  decisionsBefore(phase: 'input' | 'resolving'): DecisionReq[] {
    if (phase !== 'input') return []
    const md = this.meanDt()
    return [{ agent_id: `house:baseball:${this.start.tier.id}`, default: 'attack', context: { inning: this.inning, human_runs: this.human.runs, house_runs: this.house.runs, mean_dt_ms: md },
      options: [{ id: 'attack', label: 'Attack with fastballs', ev: 0.45 }, { id: 'paint', label: 'Paint the corners', ev: this.swingRate() < 0.6 ? 0.5 : 0.4 }, { id: 'deceive', label: 'Change speeds', ev: this.dts.length && Math.abs(md) > 25 ? 0.55 : 0.42 }] }]
  }
  applyDecision(_r: DecisionReq, id: string): void { this.pmode = id }
  choosePitch(): string {
    const allowed = (this.params.pitches as string[] | undefined) ?? ['fastball', 'changeup', 'curve'], read = Number(this.params.read_strength ?? 0.5), md = this.meanDt()
    if (this.rng.next() < read && this.dts.length >= 2) {
      if (md < -30) { const c = allowed.filter((p) => OFFSPEED.includes(p)); if (c.length) return this.rng.choice(c) }
      else if (md > 30 && allowed.includes('fastball')) return 'fastball'
    }
    if (this.rng.next() < read && this.swingN >= 3 && this.swingRate() < 0.5) { const c = allowed.filter((p) => LOCATION.includes(p)); if (c.length) return this.rng.choice(c) }
    const w = allowed.map((p) => this.pmode === 'attack' ? (p === 'fastball' ? 3 : 0.6) : this.pmode === 'paint' ? (LOCATION.includes(p) ? 2.5 : 0.8) : this.pmode === 'deceive' ? (OFFSPEED.includes(p) ? 2.5 : 0.8) : 1)
    let r = this.rng.next() * w.reduce((a, b) => a + b, 0)
    for (let i = 0; i < allowed.length; i++) { r -= w[i]; if (r <= 0) return allowed[i] }
    return allowed[allowed.length - 1]
  }
  step(_dt: number, nowMs: number): void {
    this.events = []
    if (this.atBatOver) return
    if (!this.pitch) { if (this.nextReleaseMs < 0) this.nextReleaseMs = nowMs + 1500; if (nowMs >= this.nextReleaseMs) this.release(nowMs) }
    else if (nowMs > this.actualArrival + this.param('W_ms', 90) + 60 && !this.swung) { this.swingN++; this.resolvePitch({ result: 'called', quality: 0, dir: 0, dist: 0, dt_ms: null }, false) }
  }
  private release(nowMs: number): void {
    this.pitchNo++
    const sp = (this.start.scenario?.pitches as string[] | undefined) ?? []
    const kind = sp.length ? sp[(this.pitchNo - 1) % sp.length] : this.choosePitch()
    const pd = this.pitchDefs[kind] ?? this.pitchDefs.fastball ?? { travel_ms: 900, brk: 0, height: 0.5 }
    const travel = pd.travel_ms / Math.max(0.5, this.param('speed_mult', 1)), late = pd.late_break ? this.rng.range(-90, 90) : 0
    this.arrivalMs = nowMs + travel; this.actualArrival = this.arrivalMs + late
    this.pitch = { kind, release_ts: Math.round(nowMs), arrival_ts: Math.round(this.arrivalMs), travel_ms: Math.round(travel), height: pd.height, brk: pd.brk, late_break_ms: Math.round(late), no: this.pitchNo, strikes: this.strikes }
    this.swung = false
    this.events.push({ kind: 'pitch', pitch: this.pitch })
  }
  contact(dt: number, W: number, angle: number, height: number, power: number, rot: number): { result: string; quality: number; dir: number; dist: number; dt_ms: number } {
    if (Math.abs(dt) > W) return { result: 'miss', quality: 0, dir: 0, dist: 0, dt_ms: Math.round(dt) }
    const quality = (1 - Math.abs(dt) / W) * (1 - 0.6 * Math.abs(angle - height)), dir = Math.max(-1, Math.min(1, -dt / W + 0.3 * rot)), dist = Math.max(0, Math.min(1, power)) * (0.4 + 0.6 * quality), r = this.rng.next()
    const result = quality < 0.25 ? (r < 0.6 ? 'foul' : 'out') : quality < 0.5 ? (r < 0.55 ? 'out' : 'single') : quality < 0.75 ? (r < 0.5 ? 'single' : r < 0.8 ? 'double' : 'out') : dist > 0.8 ? 'home_run' : 'double'
    return { result, quality: +quality.toFixed(3), dir: +dir.toFixed(3), dist: +dist.toFixed(3), dt_ms: Math.round(dt) }
  }
  onGesture(seat: string, g: Gesture): boolean {
    if (g.kind !== 'swing' || this.atBatOver || seat !== this.seats[0]) return false
    if (!this.pitch || this.swung) { this.events.push({ kind: 'swing', result: 'early', no_pitch: true }); return true }
    this.swung = true
    const dt = g.t_server - this.actualArrival
    const c = this.contact(dt, this.param('W_ms', 90), Number(g.extra?.pitch_angle ?? 0.5), this.pitch.height, g.power, 1)
    this.swingN++; this.swingS++; this.dts.push(dt); if (this.dts.length > 6) this.dts.shift()
    this.resolvePitch(c, true); return true
  }
  private advance(side: Side, n: number): number {
    let runs = 0; const runners = [true, ...side.bases]
    for (let i = runners.length - 1; i >= 0; i--) if (runners[i]) { const dest = i + n; if (dest >= 4) runs++; else runners[dest] = true; if (dest !== i) runners[i] = false }
    side.bases = runners.slice(1, 4); side.runs += runs; return runs
  }
  private resolvePitch(c: { result: string; quality: number; dir: number; dist: number; dt_ms: number | null }, swung: boolean): void {
    const res = c.result, ev: BbEvent = { kind: 'result', pitch_no: this.pitchNo, swung, ...c }
    if (res === 'miss' || res === 'called') { this.strikes++; ev.strikes = this.strikes; if (this.strikes >= 3) { this.atBatResult = { result: 'strikeout', reason: swung ? 'swinging' : 'looking' }; this.human.outs++; this.atBatOver = true } }
    else if (res === 'foul') { if (this.strikes < 2) this.strikes++; ev.strikes = this.strikes }
    else if (res === 'out') { this.atBatResult = { ...c, result: 'out' }; this.human.outs++; this.atBatOver = true }
    else { const runs = this.advance(this.human, { single: 1, double: 2, home_run: 4 }[res] ?? 1); this.human.hits++; this.atBatResult = { ...c, runs }; this.atBatOver = true }
    this.events.push(ev)
    if (!this.atBatOver) this.nextReleaseMs = this.actualArrival + this.pitchGapS * 1000
    this.pitch = null; this.arrivalMs = -1
  }
  inputDone(): boolean { return this.atBatOver }
  noInput(): void { if (!this.atBatOver) { this.atBatResult = { result: 'strikeout', reason: 'no_swing' }; this.human.outs++; this.atBatOver = true } }
  resolve(): TurnResult {
    const r = Object.keys(this.atBatResult).length ? this.atBatResult : { result: 'strikeout' }
    const outcome = String(r.result), hit = ['single', 'double', 'home_run'].includes(outcome)
    const triggers: [string, Record<string, unknown>][] = outcome === 'home_run' ? [['home_run', { player: this.humanLabel() }]] : hit ? [['turn_result', { outcome: outcome.replace('_', ' '), player: this.humanLabel() }]] : [['taunt', { outcome }]]
    let suddenOver = false
    if (this.suddenDeath) { if (!hit) { suddenOver = true; this.house.runs = Math.max(this.house.runs, this.human.runs + 1) } else if (Number(r.runs ?? 0) > 0) suddenOver = true }
    let ticks: Record<string, unknown>[] = []
    if (this.human.outs >= this.outsPerHalf && !suddenOver) { ticks = this.houseHalf(); this.human.outs = 0; this.human.bases = [false, false, false]; this.inning++ }
    const anim = 2.2 + ticks.reduce((a, t) => a + Number(t.anim_s ?? 1.5), 0)
    if (suddenOver) { this.atBatResult.sudden_death_over = true; this.inning = this.innings + 1 }
    return { outcome: hit ? 'hit' : 'out', market_winners: { turn_outcome: [hit ? 'hit' : 'out'] }, detail: { at_bat: r, inning: this.inning, sudden_death_over: suddenOver }, triggers, animation_s: anim, ticks }
  }
  private houseHalf(): Record<string, unknown>[] {
    const ticks: Record<string, unknown>[] = []; this.house.outs = 0; this.house.bases = [false, false, false]
    const sigma = Number(this.params.house_dt_sigma_ms ?? 60); let n = 0
    while (this.house.outs < this.outsPerHalf && n < 12) {
      n++
      const c = this.contact(this.rng.gauss(0, sigma), 90, 0.5, this.rng.range(0.3, 0.7), this.rng.range(0.5, 1), 1)
      let res = c.result, runs = 0
      if (['miss', 'foul', 'out'].includes(res)) { this.house.outs++; res = 'out' } else { runs = this.advance(this.house, { single: 1, double: 2, home_run: 4 }[res] ?? 1); this.house.hits++ }
      ticks.push({ who: 'house', result: res, runs, dir: c.dir, dist: c.dist, house: { ...this.house, bases: [...this.house.bases] }, anim_s: res === 'home_run' ? 2.4 : 1.6 })
    }
    return ticks
  }
  summary(): Record<string, unknown> { return { inning: Math.min(this.inning, this.innings), innings: this.innings, human: { ...this.human, bases: [...this.human.bases] }, house: { ...this.house, bases: [...this.house.bases] }, sudden_death: this.suddenDeath, mean_dt_ms: +this.meanDt().toFixed(1) } }
  stateSummary(): Record<string, unknown> { return { score: this.summary(), pitch: this.pitch, pitch_no: this.pitchNo, arrival_ts: this.arrivalMs, strikes: this.strikes, batter: this.seats[0], at_bat_over: this.atBatOver } }
  winner(): string { if (this.human.runs !== this.house.runs) return this.human.runs > this.house.runs ? 'human' : 'house'; return this.suddenDeath ? 'house' : 'tie' }
}
