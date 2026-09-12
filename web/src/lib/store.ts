import { create } from 'zustand'
import type { DeviceInfo, Envelope, Gesture, LeaderRow, Market, MatchSummary, Seat, Snapshot, VoiceLine, Welcome } from '../protocol'
import { ArenaSocket, type SocketOpts } from './ws'

export interface ArenaState {
  socket: ArenaSocket | null
  connected: boolean
  welcome: Welcome | null
  publicUrl: string
  railUrl: string
  seats: Seat[]
  match: MatchSummary | null
  phase: { turn_no: number; phase: string; deadline_ts: number; label?: string } | null
  tick: Record<string, unknown> | null
  lastTurn: Record<string, unknown> | null
  lastEnd: Record<string, unknown> | null
  markets: Record<string, Market>
  leaderboard: LeaderRow[]
  balance: number
  ladder: Record<string, Record<string, number>>
  studying: Record<string, unknown>
  card: Record<string, unknown> | null
  crate: Record<string, unknown> | null
  toggles: Record<string, boolean>
  devices: DeviceInfo[]
  seatTokens: Record<string, string>
  statuses: Record<string, Record<string, unknown>>
  meters: Record<string, number>
  lastGesture: Gesture | null
  calib: { phase: string; progress: number; calib: Record<string, unknown> } | null
  diagnostics: Record<string, unknown>[]
  gestureSeq: number
  decisions: Record<string, unknown>[]
  voice: VoiceLine | null
  sfx: { name: string; gain: number; n: number } | null
  sponsor: Record<string, unknown> | null
  sponsorAck: Record<string, unknown> | null
  crateResult: Record<string, unknown> | null
  moves: Record<string, unknown>[]
  pairing: Record<string, unknown> | null
  betAck: Record<string, unknown> | null
  hostAck: Record<string, unknown> | null
  hostConfig: Record<string, unknown> | null
  arenaDiag: Record<string, unknown> | null
  sockets: Record<string, unknown>[]
  telemetry: Record<string, unknown> | null
  settle: Record<string, unknown> | null
  error: string | null
  log: Envelope[]
  connect: (opts: SocketOpts) => ArenaSocket
  apply: (env: Envelope) => void
}

const MAX_LOG = 200

export const useArena = create<ArenaState>((set, get) => ({
  socket: null, connected: false, welcome: null, publicUrl: '', railUrl: '', seats: [], match: null, phase: null, tick: null,
  lastTurn: null, lastEnd: null, markets: {}, leaderboard: [], balance: 0, ladder: {}, studying: {}, card: null, crate: null,
  toggles: {}, devices: [], seatTokens: {}, statuses: {}, meters: {}, lastGesture: null, calib: null, diagnostics: [], gestureSeq: 0, decisions: [], voice: null,
  sfx: null, sponsor: null, sponsorAck: null, crateResult: null, moves: [], pairing: null, betAck: null, hostAck: null, hostConfig: null, arenaDiag: null, sockets: [], telemetry: null, settle: null, error: null, log: [],

  connect: (opts) => {
    const existing = get().socket
    if (existing && existing.role === opts.role && (existing.token === (opts.token ?? null) || existing.role !== 'remote')) return existing
    if (existing) existing.close()
    const s = new ArenaSocket(opts)
    s.on('*', (env) => get().apply(env))
    s.on('__open', () => set({ connected: true }))
    s.on('__close', () => set({ connected: false }))
    s.connect()
    set({ socket: s })
    return s
  },

  apply: (env) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = env.d
    const patch: Partial<ArenaState> = {}
    switch (env.t) {
      case 'session.welcome': if (!(d as Record<string, unknown>).__open) { patch.welcome = d as unknown as Welcome; patch.publicUrl = (d as Welcome).public_url; patch.railUrl = (d as Welcome).rail_url; patch.balance = (d as Welcome).balance ?? get().balance }; break
      case 'session.snapshot': { const s = d as unknown as Snapshot
        Object.assign(patch, { publicUrl: s.public_url, railUrl: s.rail_url, seats: s.seats, match: s.match, leaderboard: s.leaderboard, ladder: s.ladder, studying: s.studying, card: s.card, crate: s.crate, toggles: s.toggles })
        patch.markets = Object.fromEntries((s.markets ?? []).map((m) => [m.market_id, m]))
        if (s.me) patch.balance = s.me.balance
        if (s.devices) patch.devices = s.devices
        if (s.seat_tokens) patch.seatTokens = s.seat_tokens
        if (s.moves) patch.moves = s.moves
        if (s.pairing !== undefined) patch.pairing = s.pairing
        if (s.match?.phase) patch.phase = { turn_no: s.match.turn_no ?? 0, phase: s.match.phase, deadline_ts: s.match.deadline_ts ?? 0 }
        break }
      case 'session.error': if (!(d as Record<string, unknown>).__closed) patch.error = String((d as { reason?: string }).reason ?? 'error'); break
      case 'seat.update': patch.seats = (d as { seats: Seat[] }).seats; if ((d as { rail_url?: string }).rail_url) patch.railUrl = (d as { rail_url: string }).rail_url; break
      case 'motion.status': { const st = d as { device_id: string }; patch.statuses = { ...get().statuses, [st.device_id]: st }; break }
      case 'motion.meter': { const m = d as { seat_id: string; mag: number }; patch.meters = { ...get().meters, [m.seat_id ?? 'me']: m.mag }; break }
      case 'motion.calib': patch.calib = d; break
      case 'motion.gesture': patch.lastGesture = d as unknown as Gesture; patch.gestureSeq = get().gestureSeq + 1; break
      case 'match.start': patch.match = d as unknown as MatchSummary; patch.phase = null; patch.tick = null; patch.lastTurn = null; patch.lastEnd = null; patch.markets = {}; break
      case 'match.phase': patch.phase = d as unknown as ArenaState['phase']; if (get().match) patch.match = { ...get().match!, phase: (d as { phase: string }).phase, turn_no: (d as { turn_no: number }).turn_no, deadline_ts: (d as { deadline_ts: number }).deadline_ts }; break
      case 'match.tick': patch.tick = d; break
      case 'match.turn_result': patch.lastTurn = d; if (get().match) patch.match = { ...get().match!, score: (d as { score?: Record<string, unknown> }).score ?? get().match!.score }; break
      case 'match.end': patch.lastEnd = d; if (get().match) patch.match = { ...get().match!, phase: 'ended' }; break
      case 'match.pause': if (get().match) patch.match = { ...get().match!, paused: Boolean((d as { paused: boolean }).paused) }; break
      case 'agent.decision': patch.decisions = [...get().decisions.slice(-19), d]; break
      case 'agent.studying': patch.studying = { ...get().studying, [(d as { agent_id: string }).agent_id]: d }; break
      case 'market.window': { const m = d as unknown as Market; patch.markets = { ...get().markets, [m.market_id]: m }; break }
      case 'market.odds': { const o = d as { market_id: string; pools: Record<string, number> }; const m = get().markets[o.market_id]; if (m) patch.markets = { ...get().markets, [o.market_id]: { ...m, outcomes: m.outcomes.map((x) => ({ ...x, pool: o.pools[x.id] ?? x.pool })) } }; break }
      case 'market.settle': { const s = d as { market_id: string; winner: string | string[] }; const m = get().markets[s.market_id]; patch.settle = d; if (m) patch.markets = { ...get().markets, [s.market_id]: { ...m, open: false, status: 'settled', winner: s.winner } }; break }
      case 'market.bet_ack': patch.betAck = d; if (typeof (d as { balance?: number }).balance === 'number') patch.balance = (d as { balance: number }).balance; break
      case 'market.balance': patch.balance = (d as { balance: number }).balance; break
      case 'market.leaderboard': patch.leaderboard = (d as { rows: LeaderRow[] }).rows; break
      case 'ladder.update': patch.ladder = (d as { ladder: Record<string, Record<string, number>> }).ladder; break
      case 'sponsor.warn': case 'sponsor.applied': case 'sponsor.ack': patch.sponsor = { ...d, kind: env.t }; if (env.t === 'sponsor.ack') patch.sponsorAck = { ...d, n: ((get().sponsorAck?.n as number) ?? 0) + 1 }; break
      case 'crate.open': patch.crate = d; break
      case 'crate.result': patch.crate = null; patch.sponsor = { ...d, kind: env.t }; patch.crateResult = { ...d, n: ((get().crateResult?.n as number) ?? 0) + 1 }; break
      case 'card.vote_open': patch.card = d; break
      case 'card.vote_result': patch.card = { ...d, done: true }; break
      case 'pair.prompt': case 'pair.result': patch.pairing = { ...d, kind: env.t }; break
      case 'voice.line': patch.voice = d as unknown as VoiceLine; break
      case 'sfx.play': patch.sfx = { ...(d as { name: string; gain: number }), n: (get().sfx?.n ?? 0) + 1 }; break
      case 'host.ack': patch.hostAck = { ...d, n: ((get().hostAck?.n as number) ?? 0) + 1 }; if (d.toggles) patch.toggles = d.toggles; break
      case 'host.config': patch.hostConfig = d; break
      case 'host.diagnostics': if (d.devices) patch.devices = d.devices; if (d.motion) patch.diagnostics = d.motion; if (d.arena) patch.arenaDiag = d.arena; if (d.sockets) patch.sockets = d.sockets; if (d.telemetry) patch.telemetry = d.telemetry; break
      default: break
    }
    if (env.t !== 'motion.meter' && env.t !== 'match.tick' && env.t !== 'session.pong' && !d.__open && !d.__closed) patch.log = [...get().log.slice(-(MAX_LOG - 1)), env]
    set(patch)
  },
}))

export function useSocket(): ArenaSocket | null { return useArena((s) => s.socket) }

// Debug handle for the in-app browser and the desktop-test remote: window.__hap.getState().lastGesture
declare global { interface Window { __hap?: typeof useArena } }
if (typeof window !== 'undefined') window.__hap = useArena
