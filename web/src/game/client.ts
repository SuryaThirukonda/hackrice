// GameClient: the Phaser side of the game-client contract (docs/ENGINE_ARCHITECTURE.md).
// Owns the arena socket (role=game), the active sim, the turn flow (betting -> 3-2-1 -> input -> resolving -> between),
// persona decision requests, keyboard seat bindings and the replay log. Scenes subscribe to its events.
import Phaser from 'phaser'
import { ArenaSocket } from '../lib/ws'
import type { Envelope } from '../protocol'
import { BoxingSim } from './sims/boxing'
import type { DecisionReq, Gesture, Sim, StartPayload, TurnPlan, TurnResult } from './sims/types'

export type Phase = 'idle' | 'starting' | 'betting' | 'waiting' | 'countdown' | 'input' | 'resolving' | 'between' | 'ended' | 'paused'

export class GameClient extends Phaser.Events.EventEmitter {
  socket: ArenaSocket
  sim: Sim | null = null
  start: StartPayload | null = null
  phase: Phase = 'idle'
  turnNo = 0
  inputDeadlineMs = 0
  paused = false
  seats: Record<string, unknown>[] = []
  snapshot: Record<string, unknown> = {}
  keyboardSeats: Record<number, string> = {}
  private pending: Record<string, DecisionReq> = {}
  private afterDecisions: (() => void) | null = null
  private log: Record<string, unknown>[] = []
  private betweenLeft = 0
  private stateAccum = 0
  private countdownLeft = 0
  private countdownN = 0
  private rid = 0
  lastError = ''

  constructor(wsUrl?: string) {
    super()
    this.socket = new ArenaSocket({ role: 'game', nickname: 'Phaser', url: wsUrl })
    this.socket.on('*', (env) => this.onMessage(env))
    this.socket.on('__open', () => { this.socket.send('game.hello', { engine: 'phaser', version: Phaser.VERSION }); this.emit('connected') })
    this.socket.on('__close', () => this.emit('disconnected'))
    this.socket.connect()
  }

  nowMs(): number { return this.socket.serverNow() }
  seat(seatId: string): Record<string, unknown> { return this.seats.find((s) => s.seat_id === seatId) ?? {} }
  keyboardSeat(slot: number): string { return this.keyboardSeats[slot] ?? '' }
  bindKeyboard(seatId: string, slot: number): void { this.keyboardSeats[slot] = seatId; this.socket.send('game.kb', { seat_id: seatId, kind: 'claim' }) }
  unbindKeyboard(): void { this.keyboardSeats = {} }
  setSeats(mode: '1p' | '2p'): void { this.socket.send('host.set_seats', { mode: mode === '2p' ? 'head_to_head' : 'single' }) }
  requestStart(sport: string, mode: '1p' | '2p' | 'card', tier = ''): void {
    this.lastError = ''
    const d: Record<string, unknown> = { sport, mode }
    if (tier) d.tier = tier
    this.socket.send('game.request_start', d)
  }

  private onMessage(env: Envelope): void {
    const d = env.d as Record<string, unknown>
    switch (env.t) {
      case 'session.snapshot': this.snapshot = d; this.seats = (d.seats as Record<string, unknown>[]) ?? []; this.emit('snapshot', d); break
      case 'seat.update': this.seats = (d.seats as Record<string, unknown>[]) ?? []; this.emit('seats', this.seats); break
      case 'host.ack': if (d.ok === false && (d.cmd === 'start' || d.cmd === 'card')) { this.lastError = String(d.reason ?? 'could not start'); this.emit('error', this.lastError) } break
      case 'game.start': this.onStart(d as unknown as StartPayload); break
      case 'game.turn_go': this.enterInput(); break
      case 'game.gesture': this.onGesture(d as unknown as Gesture); break
      case 'game.decision': this.onDecision(d); break
      case 'game.adjust': this.onAdjust(d); break
      case 'game.pause': this.paused = true; this.emit('phase', 'paused', d); break
      case 'game.resume': this.paused = false; this.emit('phase', this.phase, {}); break
      case 'game.abort': this.sim = null; this.phase = 'idle'; this.emit('aborted', String(d.reason ?? '')); break
      case 'agent.decision': this.emit('taunt', d); break
      case 'voice.line': this.emit('voice', d); break
      default: break
    }
  }

  private onStart(d: StartPayload): void {
    this.start = d; this.turnNo = 0; this.log = []
    if (d.sport === 'boxing') this.sim = new BoxingSim()
    else { this.socket.send('game.error', { message: `${d.sport} is not built in the Phaser client yet` }); this.socket.send('game.match_end', { winner: 'void', score: {}, reason: 'unsupported' }); return }
    this.sim.setup(d)
    this.phase = 'starting'
    this.emit('match', d)
    this.planTurn()
  }

  private planTurn(): void {
    if (!this.sim) return
    const plan = this.sim.planTurn()
    if (!plan) {
      const winner = this.sim.winner(), score = this.sim.summary()
      this.socket.send('game.match_end', { winner, score, reason: 'complete' })
      this.phase = 'ended'
      this.emit('ended', { winner, score, match: this.start })
      this.sim = null
      return
    }
    this.turnNo++
    this.phase = plan.betting ? 'betting' : 'waiting'
    this.emit('phase', this.phase, plan)
    this.socket.send('game.turn_open', { turn_no: this.turnNo, label: plan.label, betting: plan.betting, input_window_s: plan.input_window_s, markets: plan.markets, prompt: plan.prompt })
  }

  private withDecisions(which: 'input' | 'resolving', then: () => void): void {
    const reqs = this.sim?.decisionsBefore(which) ?? []
    if (!reqs.length) { then(); return }
    this.afterDecisions = then
    for (const r of reqs) {
      const id = `p${++this.rid}`
      this.pending[id] = r
      this.socket.send('game.decision_request', { request_id: id, agent_id: r.agent_id, options: r.options, default: r.default, context: r.context })
    }
  }

  private onDecision(d: Record<string, unknown>): void {
    const id = String(d.request_id), req = this.pending[id]
    if (!req || !this.sim) return
    delete this.pending[id]
    const opt = String(d.option_id ?? req.default)
    this.sim.applyDecision(req, opt)
    this.log.push({ t: this.nowMs(), kind: 'decision', agent: req.agent_id, option: opt })
    this.emit('decision', { agent_id: req.agent_id, option_id: opt, line: d.line ?? null, source: d.source })
    if (!Object.keys(this.pending).length && this.afterDecisions) { const cb = this.afterDecisions; this.afterDecisions = null; cb() }
  }

  private enterInput(): void { this.withDecisions('input', () => this.countdownThenInput()) }

  private countdownThenInput(): void {
    this.countdownN = 3; this.countdownLeft = 1; this.phase = 'countdown'
    this.emit('countdown', 3); this.emit('phase', 'countdown', { n: 3 })
  }

  private inputNow(): void {
    const plan = this.sim?.currentPlan()
    if (!this.sim || !plan) return
    this.inputDeadlineMs = this.nowMs() + plan.input_window_s * 1000
    this.phase = 'input'
    this.socket.send('game.phase', { turn_no: this.turnNo, phase: 'input', deadline_ts: Math.round(this.inputDeadlineMs), prompt: plan.prompt, seat_id: plan.input_seats[0] ?? null })
    this.emit('phase', 'input', plan)
  }

  /** Called from the scene's update at render rate; dtS already scaled by hit-stop / slow-mo. */
  update(dtS: number): void {
    if (!this.sim || this.paused) return
    if (this.phase === 'countdown') {
      this.countdownLeft -= dtS
      if (this.countdownLeft <= 0) {
        this.countdownN--
        if (this.countdownN <= 0) { this.emit('countdown', 0); this.inputNow() } else { this.countdownLeft = 1; this.emit('countdown', this.countdownN) }
      }
      return
    }
    if (this.phase === 'input') {
      this.sim.step(dtS, this.nowMs())
      this.emit('tick', this.sim)
      this.stateAccum += dtS
      if (this.stateAccum >= 0.2) { this.stateAccum = 0; this.socket.send('game.state', this.sim.stateSummary()) }
      if (this.sim.inputDone()) this.enterResolving()
      else if (this.nowMs() >= this.inputDeadlineMs) { this.sim.noInput(); this.enterResolving() }
    } else if (this.phase === 'between') {
      this.betweenLeft -= dtS
      if (this.betweenLeft <= 0) this.planTurn()
    }
  }

  private onGesture(g: Gesture): void {
    if (!this.sim || this.phase !== 'input') return
    if (this.sim.onGesture(g.seat_id, g)) {
      this.log.push({ t: g.t_server, kind: 'gesture', seat: g.seat_id, g: g.kind, power: g.power, extra: g.extra })
      if (this.sim.inputDone()) this.enterResolving()
    }
  }

  /** Native keyboard input: applied at once locally, reported to the arena for the log and the rail. */
  localInput(seatId: string, kind: string, params: Record<string, unknown> = {}): void {
    if (!this.sim || this.phase !== 'input') return
    const g: Gesture = { seat_id: seatId, kind, power: Number(params.power ?? 0.7), t_server: this.nowMs(), duration_ms: Number(params.duration_ms ?? 80), extra: params }
    if (this.sim.onGesture(seatId, g)) {
      this.log.push({ t: g.t_server, kind: 'gesture', seat: seatId, g: kind, power: g.power, extra: params, src: 'kb' })
      this.socket.send('game.kb', { seat_id: seatId, kind, params })
      if (this.sim.inputDone()) this.enterResolving()
    }
  }

  private enterResolving(): void {
    if (this.phase === 'resolving') return
    this.phase = 'resolving'
    this.withDecisions('resolving', () => this.resolveNow())
  }

  private resolveNow(): void {
    if (!this.sim) return
    const res: TurnResult = this.sim.resolve()
    this.socket.send('game.phase', { turn_no: this.turnNo, phase: 'resolving', deadline_ts: Math.round(this.nowMs() + res.animation_s * 1000), prompt: {} })
    this.emit('phase', 'resolving', res)
    this.socket.send('game.turn_result', { turn_no: this.turnNo, outcome: res.outcome, market_winners: res.market_winners, detail: res.detail, score: this.sim.summary(), triggers: res.triggers, animation_s: res.animation_s })
    this.socket.send('game.log', { turn_no: this.turnNo, entries: this.log }); this.log = []
    this.emit('turn', res)
    this.phase = 'between'
    this.betweenLeft = res.animation_s + (this.start?.between_s ?? 2)
    this.socket.send('game.phase', { turn_no: this.turnNo, phase: 'between', deadline_ts: Math.round(this.nowMs() + this.betweenLeft * 1000), prompt: {} })
    this.emit('phase', 'between', res)
  }

  private onAdjust(d: Record<string, unknown>): void {
    if (!this.sim) return
    const eff = (d.effect ?? {}) as Record<string, unknown>
    if (eff.grant) this.sim.grant(String(eff.grant))
    else if (d.param) this.sim.adjust(String(d.param), Number(d.delta ?? 0), String(d.reason ?? ''))
    this.emit('adjust', d)
  }

  currentPlan(): TurnPlan | null { return this.sim?.currentPlan() ?? null }
}
