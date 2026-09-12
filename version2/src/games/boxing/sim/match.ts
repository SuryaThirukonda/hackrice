import { BLOCK_HOLD_DRAIN, CANCEL_WINDOW, COUNTDOWN_STEP, COUNT_TICKS, DODGE_COOLDOWN, DODGE_STAMINA, DODGE_TICKS, DT, FRAME, GETUP_COUNT, GETUP_STAMINA, GETUP_TICKS, GUARD_MOVE_MUL, GUARD_RECOVER_STAMINA, HEAD_DUCK, HEAD_SWAY, KD_LIMIT_ROUND, MOVE_BACK, MOVE_FWD, MOVE_STRAFE, PUNCH_CARRY, REGEN_FAST, REGEN_IDLE, REST_S, REST_STAMINA, ROUNDS, ROUND_S, STAMINA_MAX, START_DIST, SWAY_SLIDE, ticks } from './constants'
import { Bot } from './bot'
import { canMove, createFighter, setState } from './fighter'
import { clampRopes, dist, facing, integrate, rightOf, separate } from './physics'
import { resolvePunch, snapDefender, startPunch, type Out } from './punch'
import { Rng } from './rng'
import type { Command, Fighter, FighterView, Flags, MatchConfig, MatchResult, Phase, Side, SimEvent, Snapshot, V2 } from './types'
import { IDLE } from './types'

/** Deterministic boxing match: fixed 120 Hz steps, integer-tick timers, one seeded RNG. */
export class BoxingMatch {
  readonly a: Fighter
  readonly b: Fighter
  readonly rng: Rng
  readonly rounds: number
  readonly roundTicks: number
  readonly restTicks: number
  botA: Bot | null
  botB: Bot | null
  phase: Phase = 'countdown'
  phaseT = 0
  round = 1
  roundTick = 0
  tick = 0
  countN = 0
  countT = 0
  downed: Side | null = null
  dir: V2 = { x: 0, z: 1 }
  events: SimEvent[] = []
  flags: Flags = { hitstop: 0, shake: 0, slowmo: false }
  private result: MatchResult | null = null
  private seed: number

  constructor(cfg: MatchConfig) {
    this.seed = cfg.seed
    this.rng = new Rng(cfg.seed)
    this.rounds = cfg.rounds ?? ROUNDS
    this.roundTicks = ticks(cfg.roundS ?? ROUND_S)
    this.restTicks = ticks(cfg.restS ?? REST_S)
    this.a = createFighter('a', { x: 0, z: -START_DIST / 2 })
    this.b = createFighter('b', { x: 0, z: START_DIST / 2 })
    this.botA = cfg.botA ? new Bot(cfg.botA) : null
    this.botB = cfg.botB ? new Bot(cfg.botB) : null
    this.beginCountdown()
  }

  get seedValue(): number { return this.seed }
  get over(): boolean { return this.phase === 'over' }
  getResult(): MatchResult | null { return this.result }
  fighter(side: Side): Fighter { return side === 'a' ? this.a : this.b }
  distance(): number { return dist(this.a, this.b) }

  private out(): Out { return { events: this.events, flags: this.flags } }

  private resetPositions(): void {
    for (const [f, z] of [[this.a, -START_DIST / 2], [this.b, START_DIST / 2]] as [Fighter, number][]) {
      f.pos.x = 0; f.pos.z = z; f.vMove.x = 0; f.vMove.z = 0; f.vKnock.x = 0; f.vKnock.z = 0
      f.headTarget.x = 0; f.headTarget.y = 0; f.headOffset.x = 0; f.headOffset.y = 0
      f.guard = false; f.resolved = true; f.momentum = 0
      if (f.state !== 'down') setState(f, 'idle', 0)
    }
    this.dir = { x: 0, z: 1 }
  }

  private beginCountdown(): void {
    this.phase = 'countdown'; this.phaseT = COUNTDOWN_STEP * 4 // 3,2,1 then FIGHT
    this.resetPositions()
    for (const f of [this.a, this.b]) { setState(f, 'idle', 0); f.dealtRound = 0; f.kdRound = 0; f.dodgeCd = 0 }
  }

  /** Advance one tick. cmdA is the human (or null to let botA drive); cmdB overrides botB when given. */
  step(cmdA: Command | null = null, cmdB: Command | null = null): void {
    this.events = []; this.flags = { hitstop: 0, shake: 0, slowmo: false }
    this.tick++
    if (this.phase !== 'fighting') { this.stepPhase(); this.physicsOnly(); return }

    const d = this.distance()
    const ca = cmdA ?? (this.botA ? this.botA.decide(this.a, this.b, d, this.tick, this.rng) : IDLE)
    const cb = cmdB ?? (this.botB ? this.botB.decide(this.b, this.a, d, this.tick, this.rng) : IDLE)
    const dirA = this.dir, dirB = { x: -this.dir.x, z: -this.dir.z }
    const hpA = this.a.hp, hpB = this.b.hp
    this.applyCommand(this.a, ca, dirA)
    this.applyCommand(this.b, cb, dirB)
    this.advanceState(this.a); this.advanceState(this.b)
    const sa = snapDefender(this.a), sb = snapDefender(this.b)
    this.tryResolve(this.a, this.b, sb, dirA)
    this.tryResolve(this.b, this.a, sa, dirB)
    integrate(this.a); integrate(this.b)
    separate(this.a, this.b, this.dir); clampRopes(this.a); clampRopes(this.b); separate(this.a, this.b, this.dir)
    this.dir = facing(this.a, this.b, this.dir)
    this.stamina(this.a); this.stamina(this.b)
    if (this.checkKnockdowns(hpA, hpB)) return
    this.roundTick++
    if (this.roundTick >= this.roundTicks) this.endRound()
  }

  private physicsOnly(): void {
    for (const f of [this.a, this.b]) { f.vMove.x = 0; f.vMove.z = 0; integrate(f) }
    separate(this.a, this.b, this.dir); clampRopes(this.a); clampRopes(this.b)
    this.dir = facing(this.a, this.b, this.dir)
  }

  private applyCommand(f: Fighter, c: Command, dir: V2): void {
    if (f.dodgeCd > 0) f.dodgeCd--
    const right = rightOf(dir)
    const free = f.state === 'idle' || (f.state === 'recover' && f.stateT <= CANCEL_WINDOW)
    if (free && c.punch) {
      startPunch(f, c.punch, dir, this.out(), c.punchPower)
    } else if (free && c.dodge && f.dodgeCd === 0 && f.stamina >= DODGE_STAMINA) {
      f.stamina -= DODGE_STAMINA; f.dodgeKind = c.dodge; f.dodgeCd = DODGE_COOLDOWN; f.guard = false; f.resolved = true
      setState(f, 'dodge', DODGE_TICKS)
      const s = c.dodge === 'swayL' ? -1 : c.dodge === 'swayR' ? 1 : 0
      f.headTarget.x = s * HEAD_SWAY; f.headTarget.y = c.dodge === 'duck' ? -HEAD_DUCK : 0
      f.vMove.x = right.x * s * SWAY_SLIDE; f.vMove.z = right.z * s * SWAY_SLIDE
      this.events.push({ kind: 'dodge', who: f.id, dodge: c.dodge })
    }
    if (f.state === 'idle' || f.state === 'recover') f.guard = c.block && !f.guardBroken
    else if (f.state !== 'dodge') f.guard = false
    if (canMove(f)) {
      const fwd = c.forward > 0 ? MOVE_FWD : c.forward < 0 ? -MOVE_BACK : 0
      const mul = f.guard ? GUARD_MOVE_MUL : 1
      f.vMove.x = (dir.x * fwd + right.x * MOVE_STRAFE * c.strafe) * mul
      f.vMove.z = (dir.z * fwd + right.z * MOVE_STRAFE * c.strafe) * mul
    } else if (f.state === 'windup' || f.state === 'active') {
      const v = MOVE_FWD * f.momentum * PUNCH_CARRY
      f.vMove.x = dir.x * v; f.vMove.z = dir.z * v
    } else if (f.state !== 'dodge') { f.vMove.x = 0; f.vMove.z = 0 }
  }

  private advanceState(f: Fighter): void {
    if (f.fresh) { f.fresh = false; if (f.stateT > 0) return }
    if (f.stateT > 0) f.stateT--
    if (f.stateT > 0) {
      if (f.state === 'dodge' && f.stateTotal - f.stateT >= 22) { f.headTarget.x = 0; f.headTarget.y = 0; f.vMove.x = 0; f.vMove.z = 0 }
      return
    }
    switch (f.state) {
      case 'windup': setState(f, 'active', FRAME[f.punch].active); break
      case 'active':
        if (!f.resolved) { f.resolved = true; this.events.push({ kind: 'punch', who: f.id, punch: f.punch, result: 'whiff', dmg: 0, momentum: f.momentum }) }
        setState(f, 'recover', FRAME[f.punch].recover); break
      case 'recover': case 'hitstun': case 'stagger': case 'getup': setState(f, 'idle', 0); break
      case 'dodge': f.headTarget.x = 0; f.headTarget.y = 0; setState(f, 'idle', 0); break
      default: break
    }
  }

  private tryResolve(att: Fighter, def: Fighter, snap: ReturnType<typeof snapDefender>, dir: V2): void {
    if (att.state !== 'active' || att.resolved) return
    if (this.distance() > FRAME[att.punch].reach) return
    resolvePunch(att, def, snap, dir, this.out())
  }

  private stamina(f: Fighter): void {
    if (f.guard) f.stamina = Math.max(1, f.stamina - BLOCK_HOLD_DRAIN * DT)
    else if (f.state === 'idle') f.stamina = Math.min(STAMINA_MAX, f.stamina + (f.moving > MOVE_FWD * 0.5 ? REGEN_FAST : REGEN_IDLE) * DT)
    if (f.guardBroken && f.stamina >= GUARD_RECOVER_STAMINA) f.guardBroken = false
  }

  /** A knockdown happens only when damage taken this tick crosses a mark (or reaches zero). */
  private checkKnockdowns(hpA: number, hpB: number): boolean {
    for (const [f, prev] of [[this.a, hpA], [this.b, hpB]] as [Fighter, number][]) {
      let fell = false
      while (f.marks.length && prev > f.marks[0] && f.hp <= f.marks[0]) { f.marks.shift(); fell = true }
      if (prev > 0 && f.hp <= 0) fell = true
      if (!fell) continue
      f.kdRound++; f.kdTotal++
      const ko = f.hp <= 0 || f.kdRound >= KD_LIMIT_ROUND
      setState(f, 'down', ticks(11)); f.guard = false; f.resolved = true; f.vKnock.x = 0; f.vKnock.z = 0; f.vMove.x = 0; f.vMove.z = 0
      f.headTarget.x = 0; f.headTarget.y = 0
      const o = f.id === 'a' ? this.b : this.a
      if (o.state === 'windup' || o.state === 'active') { o.resolved = true; setState(o, 'idle', 0) }
      this.downed = f.id; this.countN = 0; this.countT = 0
      this.phase = 'count'; this.flags.slowmo = true
      this.events.push({ kind: 'knockdown', who: f.id, ko })
      if (ko) this.result = { winner: o.id, by: 'ko', round: this.round }
      return true
    }
    return false
  }

  private endRound(): void {
    this.events.push({ kind: 'bell', round: this.round, end: true })
    for (const f of [this.a, this.b]) { f.guard = false; f.vMove.x = 0; f.vMove.z = 0 }
    if (this.round >= this.rounds) {
      this.phase = 'decision'; this.phaseT = ticks(0.5)
    } else { this.phase = 'rest'; this.phaseT = this.restTicks }
  }

  private stepPhase(): void {
    switch (this.phase) {
      case 'countdown': {
        this.phaseT--
        if (this.phaseT % COUNTDOWN_STEP === 0) {
          const n = this.phaseT / COUNTDOWN_STEP
          if (n >= 1 && n <= 3) this.events.push({ kind: 'countdown', n: n as 3 | 2 | 1 })
          else if (n === 0) {
            this.events.push({ kind: 'countdown', n: 0 }, { kind: 'bell', round: this.round, end: false })
            this.phase = 'fighting'; this.roundTick = 0
          }
        }
        break
      }
      case 'count': {
        const f = this.fighter(this.downed!), o = f.id === 'a' ? this.b : this.a
        this.countT++
        if (f.stateT > 0) f.stateT-- // the fall animates from state progress
        if (this.countT % COUNT_TICKS === 0) {
          this.countN++
          this.events.push({ kind: 'count', who: f.id, n: this.countN })
          const ko = this.result?.by === 'ko'
          if (this.countN >= 10 || (ko && this.countN >= 10)) {
            if (!this.result) this.result = { winner: o.id, by: 'ko', round: this.round }
            this.events.push({ kind: 'ko', who: f.id }); this.phase = 'over'
          } else if (!ko && this.countN >= GETUP_COUNT) {
            setState(f, 'getup', GETUP_TICKS); f.stamina = Math.max(f.stamina, GETUP_STAMINA)
            this.events.push({ kind: 'getup', who: f.id })
            this.resetPositions(); setState(f, 'getup', GETUP_TICKS)
            this.phase = 'fighting'; this.downed = null
          }
        }
        break
      }
      case 'rest':
        this.phaseT--
        if (this.phaseT <= 0) {
          for (const f of [this.a, this.b]) f.stamina = Math.min(STAMINA_MAX, f.stamina + REST_STAMINA)
          this.round++; this.beginCountdown()
        }
        break
      case 'decision':
        this.phaseT--
        if (this.phaseT <= 0) {
          const w: Side | 'draw' = this.a.dealtTotal > this.b.dealtTotal ? 'a' : this.b.dealtTotal > this.a.dealtTotal ? 'b' : 'draw'
          this.result = { winner: w, by: w === 'draw' ? 'draw' : 'decision', round: this.round }
          this.events.push({ kind: 'decision', winner: w }); this.phase = 'over'
        }
        break
      default: break
    }
  }

  private view(f: Fighter): FighterView {
    return {
      pos: { x: f.pos.x, z: f.pos.z }, head: { x: f.headOffset.x, y: f.headOffset.y }, state: f.state,
      progress: f.stateTotal > 0 ? 1 - f.stateT / f.stateTotal : 1, punch: f.punch, dodge: f.dodgeKind,
      hp: f.hp, stamina: f.stamina, guard: f.guard, kd: f.kdRound, moving: f.moving, momentum: f.momentum,
    }
  }

  snapshot(): Snapshot {
    return {
      tick: this.tick, phase: this.phase, round: this.round, clock: Math.max(0, (this.roundTicks - this.roundTick) * DT), count: this.countN,
      dir: { ...this.dir }, dist: this.distance(), a: this.view(this.a), b: this.view(this.b),
    }
  }
}
