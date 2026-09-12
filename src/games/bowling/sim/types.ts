export type Side = 'a' | 'b'
export type Phase = 'aim' | 'rolling' | 'settle' | 'frame_end' | 'game_end'
export type BallNo = 1 | 2 | 3
export interface V2 { x: number; z: number }

/** One delivery. lanePos in metres (-0.45..0.45), angleDeg (-4..4, + is toward +x), power 0..1, hook -1..1. */
export interface Shot { lanePos: number; angleDeg: number; power: number; hook: number }

/** Anything the disc solver moves: position and velocity in the lane frame. */
export interface Body { x: number; z: number; vx: number; vz: number }
export interface Pin extends Body {
  index: number; spot: V2
  down: boolean; removed: boolean; hit: boolean; maxSpeed: number
}
export interface Ball extends Body { hook: number; gutter: boolean; moving: boolean }

export type BowlingEvent =
  | { kind: 'roll_start'; player: Side; frame: number; ball: BallNo; shot: Shot; sway: number }
  | { kind: 'gutter' }
  | { kind: 'pin_hit'; pin: number }
  | { kind: 'pins_down'; count: number }
  | { kind: 'strike'; player: Side }
  | { kind: 'spare'; player: Side }
  | { kind: 'frame_end'; player: Side; frame: number; score: number }
  | { kind: 'game_end'; winner: Side | 'draw'; totals: Record<Side, number> }

export interface BotParams { aimNoiseDeg: number; powerNoise: number; hookSkill: number; spareSkill: number; timing: number /* 0..1: how close to the sway's centre the bot waits to release */ }
export interface GameConfig { seed: number; botA?: BotParams | null; botB?: BotParams | null }

export interface FrameScore { rolls: number[]; score: number | null }
export interface Scoreboard { frames: FrameScore[]; total: number }

export interface PinView { index: number; x: number; z: number; standing: boolean; down: boolean }
export interface Snapshot {
  tick: number; phase: Phase; current: Side; frame: number; ball: BallNo
  ballPos: V2; ballVel: V2; gutter: boolean
  pins: PinView[]; standing: number; scoreboard: Record<Side, Scoreboard>
  sway: number // degrees added to the release angle right now (frozen once locked)
  swayLocked: boolean
}
