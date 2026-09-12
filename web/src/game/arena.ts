// ArenaLink: one arena socket per page plus the arena's public state, kept up to date from the event stream.
// Every Phaser scene reads `arena.state` and listens to `arena.on(...)`. Ported from the old React store.
import Phaser from 'phaser'
import { ArenaSocket, type SocketOpts } from '../lib/ws'
import type { DeviceInfo, Envelope, LeaderRow, Market, MatchSummary, Seat, Snapshot, VoiceLine } from '../protocol'

export interface ArenaState {
  connected: boolean
  welcome: Record<string, unknown> | null
  publicUrl: string; railUrl: string
  seats: Seat[]
  match: MatchSummary | null
  phase: { turn_no: number; phase: string; deadline_ts: number | null; prompt?: Record<string, unknown>; seat_id?: string | null } | null
  tick: Record<string, unknown> | null
  markets: Record<string, Market>
  leaderboard: LeaderRow[]
  balance: number
  ladder: Record<string, Record<string, number>>
  studying: Record<string, { level?: number; n?: number }>
  card: Record<string, unknown> | null
  crate: Record<string, unknown> | null
  moves: Record<string, unknown>[]
  toggles: Record<string, boolean>
  devices: DeviceInfo[]
  diagnostics: Record<string, unknown>[]
  arenaDiag: Record<string, unknown>
  hostConfig: Record<string, unknown>
  calib: { phase: string; progress: number } | null
  lastGesture: Record<string, unknown> | null
  decisions: Record<string, unknown>[]
  voice: VoiceLine | null
  sponsor: Record<string, unknown> | null
  pairing: Record<string, unknown> | null
  settle: Record<string, unknown> | null
  error: string | null
}

export class ArenaLink extends Phaser.Events.EventEmitter {
  socket: ArenaSocket
  state: ArenaState = {
    connected: false, welcome: null, publicUrl: '', railUrl: '', seats: [], match: null, phase: null, tick: null, markets: {}, leaderboard: [], balance: 0,
    ladder: {}, studying: {}, card: null, crate: null, moves: [], toggles: {}, devices: [], diagnostics: [], arenaDiag: {}, hostConfig: {}, calib: null,
    lastGesture: null, decisions: [], voice: null, sponsor: null, pairing: null, settle: null, error: null,
  }
  constructor(opts: SocketOpts) {
    super()
    this.socket = new ArenaSocket(opts)
    this.socket.on('*', (env) => this.apply(env))
    this.socket.on('__open', () => { this.state.connected = true; this.emit('connected') })
    this.socket.on('__close', () => { this.state.connected = false; this.emit('disconnected') })
    this.socket.connect()
  }
  send(t: Parameters<ArenaSocket['send']>[0], d: Record<string, unknown> = {}): boolean { return this.socket.send(t, d) }
  serverNow(): number { return this.socket.serverNow() }
  get device(): string { return this.socket.device }

  private apply(env: Envelope): void {
    const s = this.state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = env.d
    switch (env.t) {
      case 'session.welcome': if (!d.__open) { s.welcome = d; s.publicUrl = d.public_url; s.railUrl = d.rail_url; if (typeof d.balance === 'number') s.balance = d.balance } break
      case 'session.snapshot': { const sn = d as Snapshot
        Object.assign(s, { publicUrl: sn.public_url, railUrl: sn.rail_url, seats: sn.seats, match: sn.match, leaderboard: sn.leaderboard, ladder: sn.ladder, studying: sn.studying as ArenaState['studying'], card: sn.card, crate: sn.crate, toggles: sn.toggles, moves: (d.moves ?? []) as Record<string, unknown>[] })
        s.markets = Object.fromEntries((sn.markets ?? []).map((m) => [m.market_id, m]))
        if (sn.me) s.balance = sn.me.balance
        if (sn.devices) s.devices = sn.devices
        if (sn.match?.phase) s.phase = { turn_no: sn.match.turn_no ?? 0, phase: sn.match.phase, deadline_ts: sn.match.deadline_ts ?? null }
        break }
      case 'session.error': if (!d.__closed) s.error = String(d.reason ?? 'error'); break
      case 'seat.update': s.seats = d.seats; if (d.rail_url) s.railUrl = d.rail_url; break
      case 'motion.calib': s.calib = d; break
      case 'motion.gesture': s.lastGesture = d; break
      case 'match.start': s.match = d; s.phase = null; s.tick = null; s.markets = {}; break
      case 'match.phase': s.phase = d; if (s.match) s.match = { ...s.match, phase: d.phase, turn_no: d.turn_no, deadline_ts: d.deadline_ts }; break
      case 'match.tick': s.tick = d; break
      case 'match.turn_result': if (s.match) s.match = { ...s.match, score: d.score ?? s.match.score }; break
      case 'match.end': if (s.match) s.match = { ...s.match, phase: 'ended' }; break
      case 'match.pause': if (s.match) s.match = { ...s.match, paused: !!d.paused }; break
      case 'agent.decision': s.decisions = [...s.decisions.slice(-19), d]; break
      case 'agent.studying': s.studying = { ...s.studying, [d.agent_id]: d }; break
      case 'market.window': s.markets = { ...s.markets, [d.market_id]: d }; break
      case 'market.odds': { const m = s.markets[d.market_id]; if (m) s.markets = { ...s.markets, [d.market_id]: { ...m, outcomes: m.outcomes.map((o) => ({ ...o, pool: d.pools[o.id] ?? o.pool })) } }; break }
      case 'market.settle': { const m = s.markets[d.market_id]; s.settle = d; if (m) s.markets = { ...s.markets, [d.market_id]: { ...m, open: false, status: d.void ? 'void' : 'settled', winner: d.winner } }; break }
      case 'market.bet_ack': if (typeof d.balance === 'number') s.balance = d.balance; break
      case 'market.balance': s.balance = d.balance; break
      case 'market.leaderboard': s.leaderboard = d.rows; break
      case 'ladder.update': s.ladder = d.ladder; break
      case 'sponsor.warn': case 'sponsor.applied': case 'sponsor.ack': s.sponsor = { ...d, kind: env.t }; break
      case 'crate.open': s.crate = d; break
      case 'crate.result': s.crate = null; break
      case 'card.vote_open': s.card = d; break
      case 'card.vote_result': s.card = { ...d, done: true }; break
      case 'pair.prompt': case 'pair.result': s.pairing = { ...d, kind: env.t }; break
      case 'voice.line': s.voice = d; break
      case 'host.config': s.hostConfig = d.config ?? {}; break
      case 'host.diagnostics': if (d.devices) s.devices = d.devices; if (d.motion) s.diagnostics = d.motion; s.arenaDiag = d; break
      default: break
    }
    this.emit(env.t, d)
    this.emit('*', env)
  }
}
