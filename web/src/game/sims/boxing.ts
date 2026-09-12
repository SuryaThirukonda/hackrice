// Real-time boxing on a line inside the ring. Both fighters share the same physics: positions and facing, reach,
// windup / active / recover frame data, guard with chip damage, parry windows, dodge i-frames, knockback and stagger,
// stamina fatigue, knockdowns with a count, three 60 s rounds. 1P: seat vs the House AI. 2P: two humans. Card: two AIs.
import { Rng } from './rng'
import type { DecisionReq, Gesture, Sim, StartPayload, TurnPlan, TurnResult } from './types'
import { BoxerAI } from './boxerAi'
import { RhythmLearner } from './rhythm'

export interface FrameData { windup: number; active: number; recover: number; reach: number; dmg: number; stamina: number; knock: number }
export const JAB: FrameData = { windup: 0.12, active: 0.08, recover: 0.24, reach: 0.34, dmg: 8, stamina: 8, knock: 0.1 }
export const HOOK: FrameData = { windup: 0.22, active: 0.1, recover: 0.34, reach: 0.42, dmg: 14, stamina: 14, knock: 0.18 }
export const UPPER: FrameData = { windup: 0.3, active: 0.1, recover: 0.4, reach: 0.3, dmg: 18, stamina: 18, knock: 0.22 }
export const FD: Record<string, FrameData> = { jab: JAB, hook: HOOK, uppercut: UPPER }
export const MOVE_SPEED = 0.9
export const RING_HALF = 1.0
export const BODY_GAP = 0.24
export const PARRY_WINDOW = 0.16
export const PARRY_STUN = 0.9
export const DODGE_TIME = 0.28
export const DODGE_COOLDOWN = 0.7
export type FighterState = 'idle' | 'windup' | 'active' | 'recover' | 'block' | 'parry' | 'dodge' | 'stagger' | 'stunned' | 'down' | 'victory'

export interface SimEvent { kind: string; who?: string; type?: string; result?: string; dmg?: number; ms?: number; ko?: boolean; dir?: number; x?: number; count?: number }

export class Fighter {
  id = ''; name = ''; seat = ''
  x = 0; facing: 1 | -1 = 1; vx = 0
  hp = 100; stamina = 100
  guard = false; wantsGuard = false
  state: FighterState = 'idle'; stateT = 0
  punch = 'jab'; power = 0.7; landedThis = false
  dodgeCd = 0; openT = 0; parryBonus = 0
  knockdowns = 0; marks = [50, 0]; downCount = 0
  thrown = 0; landed = 0; blocked = 0; dealtRound = 0; dealtTotal = 0
  moveDir = 0
  ai: BoxerAI | null = null
  color = 0x2ba1e8
  public() {
    return { id: this.id, name: this.name, x: +this.x.toFixed(3), facing: this.facing, hp: +Math.max(0, this.hp).toFixed(1), stamina: +this.stamina.toFixed(1), guard: this.guard, state: this.state, state_t: +this.stateT.toFixed(2), punch: this.punch, knockdowns: this.knockdowns, thrown: this.thrown, landed: this.landed, dealt_round: +this.dealtRound.toFixed(1) }
  }
}

export class BoxingSim implements Sim {
  readonly sport = 'boxing'
  rng = new Rng(1)
  a = new Fighter(); b = new Fighter()
  start!: StartPayload
  params: Record<string, unknown> = {}
  adjustments: Record<string, number> = {}
  mode: '1p' | '2p' | 'card' = '1p'
  rounds = 3; roundS = 60; restS = 4; downS = 3
  roundNo = 0; clock = 0; roundOver = false; ko = ''
  roundWinners: string[] = []
  events: SimEvent[] = []
  flags: Record<string, boolean> = {}
  learner: RhythmLearner | null = null
  private plan: TurnPlan | null = null
  turnNo = 0

  setup(start: StartPayload): void {
    this.start = start
    this.rng = new Rng(start.seed)
    this.params = { ...start.tier.params }
    this.mode = start.mode
    const g = (start.game.boxing ?? {}) as Record<string, number>
    this.rounds = g.rounds ?? 3; this.roundS = g.round_s ?? 60; this.restS = g.rest_s ?? 4; this.downS = g.down_s ?? 3
    const seats = start.seats.map((s) => s.seat_id)
    this.a.x = -0.45; this.b.x = 0.45; this.a.facing = 1; this.b.facing = -1
    this.a.color = 0x2ba1e8; this.b.color = 0xee6a5f
    if (start.card && start.tier_b) {
      this.a.id = 'a'; this.a.name = start.tier.name; this.a.ai = new BoxerAI(start.tier.params, this.rng)
      this.b.id = 'b'; this.b.name = start.tier_b.name; this.b.ai = new BoxerAI(start.tier_b.params, this.rng)
    } else if (start.mode === '2p' && seats.length >= 2) {
      this.a.id = seats[0]; this.a.seat = seats[0]; this.a.name = start.players[seats[0]] ?? 'Player A'
      this.b.id = seats[1]; this.b.seat = seats[1]; this.b.name = start.players[seats[1]] ?? 'Player B'
    } else {
      this.a.id = 'human'; this.a.seat = seats[0] ?? 'P1'; this.a.name = Object.values(start.players).join(', ') || 'Player'
      this.b.id = 'house'; this.b.name = start.tier.name; this.b.ai = new BoxerAI(start.tier.params, this.rng)
      if (start.tier.params.rhythm_learner) this.learner = new RhythmLearner()
    }
    for (const [k, v] of Object.entries(start.adjustments ?? {})) this.adjust(k, v, 'adaptive')
  }

  param(name: string, d: number): number { return Number(this.params[name] ?? d) + (this.adjustments[name] ?? 0) }
  adjust(name: string, delta: number, reason: string): void {
    this.adjustments[name] = reason === 'adaptive' ? delta : (this.adjustments[name] ?? 0) + delta
    if (this.b.ai) this.b.ai.adjust[name] = this.adjustments[name]
  }
  grant(what: string): void { if (what === 'second_wind') { this.a.stamina = 100; this.a.hp = Math.min(100, this.a.hp + 15); this.events.push({ kind: 'second_wind', who: this.a.id }) } }

  // ---- turns = rounds --------------------------------------------------------------------------
  planTurn(): TurnPlan | null {
    if (this.ko || this.roundNo >= this.rounds) return null
    this.roundNo++
    this.clock = 0; this.roundOver = false
    for (const f of [this.a, this.b]) { f.dealtRound = 0; if (f.state === 'down' || f.state === 'victory') f.state = 'idle'; f.stamina = Math.min(100, f.stamina + 30); f.stateT = 0; f.moveDir = 0; f.wantsGuard = false; f.guard = false }
    this.a.x = -0.45; this.b.x = 0.45
    const label = `Round ${this.roundNo}`
    this.plan = { label, input_seats: this.start.seats.map((s) => s.seat_id), input_window_s: this.roundS, betting: true, live: true,
      markets: [{ kind: 'round_winner', label: `${label} winner`, outcomes: [[this.a.id, this.a.name], [this.b.id, this.b.name]] }],
      prompt: { round: this.roundNo, rounds: this.rounds } }
    return this.plan
  }
  currentPlan(): TurnPlan | null { return this.plan }

  decisionsBefore(phase: 'input' | 'resolving'): DecisionReq[] {
    if (phase !== 'input') return []
    const reqs: DecisionReq[] = []
    for (const f of [this.a, this.b]) {
      if (!f.ai) continue
      const other = f === this.a ? this.b : this.a
      const tier = f === this.b && this.start.card && this.start.tier_b ? this.start.tier_b.id : this.start.tier.id
      reqs.push({ agent_id: `house:boxing:${tier}:${f.id}`, default: f.hp < other.hp ? 'press' : 'counter', context: { round: this.roundNo, my_hp: f.hp, their_hp: other.hp, my_stamina: f.stamina },
        options: [
          { id: 'press', label: 'Press forward', ev: f.hp < other.hp ? 0.55 : 0.45, params: { aggression: 1.3, block_p: 0.8 } },
          { id: 'counter', label: 'Wait and counter', ev: 0.5, params: { aggression: 0.6, block_p: 1.6, dodge_p: 1.4 } },
          { id: 'wild', label: 'Go wild with hooks', ev: f.hp < other.hp ? 0.5 : 0.4, params: { aggression: 1.5, block_p: 0.5, hook_bias: 0.6 } },
        ] })
    }
    return reqs
  }
  applyDecision(req: DecisionReq, optionId: string): void {
    const f = req.agent_id.endsWith(':' + this.a.id) ? this.a : this.b
    const opt = req.options.find((o) => o.id === optionId)
    if (f.ai && opt) f.ai.setMods((opt.params ?? {}) as Record<string, number>)
  }

  fighterForSeat(seat: string): Fighter | null {
    if (this.a.seat === seat) return this.a
    if (this.b.seat === seat) return this.b
    return this.mode === '1p' ? this.a : null
  }

  // ---- inputs ---------------------------------------------------------------------------------
  onGesture(seat: string, g: Gesture): boolean {
    if (this.roundOver) return false
    const f = this.fighterForSeat(seat)
    if (!f || f.ai) return false
    const ex = g.extra ?? {}
    switch (g.kind) {
      case 'punch': this.startPunch(f, String(ex.type ?? 'jab'), g.power); return true
      case 'block_on': f.wantsGuard = true; return true
      case 'block_off': f.wantsGuard = false; return true
      case 'parry': this.parry(f); return true
      case 'dodge': this.dodge(f, Number(ex.dir ?? -f.facing) as 1 | -1); return true
      case 'move': f.moveDir = Number(ex.dir ?? 0); return true
      case 'move_stop': f.moveDir = 0; return true
      default: return false
    }
  }

  startPunch(f: Fighter, kind: string, power: number): boolean {
    if (!(f.state === 'idle' || f.state === 'block' || (f.state === 'recover' && f.stateT <= 0.06))) return false
    const fd = FD[kind] ?? JAB
    if (f.stamina < fd.stamina) { this.events.push({ kind: 'gassed', who: f.id }); return false }
    f.stamina -= fd.stamina
    f.punch = kind; f.power = Math.max(0.2, Math.min(1, power))
    f.state = 'windup'; f.stateT = fd.windup * this.fatigue(f); f.landedThis = false; f.guard = false; f.thrown++
    this.events.push({ kind: 'windup', who: f.id, type: kind, ms: Math.round(f.stateT * 1000) })
    if (this.learner && f === this.a) this.learner.onPunch(this.clock, kind)
    const other = this.other(f)
    if (other.ai) other.ai.onOpponentWindup(other, f, this)
    return true
  }

  parry(f: Fighter): void {
    if (['windup', 'active', 'down', 'stunned', 'stagger'].includes(f.state)) return
    const other = this.other(f)
    const ok = ((other.state === 'windup' && other.stateT <= PARRY_WINDOW) || other.state === 'active') && this.inReach(other, f)
    if (ok) {
      other.state = 'stunned'; other.stateT = PARRY_STUN; other.guard = false
      f.parryBonus = 1.5; f.state = 'parry'; f.stateT = 0.25
      this.flags.hitstop = true
      this.events.push({ kind: 'parry', who: f.id, result: 'success' })
    } else {
      f.state = 'parry'; f.stateT = 0.35; f.openT = 0.45; f.guard = false
      this.events.push({ kind: 'parry', who: f.id, result: 'whiff' })
    }
  }

  dodge(f: Fighter, dir: 1 | -1): void {
    if (f.dodgeCd > 0 || ['down', 'stunned', 'stagger', 'windup', 'active'].includes(f.state) || f.stamina < 6) return
    f.stamina -= 6; f.state = 'dodge'; f.stateT = DODGE_TIME; f.dodgeCd = DODGE_COOLDOWN; f.vx = dir * 1.6; f.guard = false
    this.events.push({ kind: 'dodge', who: f.id, dir })
  }

  other(f: Fighter): Fighter { return f === this.a ? this.b : this.a }
  fatigue(f: Fighter): number { return f.stamina > 30 ? 1 : 1.6 - 0.6 * (f.stamina / 30) }
  inReach(att: Fighter, def: Fighter): boolean {
    const fd = FD[att.punch] ?? JAB
    return Math.abs(def.x - att.x) <= fd.reach && Math.sign(def.x - att.x) === att.facing
  }

  // ---- simulation ---------------------------------------------------------------------------------
  step(dtS: number): void {
    this.events = []; this.flags = {}
    if (this.roundOver) return
    const dt = Math.min(dtS, 0.05)
    this.clock += dt
    for (const f of [this.a, this.b]) {
      if (f.ai) f.ai.think(f, this.other(f), this, dt)
      this.advance(f, dt)
    }
    this.separate()
    this.a.facing = this.b.x >= this.a.x ? 1 : -1
    this.b.facing = this.a.facing === 1 ? -1 : 1
    if (this.learner) this.learner.tick(this.clock, this.b, this)
    if (this.clock >= this.roundS) { this.roundOver = true; this.events.push({ kind: 'bell' }) }
  }

  private advance(f: Fighter, dt: number): void {
    f.dodgeCd = Math.max(0, f.dodgeCd - dt); f.openT = Math.max(0, f.openT - dt)
    const other = this.other(f)
    const canMove = f.state === 'idle' || f.state === 'block' || f.state === 'recover'
    if (canMove && f.moveDir !== 0) f.vx = f.moveDir * MOVE_SPEED * (f.guard ? 0.55 : 1)
    else if (f.state !== 'dodge' && f.state !== 'stagger') f.vx = f.vx > 0 ? Math.max(0, f.vx - 6 * dt) : Math.min(0, f.vx + 6 * dt)
    f.x = Math.max(-RING_HALF, Math.min(RING_HALF, f.x + f.vx * dt))
    if (f.state === 'idle' || f.state === 'block') {
      if (f.wantsGuard && f.openT <= 0) { f.guard = true; f.state = 'block' } else { f.guard = false; f.state = 'idle' }
    }
    f.stamina = Math.min(100, f.stamina + (f.state === 'block' ? 10 : f.state === 'idle' ? 6 : 2) * dt)
    if (['windup', 'active', 'recover', 'parry', 'dodge', 'stagger', 'stunned', 'down'].includes(f.state)) {
      f.stateT -= dt
      if (f.state === 'active' && !f.landedThis) this.tryHit(f, other)
      if (f.state === 'down' && f.stateT > 0) {
        const count = Math.min(10, Math.ceil((this.downS - f.stateT) / (this.downS / 10)))
        if (count !== f.downCount) { f.downCount = count; this.events.push({ kind: 'count', who: f.id, count }) }
      }
      if (f.stateT <= 0) {
        const fd = FD[f.punch] ?? JAB
        switch (f.state) {
          case 'windup': f.state = 'active'; f.stateT = fd.active; f.landedThis = false; break
          case 'active':
            if (!f.landedThis) this.events.push({ kind: 'punch', who: f.id, type: f.punch, result: 'whiff' })
            f.state = 'recover'; f.stateT = fd.recover * this.fatigue(f); break
          case 'recover': case 'parry': case 'dodge': case 'stagger': case 'stunned': f.state = 'idle'; break
          case 'down': if (f.hp > 0) { f.state = 'idle'; f.stamina = Math.max(f.stamina, 45); f.downCount = 0; this.events.push({ kind: 'getup', who: f.id }) } break
        }
      }
    }
  }

  private tryHit(att: Fighter, def: Fighter): void {
    if (!this.inReach(att, def) || def.state === 'down') return
    att.landedThis = true
    const fd = FD[att.punch] ?? JAB
    let dmg = fd.dmg * (0.5 + 0.5 * att.power) / this.fatigue(att)
    if (att.parryBonus > 0) { dmg *= att.parryBonus; att.parryBonus = 0 }
    if (att.ai?.counterPending) { dmg *= 1.3; att.ai.counterPending = false }
    if (def.state === 'dodge') { this.events.push({ kind: 'punch', who: att.id, type: att.punch, result: 'dodged' }); return }
    let result = 'hit'
    if (def.state === 'stunned') dmg *= 1.25
    if (def.guard && def.state === 'block') {
      dmg *= 0.2; def.stamina = Math.max(0, def.stamina - 2); def.blocked++; result = 'blocked'
      def.vx = att.facing * fd.knock * 2
    } else {
      att.landed++
      def.state = 'stagger'; def.stateT = att.punch === 'jab' ? 0.18 : 0.3
      def.vx = att.facing * fd.knock * 9 * (0.6 + 0.4 * att.power); def.guard = false
      this.flags.shake = true
      if (att.punch !== 'jab') this.flags.hitstop = true
    }
    const before = def.hp
    def.hp = Math.max(0, def.hp - dmg)
    att.dealtRound += dmg; att.dealtTotal += dmg
    this.events.push({ kind: 'punch', who: att.id, type: att.punch, result, dmg: +dmg.toFixed(1), x: def.x })
    for (const m of [...def.marks]) {
      if (before > m && m >= def.hp) {
        def.marks = def.marks.filter((v) => v !== m)
        def.knockdowns++; def.state = 'down'; def.stateT = this.downS; def.guard = false; def.downCount = 0
        this.flags.slowmo = true
        this.events.push({ kind: 'knockdown', who: def.id, ko: def.hp <= 0 })
        if (def.hp <= 0) { this.ko = att.id; this.roundOver = true; att.state = 'victory' }
        break
      }
    }
  }

  private separate(): void {
    const gap = this.b.x - this.a.x
    if (Math.abs(gap) < BODY_GAP) {
      const push = (BODY_GAP - Math.abs(gap)) / 2, s = gap >= 0 ? 1 : -1
      this.a.x = Math.max(-RING_HALF, Math.min(RING_HALF, this.a.x - push * s))
      this.b.x = Math.max(-RING_HALF, Math.min(RING_HALF, this.b.x + push * s))
    }
  }

  inputDone(): boolean { return this.roundOver }
  noInput(): void { this.roundOver = true }

  resolve(): TurnResult {
    const a = this.a, b = this.b
    const w = this.ko ? this.ko : a.dealtRound > b.dealtRound ? a.id : b.dealtRound > a.dealtRound ? b.id : 'draw'
    this.roundWinners.push(w)
    const winners = w !== 'draw' ? [w] : [a.id, b.id]
    const triggers: [string, Record<string, unknown>][] = this.ko
      ? [['knockdown', { loser: this.ko === a.id ? b.name : a.name, ko: true }]]
      : [['turn_result', { outcome: `Round ${this.roundNo} to ${w === a.id ? a.name : w === b.id ? b.name : 'nobody'}`, player: a.name }]]
    return { outcome: w, market_winners: { round_winner: winners }, detail: { round: this.roundNo, winner: w, ko: this.ko, a: a.public(), b: b.public() }, triggers, animation_s: this.ko ? 4 : 2.5 }
  }
  summary() { return { round: this.roundNo, rounds: this.rounds, fighters: { [this.a.id]: this.a.public(), [this.b.id]: this.b.public() }, round_winners: this.roundWinners, ko: this.ko, card: this.start?.card ?? false, mode: this.mode } }
  stateSummary() { return { score: this.summary(), fighters: { [this.a.id]: this.a.public(), [this.b.id]: this.b.public() }, clock_s: +this.clock.toFixed(1), round_s: this.roundS, round: this.roundNo } }
  winner(): string {
    if (this.ko) return this.ko
    const ra = this.roundWinners.filter((w) => w === this.a.id).length, rb = this.roundWinners.filter((w) => w === this.b.id).length
    if (ra !== rb) return ra > rb ? this.a.id : this.b.id
    if (this.a.hp !== this.b.hp) return this.a.hp > this.b.hp ? this.a.id : this.b.id
    return 'tie'
  }
}
