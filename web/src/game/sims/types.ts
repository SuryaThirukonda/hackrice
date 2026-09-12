// Shared shapes for the game-client contract (mirrors backend/app/games/bridge.py and gameclient.py).
export interface TierInfo { id: string; name: string; params: Record<string, number | string | boolean | string[]>; accent?: string; twist?: string | null; taunts?: string[] }
export interface StartPayload { match_id: string; sport: 'bowling' | 'baseball' | 'boxing'; seed: number; mode: '1p' | '2p' | 'card'; card: boolean; tier: TierInfo; tier_b: TierInfo | null; players: Record<string, string>; seats: { seat_id: string; hand?: string | null; side?: string | null }[]; scenario: Record<string, unknown>; adjustments: Record<string, number>; game: Record<string, Record<string, unknown>>; betting_s: number; between_s: number; resume?: boolean }
export interface Gesture { seat_id: string; kind: string; power: number; t_server: number; duration_ms: number; extra: Record<string, unknown>; device_id?: string }
export interface DecisionOption { id: string; label: string; ev: number; params?: Record<string, unknown> }
export interface DecisionReq { agent_id: string; options: DecisionOption[]; default: string; context: Record<string, unknown> }
export interface MarketSpec { kind: string; label: string; outcomes: [string, string][]; seed_stake?: Record<string, number> | null }
export interface TurnPlan { label: string; input_seats: string[]; input_window_s: number; betting: boolean; markets: MarketSpec[]; prompt: Record<string, unknown>; live?: boolean }
export interface TurnResult { outcome: string; market_winners: Record<string, string[]>; detail: Record<string, unknown>; triggers: [string, Record<string, unknown>][]; animation_s: number; ticks?: Record<string, unknown>[] }

export interface Sim {
  readonly sport: string
  setup(start: StartPayload): void
  planTurn(): TurnPlan | null
  currentPlan(): TurnPlan | null
  decisionsBefore(phase: 'input' | 'resolving'): DecisionReq[]
  applyDecision(req: DecisionReq, optionId: string): void
  onGesture(seat: string, g: Gesture): boolean
  step(dtS: number, nowMs: number): void
  inputDone(): boolean
  noInput(): void
  resolve(): TurnResult
  summary(): Record<string, unknown>
  stateSummary(): Record<string, unknown>
  winner(): string
  adjust(param: string, delta: number, reason: string): void
  grant(what: string): void
}
