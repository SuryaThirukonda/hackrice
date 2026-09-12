import type { PunchKind } from './types'

export const HZ = 120
export const DT = 1 / HZ
export const ticks = (seconds: number): number => Math.round(seconds * HZ)

// ring and bodies (metres)
export const RING_HALF = 3.0
export const BODY_GAP = 0.9
export const EYE_H = 1.65
export const START_DIST = 1.9

// movement
export const MOVE_FWD = 1.6
export const MOVE_BACK = 1.2
export const MOVE_STRAFE = 1.3
export const GUARD_MOVE_MUL = 0.6
export const PUNCH_CARRY = 0.6
export const FRICTION = 6
export const KNOCK_EPS = 0.01

export interface FrameData { windup: number; active: number; recover: number; reach: number; dmg: number; stamina: number; blockCost: number; knock: number; hitstun: number }
export const FRAME: Record<PunchKind, FrameData> = {
  jab: { windup: 12, active: 6, recover: 24, reach: 1.2, dmg: 6, stamina: 5, blockCost: 4, knock: 0.9, hitstun: 10 },
  cross: { windup: 24, active: 8, recover: 40, reach: 1.3, dmg: 12, stamina: 10, blockCost: 8, knock: 1.8, hitstun: 18 },
}
export const CANCEL_WINDOW = 6 // recover ticks left in which a new punch may start

// damage model
export const MOMENTUM_DMG = 0.5
export const MOMENTUM_KNOCK = 0.6
export const STAGGER_BONUS = 1.25
export const BLOCK_DMG_MUL = 0.15
export const BLOCK_KNOCK_MUL = 0.35
export const BLOCK_HOLD_DRAIN = 2 // stamina per second while guard is up
export const GUARD_BREAK_STAGGER = 60
export const GUARD_RECOVER_STAMINA = 15
export const STAGGER_DMG = 11
export const STAGGER_TICKS = 42

// dodge
export const DODGE_TICKS = 30
export const DODGE_IFRAMES = 22 // ticks 0..21 are invulnerable
export const DODGE_COOLDOWN = 54
export const DODGE_STAMINA = 4
export const SWAY_SLIDE = 1.0
export const HEAD_SWAY = 0.35
export const HEAD_DUCK = 0.35
export const HEAD_LERP = 0.25

// stamina
export const STAMINA_MAX = 100
export const REGEN_IDLE = 8
export const REGEN_FAST = 3
export const FATIGUE_KNEE = 30
export const GETUP_STAMINA = 40
export const REST_STAMINA = 30

// rounds and knockdowns
export const ROUNDS = 3
export const ROUND_S = 90
export const REST_S = 8
export const COUNTDOWN_STEP = ticks(1)
export const COUNT_TICKS = ticks(1)
export const GETUP_COUNT = 8
export const KD_MARKS = [60, 30]
export const KD_LIMIT_ROUND = 3
export const GETUP_TICKS = 30
export const HP_MAX = 100

// feel flags
export const HITSTOP: Record<PunchKind, number> = { jab: 0, cross: 4 }
export const HITSTOP_STAGGER = 8
export const SHAKE: Record<PunchKind, number> = { jab: 0.25, cross: 0.6 }
