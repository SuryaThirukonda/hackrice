export type PunchKind = 'jab' | 'cross'
export type DodgeKind = 'swayL' | 'swayR' | 'duck'
export type Side = 'a' | 'b'

/** What a fighter wants to do this tick. punch/dodge are one-shot edges; the rest are held. */
export interface Command { punch: PunchKind | null; punchPower?: number; dodge: DodgeKind | null; block: boolean; forward: -1 | 0 | 1; strafe: -1 | 0 | 1 }
export const IDLE: Readonly<Command> = Object.freeze({ punch: null, dodge: null, block: false, forward: 0, strafe: 0 })
export const cmd = (p: Partial<Command> = {}): Command => ({ ...IDLE, ...p })

export type FighterState = 'idle' | 'windup' | 'active' | 'recover' | 'dodge' | 'hitstun' | 'stagger' | 'down' | 'getup'

export interface V2 { x: number; z: number }

export interface Fighter {
  id: Side
  pos: V2
  vMove: V2
  vKnock: V2
  headOffset: { x: number; y: number }
  headTarget: { x: number; y: number }
  hp: number
  maxHp: number
  stamina: number
  state: FighterState
  stateT: number      // ticks left in the current state
  stateTotal: number  // ticks the current state started with (for progress)
  fresh: boolean      // state was set this tick; it does not tick down until next tick
  guard: boolean
  guardBroken: boolean
  punch: PunchKind
  /** 0..1 swing strength. Keyboard and bot punches are always 1; a phone swing scales it. */
  punchPower: number
  punchId: number
  resolved: boolean
  momentum: number
  dodgeKind: DodgeKind
  dodgeCd: number
  marks: number[]
  kdRound: number
  kdTotal: number
  thrown: number
  landed: number
  blocked: number
  dealtRound: number
  dealtTotal: number
  moving: number      // |vMove| this tick, for regen and render bob
}

export type SimEvent =
  | { kind: 'windup'; who: Side; punch: PunchKind; ticks: number }
  | { kind: 'punch'; who: Side; punch: PunchKind; result: 'hit' | 'blocked' | 'dodged' | 'whiff'; dmg: number; momentum: number }
  | { kind: 'dodge'; who: Side; dodge: DodgeKind }
  | { kind: 'stagger'; who: Side }
  | { kind: 'guard_break'; who: Side }
  | { kind: 'knockdown'; who: Side; ko: boolean }
  | { kind: 'count'; who: Side; n: number }
  | { kind: 'getup'; who: Side }
  | { kind: 'bell'; round: number; end: boolean }
  | { kind: 'countdown'; n: 3 | 2 | 1 | 0 }
  | { kind: 'ko'; who: Side }
  | { kind: 'gassed'; who: Side }
  | { kind: 'decision'; winner: Side | 'draw' }

export interface Flags { hitstop: number; shake: number; slowmo: boolean }
export type Phase = 'countdown' | 'fighting' | 'count' | 'rest' | 'decision' | 'over'

export interface BotParams {
  reactionTicks: number; reactionJitter: number
  blockP: number; dodgeP: number; duckP: number; counterP: number
  aggression: number; comboGap: number; patterns: PunchKind[][]; circleP: number; stepInP: number; comboRest: number
}

export interface MatchConfig { seed: number; rounds?: number; roundS?: number; restS?: number; botA?: BotParams | null; botB?: BotParams | null }

export interface FighterView {
  pos: V2; head: { x: number; y: number }; state: FighterState; progress: number; punch: PunchKind; dodge: DodgeKind
  hp: number; maxHp: number; stamina: number; guard: boolean; kd: number; moving: number; momentum: number
}
export interface Snapshot {
  tick: number; phase: Phase; round: number; clock: number; count: number
  dir: V2; dist: number; a: FighterView; b: FighterView
}
export interface MatchResult { winner: Side | 'draw'; by: 'ko' | 'decision' | 'draw'; round: number }
