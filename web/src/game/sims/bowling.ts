// Bowling: lane path from (lane, speed, spin), pin-fall table for full racks, geometry for partial racks, ten-pin scoring.
// Port of backend/app/games/bowling.py. Lane units: x in [-1, 1] between the gutters, d in [0, 1] foul line to pin deck.
import { Rng } from './rng'
import type { DecisionReq, Gesture, Sim, StartPayload, TurnPlan, TurnResult } from './types'

const S = 0.289
export const PIN_X: Record<number, number> = { 1: 0, 2: -S, 3: S, 4: -2 * S, 5: 0, 6: 2 * S, 7: -3 * S, 8: -S, 9: S, 10: 3 * S }
export const PIN_ROW: Record<number, number> = { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3 }
const BEHIND: Record<number, number[]> = { 1: [2, 3], 2: [4, 5], 3: [5, 6], 4: [7, 8], 5: [8, 9], 6: [9, 10], 7: [], 8: [], 9: [], 10: [] }
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const BALL_R = 0.21

export interface Frame { n: number; rolls: number[]; standing: number[]; paths: [number, number][][]; outcome: string }
export interface RollTick { who: string; frame: number; ball: number; path: [number, number][]; pins_before: number[]; knocked: number[]; pins_after: number[]; outcome: string; speed?: number; spin?: number; lane?: number; lane_drift: number; rerack?: boolean; anim_s: number; flags: Record<string, boolean> }

export function scoreFrames(frames: { rolls: number[] }[], nFrames: number): { total: number; per: (number | null)[] } {
  const rolls: number[] = []; for (const f of frames) rolls.push(...f.rolls)
  let total = 0, i = 0; const per: (number | null)[] = []
  for (let fi = 0; fi < nFrames; fi++) {
    if (i >= rolls.length) { per.push(null); continue }
    const last = fi === nFrames - 1
    if (rolls[i] === 10 && !last) { if (i + 2 < rolls.length) { total += 10 + rolls[i + 1] + rolls[i + 2]; per.push(total) } else per.push(null); i += 1 }
    else if (i + 1 < rolls.length && rolls[i] + rolls[i + 1] === 10 && !last) { if (i + 2 < rolls.length) { total += 10 + rolls[i + 2]; per.push(total) } else per.push(null); i += 2 }
    else if (last) { for (let k = i; k < Math.min(i + 3, rolls.length); k++) total += rolls[k]; per.push(total); i = rolls.length }
    else { if (i + 1 < rolls.length) { total += rolls[i] + rolls[i + 1]; per.push(total) } else per.push(null); i += 2 }
  }
  return { total, per }
}
export function frameComplete(f: Frame, last: boolean): boolean {
  if (!last) return (f.rolls.length >= 1 && f.rolls[0] === 10) || f.rolls.length >= 2
  if (f.rolls.length >= 3) return true
  if (f.rolls.length === 2) return !(f.rolls[0] === 10 || f.rolls[0] + f.rolls[1] === 10)
  return false
}

export class BowlingSim implements Sim {
  readonly sport = 'bowling'
  rng = new Rng(1)
  start!: StartPayload
  params: Record<string, unknown> = {}
  adjustments: Record<string, number> = {}
  nFrames = 5; kHook = 0.8; gutter = 0.92; pocket = 0.29; rollS = 2.5; inputWindowS = 20
  laneDrift = 0; extraFrames = 0
  frames: Record<string, Frame[]> = {}
  seats: string[] = []
  cur: Frame | null = null
  curSeat = ''
  ticks: RollTick[] = []
  houseOption = 'pocket'
  reracked = false
  private plan: TurnPlan | null = null
  turnNo = 0
  isPinKing = false

  setup(start: StartPayload): void {
    this.start = start; this.rng = new Rng(start.seed); this.params = { ...start.tier.params }
    const g = (start.game.bowling ?? {}) as Record<string, number>
    this.nFrames = g.quick_frames ?? 5; this.kHook = g.k_hook ?? 0.8; this.gutter = g.gutter ?? 0.92; this.pocket = g.pocket ?? 0.28; this.rollS = g.roll_animation_s ?? 2.5; this.inputWindowS = g.input_window_s ?? 20
    this.seats = start.seats.map((s) => s.seat_id)
    for (const s of this.seats) this.frames[s] = []
    if (start.mode !== '2p') this.frames.house = []
    this.isPinKing = start.tier.twist === 'pin_king'
    for (const [k, v] of Object.entries(start.adjustments ?? {})) this.adjust(k, v, 'adaptive')
  }
  param(n: string, d: number): number { return Number(this.params[n] ?? d) + (this.adjustments[n] ?? 0) }
  adjust(name: string, delta: number, reason: string): void { this.adjustments[name] = reason === 'adaptive' ? delta : (this.adjustments[name] ?? 0) + delta; if (name === 'lane_drift') this.laneDrift += delta }
  grant(what: string): void { if (what === 'extra_frame') this.extraFrames++ }
  name(seat: string): string { return seat === 'house' ? this.start.tier.name : (this.start.players[seat] ?? 'Player') }
  private totalFrames(): number { return this.nFrames + this.extraFrames }

  planTurn(): TurnPlan | null {
    const first = this.seats[0]
    // 2P: players alternate frames; the turn order is P-A frame n, P-B frame n
    let seat = first
    if (this.start.mode === '2p' && this.seats.length >= 2) {
      const [a, b] = this.seats
      seat = this.frames[a].length > this.frames[b].length ? b : a
    }
    if (this.frames[seat].length >= this.totalFrames()) return null
    const n = this.frames[seat].length + 1
    this.curSeat = seat
    this.cur = { n, rolls: [], standing: [...ALL], paths: [], outcome: '' }
    this.ticks = []; this.reracked = false
    if (this.isPinKing) this.laneDrift = this.rng.range(-0.3, 0.3)
    const label = `Frame ${n}${this.start.mode === '2p' ? ` · ${this.name(seat)}` : ''}`
    this.plan = { label, input_seats: [seat], input_window_s: this.inputWindowS, betting: true,
      markets: [{ kind: 'turn_outcome', label: `${label}: ${this.name(seat)} rolls`, outcomes: [['strike', 'Strike'], ['spare', 'Spare'], ['open', 'Open frame']] }],
      prompt: { ball: 1, standing: this.cur.standing, frame: n, seat, lane_drift: this.laneDrift } }
    return this.plan
  }
  currentPlan(): TurnPlan | null { return this.plan }
  isLast(): boolean { return !!this.cur && this.cur.n >= this.totalFrames() }

  ballPath(lane: number, speed: number, spin: number, hand: number, n = 12): [number, number][] {
    const sn = Math.max(-1, Math.min(1, spin / 400)); const pts: [number, number][] = []
    for (let i = 0; i <= n; i++) { const d = i / n; pts.push([+d.toFixed(2), +(lane + this.laneDrift * d - hand * this.kHook * sn * (1 - 0.5 * speed) * d * d).toFixed(3)]) }
    return pts
  }
  private sample(arr: number[], n: number): number[] { const pool = [...arr], out: number[] = []; for (let i = 0; i < Math.min(n, pool.length); i++) { const k = this.rng.int(0, pool.length - 1); out.push(pool[k]); pool.splice(k, 1) } return out }
  private minus(a: number[], b: number[]): number[] { return a.filter((v) => !b.includes(v)) }
  firstBall(xE: number, speed: number, hand: number): number[] {
    const err = Math.abs(xE - hand * this.pocket), r = this.rng
    if (Math.abs(xE) < 0.05) { if (r.next() < 0.2) return [...ALL]; if (r.next() < 0.35) return this.minus(ALL, r.choice([[7, 10], [4, 6], [7, 9], [4, 10]])); return this.minus(ALL, this.sample([2, 3, 4, 6, 7, 10], r.choice([2, 3]))) }
    if (err < 0.06) { if (r.next() < 0.8 + 0.1 * speed) return [...ALL]; return this.minus(ALL, r.choice([[hand > 0 ? 10 : 7], [hand > 0 ? 7 : 10], hand > 0 ? [3, 6] : [2, 4]])) }
    if (err < 0.15) { if (r.next() < 0.4) return [...ALL]; return this.minus(ALL, this.sample([7, 8, 9, 10, 4, 6], r.choice([2, 3, 4]))) }
    if (err < 0.3) { if (r.next() < 0.1) return [...ALL]; if (r.next() < 0.25) return this.minus(ALL, r.choice([[7, 10], [4, 6], [2, 7], [3, 10], [4, 7, 10]])); return this.sample(ALL, r.choice([4, 5, 6, 7])) }
    const side = xE > 0 ? 1 : -1, near = ALL.filter((p) => PIN_X[p] * side > 0.1)
    return this.sample(near, Math.min(near.length, r.choice([1, 2, 3, 4])))
  }
  partialRack(xE: number, speed: number, standing: number[]): number[] {
    const knocked: number[] = []
    for (const p of [...standing].sort((a, b) => PIN_ROW[a] - PIN_ROW[b])) { const pHit = Math.max(0, Math.min(0.95, 1 - Math.abs(xE - PIN_X[p]) / (BALL_R + 0.08))) * (0.75 + 0.25 * speed); if (this.rng.next() < pHit) knocked.push(p) }
    let changed = true
    while (changed) { changed = false; for (const p of [...knocked]) for (const q of BEHIND[p]) if (standing.includes(q) && !knocked.includes(q) && this.rng.next() < 0.55) { knocked.push(q); changed = true } }
    return knocked
  }
  roll(f: Frame, lane: number, speed: number, spin: number, hand: number, who: string): number[] {
    const path = this.ballPath(lane, speed, spin, hand), xE = path[path.length - 1][1], before = [...f.standing]
    const isGutter = path.some(([, x]) => Math.abs(x) > this.gutter)
    const knocked = isGutter ? [] : before.length === 10 ? this.firstBall(xE, speed, hand) : this.partialRack(xE, speed, before)
    f.rolls.push(knocked.length); f.standing = this.minus(before, knocked); if (!f.standing.length) f.standing = [...ALL]; f.paths.push(path)
    const outcome = knocked.length === 10 && f.rolls.length === 1 ? 'strike' : f.rolls.length === 2 && f.rolls[0] < 10 && f.rolls[0] + f.rolls[1] === 10 ? 'spare' : isGutter ? 'gutter' : 'hit'
    this.ticks.push({ who, frame: f.n, ball: f.rolls.length, path, pins_before: before, knocked, pins_after: knocked.length === before.length ? [] : f.standing, outcome, speed: +speed.toFixed(2), spin: +spin.toFixed(1), lane: +lane.toFixed(3), lane_drift: +this.laneDrift.toFixed(3), flags: { shake: outcome === 'strike', hitstop: knocked.length >= 6, gutter: isGutter }, anim_s: this.rollS })
    return knocked
  }

  onGesture(seat: string, g: Gesture): boolean {
    if (!this.cur || seat !== this.curSeat || g.kind !== 'release') return false
    const ex = g.extra ?? {}
    const spin = Number(ex.spin_dps ?? 0), hand = spin >= 0 ? 1 : -1
    this.roll(this.cur, Number(ex.lane ?? 0), Number(ex.speed ?? g.power), spin, hand, seat)
    if (this.isPinKing && this.cur.n === 3 && this.cur.rolls.length === 1 && !this.reracked && this.cur.standing.length !== 10) {
      this.reracked = true; this.cur.standing = [7, 10]
      this.ticks.push({ who: 'house', frame: this.cur.n, ball: 0, path: [], pins_before: [], knocked: [], pins_after: [7, 10], outcome: 'rerack', rerack: true, lane_drift: this.laneDrift, flags: { shake: true }, anim_s: 1.2 })
    }
    return true
  }
  nextPrompt(): Record<string, unknown> { return this.cur ? { ball: this.cur.rolls.length + 1, standing: this.cur.standing, frame: this.cur.n, seat: this.curSeat, lane_drift: this.laneDrift } : {} }
  step(): void {}
  inputDone(): boolean { return !!this.cur && frameComplete(this.cur, this.isLast()) }
  noInput(): void { if (!this.cur) return; while (!frameComplete(this.cur, this.isLast())) { this.cur.rolls.push(0); this.cur.paths.push([[0, 0], [1, 0]]); this.ticks.push({ who: this.curSeat, frame: this.cur.n, ball: this.cur.rolls.length, path: [[0, 0], [1, 0]], pins_before: this.cur.standing, knocked: [], pins_after: this.cur.standing, outcome: 'no_swing', lane_drift: this.laneDrift, flags: {}, anim_s: 0.8 }) } }

  decisionsBefore(phase: 'input' | 'resolving'): DecisionReq[] {
    if (phase !== 'resolving' || this.start.mode === '2p') return []
    const behind = this.score('house') < this.score(this.seats[0])
    return [{ agent_id: `house:bowling:${this.start.tier.id}`, default: 'pocket', context: { frame: this.cur?.n, human_score: this.score(this.seats[0]), house_score: this.score('house') },
      options: [{ id: 'pocket', label: 'Play the pocket', ev: 0.55 }, { id: 'straight', label: 'Roll it straight', ev: 0.45 }, { id: 'hook_hard', label: 'Big hook', ev: behind ? 0.5 : 0.35 }] }]
  }
  applyDecision(_req: DecisionReq, optionId: string): void { this.houseOption = optionId }
  private houseRoll(standing: number[]): { lane: number; speed: number; spin: number } {
    let speedMean = this.param('speed_mean', 0.6), spinMean = this.param('spin_mean', 150), laneSigma = this.param('lane_sigma', 0.3)
    const speedSigma = Number(this.params.speed_sigma ?? 0.1); let spinSigma = Number(this.params.spin_sigma ?? 60)
    if (this.houseOption === 'straight') { spinMean *= 0.3; spinSigma *= 0.6; laneSigma *= 0.8; speedMean = Math.min(1, speedMean + 0.05) }
    if (this.houseOption === 'hook_hard') { spinMean = spinMean * 1.5 + 60; spinSigma *= 1.3; laneSigma *= 1.4 }
    let target = 0.29, spin: number
    if (standing.length < 10) { target = standing.reduce((a, p) => a + PIN_X[p], 0) / standing.length; spin = this.rng.gauss(spinMean * 0.4, spinSigma * 0.5) } else spin = this.rng.gauss(spinMean, spinSigma)
    const speed = Math.max(0.05, Math.min(1, this.rng.gauss(speedMean, speedSigma)))
    const hook = 0.8 * Math.max(-1, Math.min(1, spin / 400)) * (1 - 0.5 * speed)
    const comp = this.isPinKing ? this.laneDrift : this.laneDrift * 0.5
    return { lane: Math.max(-0.9, Math.min(0.9, this.rng.gauss(target + hook - comp, laneSigma))), speed, spin }
  }
  resolve(): TurnResult {
    const f = this.cur!
    f.outcome = f.rolls[0] === 10 ? 'strike' : f.rolls.length >= 2 && f.rolls[0] + f.rolls[1] === 10 ? 'spare' : 'open'
    this.frames[this.curSeat].push(f)
    const detail: Record<string, unknown> = { human_frame: { rolls: f.rolls, outcome: f.outcome }, seat: this.curSeat }
    if (this.frames.house && (this.start.mode !== '2p')) {
      const hf: Frame = { n: f.n, rolls: [], standing: [...ALL], paths: [], outcome: '' }
      while (!frameComplete(hf, hf.n >= this.totalFrames())) { const rp = this.houseRoll(hf.standing.length < 10 || hf.rolls.length ? hf.standing : ALL); this.roll(hf, rp.lane, rp.speed, rp.spin, 1, 'house') }
      hf.outcome = hf.rolls[0] === 10 ? 'strike' : hf.rolls.length >= 2 && hf.rolls[0] + hf.rolls[1] === 10 ? 'spare' : 'open'
      this.frames.house.push(hf)
      detail.house_frame = { rolls: hf.rolls, outcome: hf.outcome, option: this.houseOption }
    }
    const who = this.name(this.curSeat)
    const triggers: [string, Record<string, unknown>][] = f.outcome === 'strike' ? [['strike', { player: who }]] : f.outcome === 'spare' ? [['turn_result', { outcome: 'Spare', player: who }]] : [['taunt', { outcome: f.outcome }]]
    const anim = 0.6 + this.ticks.reduce((a, t) => a + t.anim_s, 0)
    const ticks = [...this.ticks]; this.cur = null
    return { outcome: f.outcome, market_winners: { turn_outcome: [f.outcome] }, detail, triggers, animation_s: anim, ticks: ticks as unknown as Record<string, unknown>[] }
  }
  score(who: string): number { return this.frames[who] ? scoreFrames(this.frames[who], this.totalFrames()).total : 0 }
  summary(): Record<string, unknown> {
    const out: Record<string, unknown> = { n_frames: this.totalFrames(), lane_drift: +this.laneDrift.toFixed(3) }
    for (const who of Object.keys(this.frames)) { const sc = scoreFrames(this.frames[who], this.totalFrames()); out[who === 'house' ? 'house' : this.start.mode !== '2p' ? 'human' : who] = { total: sc.total, frames: this.frames[who].map((f) => f.rolls), per: sc.per, name: this.name(who) } }
    return out
  }
  stateSummary(): Record<string, unknown> { return { score: this.summary(), frame: this.cur?.n, standing: this.cur?.standing } }
  winner(): string {
    if (this.start.mode === '2p' && this.seats.length >= 2) { const [a, b] = this.seats, sa = this.score(a), sb = this.score(b); return sa > sb ? a : sb > sa ? b : 'tie' }
    const h = this.score(this.seats[0]), x = this.score('house'); return h > x ? 'human' : x > h ? 'house' : 'tie'
  }
}
