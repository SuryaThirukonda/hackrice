import { Rng } from '../../boxing/sim/rng'
import { GolfBot } from './bot'
import { ticks } from './flight'
import { COURSES } from './courses'
import { HOLES, surfaceAt } from './holes'
import { ShotSim } from './shot'
import type { BallView, BotParams, GolfEvent, GolfSnapshot, Hole, HoleScore, Phase, Player, RoundResult, Scorecard, Shot, V2, V3 } from './types'

export const BOT_THINK = ticks(0.5)
export const SETTLE_PAUSE = ticks(1)
export const HOLE_END_PAUSE = ticks(2)
export const PICK_UP_OVER_PAR = 4
export const WIND_MAX = 6

export interface GolfConfig { seed: number; holes?: number[]; botA?: BotParams | null; botB?: BotParams | null; windRange?: { min: number; max: number } }
interface BallState { pos: V3; strokes: number; holed: boolean; done: boolean; onGreen: boolean }
const PLAYERS: readonly Player[] = ['a', 'b']

/** Deterministic two-player golf round: fixed 120 Hz steps, integer-tick timers, one seeded RNG for bots and bounces. */
export class GolfRound {
  readonly seed: number
  readonly rng: Rng
  readonly holeList: number[]
  readonly windRange: { min: number; max: number }
  botA: GolfBot | null
  botB: GolfBot | null
  phase: Phase = 'aim'
  phaseT = 0
  tick = 0
  hole = 0
  holeData: Hole = HOLES[0]
  current: Player = 'a'
  honours: Player = 'a'
  wind: V2 = { x: 0, z: 0 }
  events: GolfEvent[] = []
  balls: Record<Player, BallState>
  shotSim: ShotSim | null = null
  lastShotTrail: V3[] | undefined
  scores: HoleScore[] = []
  private res: RoundResult | null = null

  constructor(cfg: GolfConfig) {
    this.seed = cfg.seed; this.rng = new Rng(cfg.seed)
    this.holeList = cfg.holes ?? COURSES[0].holes // default: the Meadow course
    this.windRange = cfg.windRange ?? { min: 0, max: WIND_MAX }
    this.botA = cfg.botA ? new GolfBot(cfg.botA) : null
    this.botB = cfg.botB ? new GolfBot(cfg.botB) : null
    this.balls = { a: this.newBall(), b: this.newBall() }
    this.startHole(0)
  }

  get over(): boolean { return this.phase === 'round_end' }
  bot(p: Player): GolfBot | null { return p === 'a' ? this.botA : this.botB }
  result(): RoundResult | null { return this.res }
  ball(p: Player): V3 { const s = this.shotSim; return s && p === this.current && !s.done ? { ...s.pos } : { ...this.balls[p].pos } }
  distanceToCup(p: Player): number { const b = this.ball(p), c = this.holeData.cup; return Math.hypot(b.x - c.x, b.z - c.z) }
  private newBall(): BallState { return { pos: { x: 0, y: 0, z: 0 }, strokes: 0, holed: false, done: false, onGreen: false } }

  private startHole(i: number): void {
    this.hole = i; this.holeData = HOLES[this.holeList[i]]
    const tee = this.holeData.tee
    for (const p of PLAYERS) { const b = this.newBall(); b.pos = { x: tee.x, y: 0, z: tee.z }; this.balls[p] = b }
    const wr = new Rng(this.seed + this.holeData.windSeedOffset), s = wr.range(this.windRange.min, this.windRange.max), a = wr.range(0, Math.PI * 2)
    this.wind = { x: s * Math.sin(a), z: s * Math.cos(a) }
    this.events.push({ kind: 'wind', x: this.wind.x, z: this.wind.z })
    this.current = this.honours; this.shotSim = null; this.lastShotTrail = undefined
    this.phase = 'aim'; this.phaseT = 0
  }

  /** Advance one tick. A bot in 'aim' decides after BOT_THINK ticks. */
  step(): void {
    this.events = []; this.tick++
    switch (this.phase) {
      case 'aim': {
        const bot = this.bot(this.current)
        if (bot && ++this.phaseT >= BOT_THINK) this.shoot(bot.decide(this.holeData, this.balls[this.current].pos, this.wind, this.rng))
        break
      }
      case 'flying': case 'rolling': {
        const s = this.shotSim!, p = this.current
        for (const e of s.step()) {
          if (e.kind === 'bounce') this.events.push({ kind: 'bounce', player: p, surface: e.surface, pos: e.pos })
          else if (e.kind === 'in_water' || e.kind === 'out_of_bounds') this.events.push({ kind: e.kind, player: p, pos: e.pos })
        }
        this.phase = s.inFlight ? 'flying' : 'rolling'
        if (s.done) this.finishShot(s)
        break
      }
      case 'settled': if (--this.phaseT <= 0) this.nextTurn(); break
      case 'hole_end': if (--this.phaseT <= 0) this.advanceHole(); break
      default: break
    }
  }

  /** Play the current player's shot. False when not aiming or the shot is not allowed from this lie. */
  shoot(shot: Shot): boolean {
    if (this.phase !== 'aim') return false
    const b = this.balls[this.current], lie = surfaceAt(this.holeData, b.pos)
    if (shot.club === 'putter' && lie === 'bunker') return false
    if (![shot.aimDeg, shot.power, shot.accuracy].every(Number.isFinite)) return false
    b.strokes++
    this.events.push({ kind: 'shot', player: this.current, club: shot.club, power: Math.min(1, Math.max(0, shot.power)) })
    this.shotSim = new ShotSim(this.holeData, b.pos, shot, this.wind, this.rng)
    this.phase = this.shotSim.inFlight ? 'flying' : 'rolling'
    return true
  }

  private finishShot(s: ShotSim): void {
    const p = this.current, b = this.balls[p], par = this.holeData.par
    b.pos = { ...s.pos }; this.lastShotTrail = s.trail
    if (s.outcome === 'water' || s.outcome === 'ob') b.strokes++
    if (s.outcome === 'holed') { b.holed = true; b.done = true; this.events.push({ kind: 'holed', player: p, strokes: b.strokes }) }
    else if (surfaceAt(this.holeData, b.pos) === 'green') { if (!b.onGreen) this.events.push({ kind: 'on_green', player: p }); b.onGreen = true }
    else b.onGreen = false
    if (!b.done && b.strokes >= par + PICK_UP_OVER_PAR) { b.strokes = par + PICK_UP_OVER_PAR; b.done = true; this.events.push({ kind: 'pick_up', player: p, strokes: b.strokes }) }
    this.phase = 'settled'; this.phaseT = SETTLE_PAUSE
  }

  /** Farthest from the cup plays next; ties go to 'a'. */
  private nextTurn(): void {
    const live = PLAYERS.filter((p) => !this.balls[p].done)
    if (live.length === 0) { this.endHole(); return }
    this.current = live.length === 1 ? live[0] : this.distanceToCup('b') > this.distanceToCup('a') ? 'b' : 'a'
    this.shotSim = null; this.phase = 'aim'; this.phaseT = 0
  }

  private endHole(): void {
    const sc: HoleScore = { a: this.balls.a.strokes, b: this.balls.b.strokes }
    this.scores.push(sc)
    if (sc.a !== sc.b) this.honours = sc.a < sc.b ? 'a' : 'b'
    this.events.push({ kind: 'hole_end', hole: this.hole, scores: sc })
    this.phase = 'hole_end'; this.phaseT = HOLE_END_PAUSE
  }

  private advanceHole(): void {
    if (this.hole + 1 < this.holeList.length) { this.startHole(this.hole + 1); return }
    const t = this.scorecard().totals
    const winner: Player | 'draw' = t.a < t.b ? 'a' : t.b < t.a ? 'b' : 'draw'
    this.res = { winner, totals: t }
    this.events.push({ kind: 'round_end', winner, totals: t })
    this.phase = 'round_end'
  }

  /** Completed holes plus the one in progress (live strokes). */
  scorecard(): Scorecard {
    const rows: Scorecard['holes'] = []
    const n = this.phase === 'round_end' ? this.scores.length : Math.min(this.hole + 1, this.holeList.length)
    for (let i = 0; i < n; i++) {
      const par = HOLES[this.holeList[i]].par
      const s = this.scores[i] ?? { a: this.balls.a.strokes, b: this.balls.b.strokes }
      rows.push({ hole: this.holeList[i], par, strokes: { a: s.a, b: s.b }, toPar: { a: s.a - par, b: s.b - par } })
    }
    const totals = { a: 0, b: 0 }, toPar = { a: 0, b: 0 }
    for (const r of rows) for (const p of PLAYERS) { totals[p] += r.strokes[p]; toPar[p] += r.toPar[p] }
    return { holes: rows, totals, toPar }
  }

  private view(p: Player): BallView {
    const b = this.balls[p], s = this.shotSim, active = !!s && p === this.current && !s.done
    return {
      pos: this.ball(p), vel: active ? { ...s!.vel } : { x: 0, y: 0, z: 0 }, inFlight: active && s!.inFlight,
      holed: b.holed, strokes: b.strokes, surface: b.holed ? 'green' : surfaceAt(this.holeData, this.ball(p)),
    }
  }

  snapshot(): GolfSnapshot {
    return {
      phase: this.phase, hole: this.hole, holeData: this.holeData, current: this.current, wind: { ...this.wind },
      balls: { a: this.view('a'), b: this.view('b') }, scorecard: this.scorecard(),
      lastShotTrail: this.shotSim && !this.shotSim.done ? this.shotSim.trail : this.lastShotTrail,
    }
  }
}
