// Hand-written mirror of backend/app/protocol.py. backend/scripts/check_protocol.py diffs the type lists.
export const SERVER_MESSAGES = [
  'session.welcome', 'session.pong', 'session.snapshot', 'session.error',
  'motion.status', 'motion.meter', 'motion.gesture', 'motion.calib',
  'seat.update',
  'match.start', 'match.phase', 'match.tick', 'match.turn_result', 'match.end', 'match.pause',
  'agent.decision', 'agent.studying',
  'market.window', 'market.bet_ack', 'market.odds', 'market.settle', 'market.leaderboard', 'market.balance',
  'sponsor.warn', 'sponsor.applied', 'sponsor.ack', 'crate.open', 'crate.result', 'card.vote_open', 'card.vote_result',
  'pair.prompt', 'pair.result',
  'voice.line', 'sfx.play',
  'host.ack', 'host.config', 'host.diagnostics', 'ladder.update',
] as const

export const CLIENT_MESSAGES = [
  'session.hello', 'session.ping', 'session.resync', 'session.nickname',
  'motion.frame', 'motion.calib_done', 'input.action',
  'market.bet', 'sponsor.buy', 'crate.bid', 'card.vote', 'pair.request',
  'host.telemetry', 'host.start', 'host.pause', 'host.resume', 'host.next', 'host.force_scenario', 'host.set_param',
  'host.kick', 'host.release_seat', 'host.lock_seat', 'host.set_public_url', 'host.reload_config', 'host.toggle',
  'host.set_seats', 'host.card', 'host.unlock_audio', 'host.adjust_chips',
] as const

export type ServerType = (typeof SERVER_MESSAGES)[number]
export type ClientType = (typeof CLIENT_MESSAGES)[number]
export type Role = 'remote' | 'rail' | 'projector' | 'host'

// Motion sample: [t_phone_ms, ax, ay, az, agx, agy, agz, rx, ry, rz, alpha, beta, gamma]
export type Sample = [number, number, number, number, number, number, number, number, number, number, number, number, number]
export const SAMPLE_LEN = 13

export interface Envelope<T = Record<string, unknown>> { t: ServerType; seq: number; match: string | null; ts: number; d: T }

export interface Seat { seat_id: string; label: string; status: 'open' | 'claimed' | 'locked'; device_id: string | null; nickname: string | null; hand: string | null; side: string | null; join_url: string | null }
export interface Welcome { device_id: string; role: Role; nickname: string | null; seat_id: string | null; seat_token: string | null; seat_label: string | null; hand: string | null; reason: string | null; public_url: string; rail_url: string; server_ts: number; mode: string; dev: boolean; balance: number }
export interface DeviceInfo { device_id: string; role: Role; nickname: string | null; connected: boolean; seat_id: string | null; hz: number; offset_ms: number; calibrated: boolean; last_gesture: string | null }
export interface Outcome { id: string; label: string; pool: number }
export interface Market { market_id: string; kind: string; label: string; outcomes: Outcome[]; closes_ts: number; open: boolean; turn_no?: number; winner?: string | string[] | null; status?: string; pool?: number; match_id?: string | null }
export interface MatchSummary { match_id: string; sport: 'bowling' | 'baseball' | 'boxing'; seed: number; human_seats: string[]; opponent: { tier: string; name: string; accent?: string }; players?: Record<string, string>; phase?: string; turn_no?: number; deadline_ts?: number; score?: Record<string, unknown>; paused?: boolean; card?: boolean; fighters?: Record<string, unknown> }
export interface LeaderRow { device_id: string; nickname: string; chips: number; titles: string[] }
export interface Snapshot { public_url: string; rail_url: string; seats: Seat[]; match: MatchSummary | null; markets: Market[]; leaderboard: LeaderRow[]; ladder: Record<string, Record<string, number>>; studying: Record<string, unknown>; card: Record<string, unknown> | null; crate: Record<string, unknown> | null; toggles: Record<string, boolean>; me?: { device_id: string; balance: number; nickname?: string | null; seat_id?: string | null; calibrated?: boolean }; devices?: DeviceInfo[]; seat_tokens?: Record<string, string>; audio_unlocked?: boolean }
export interface Gesture { seat_id: string | null; device_id: string; kind: string; t_phone: number; t_server: number; power: number; axis: string; sign: number; duration_ms: number; extra?: Record<string, unknown> }
export interface VoiceLine { priority: number; speaker: string; text: string; url: string | null; duration_ms: number; id: string }
