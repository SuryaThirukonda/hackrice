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
/** Ticks at 120 Hz. A punch resolves on its first active tick against the guard as it stands then, so the
 *  wind-up is the defender's whole window to block. 18 ticks (150 ms) for the jab and 32 (about 267 ms) for the
 *  cross: slow enough that a quick guard catches a jab and a guard raised on reaction catches a cross. They were
 *  12 and 24, which left a jab blockable only by guessing. Recovery, damage and costs are unchanged. */
export const FRAME: Record<PunchKind, FrameData> = {
  jab: { windup: 18, active: 6, recover: 24, reach: 1.2, dmg: 6, stamina: 9, blockCost: 4, knock: 0.9, hitstun: 10 },
  cross: { windup: 32, active: 8, recover: 40, reach: 1.3, dmg: 12, stamina: 16, blockCost: 8, knock: 1.8, hitstun: 18 },
}
export const CANCEL_WINDOW = 6 // recover ticks left in which a new punch may start

// damage model
export const MOMENTUM_DMG = 0.5
export const MOMENTUM_KNOCK = 0.6
export const STAGGER_BONUS = 1.25
export const BLOCK_DMG_MUL = 0.15
export const BLOCK_KNOCK_MUL = 0.35
/** A held guard still refills, at this fraction of the resting rate. Blocking a punch is what costs
 *  stamina (each absorbed punch's blockCost), holding the guard up is not. */
export const REGEN_GUARD_MUL = 0.5
/** Long enough that a guard broken by a cross can still be punished: the attacker's quickest jab lands 44 to 48
 *  ticks after the break. It grew from 60 by the 6 ticks the jab wind-up gained, which keeps that window intact. */
export const GUARD_BREAK_STAGGER = 66
export const GUARD_RECOVER_STAMINA = 15
export const STAGGER_DMG = 11
export const STAGGER_TICKS = 42

// dodge
export const DODGE_TICKS = 30
export const DODGE_IFRAMES = 22 // ticks 0..21 are invulnerable
export const DODGE_COOLDOWN = 54
export const DODGE_STAMINA = 4
/** Stamina handed back when a dodge actually evades a punch: more than the dodge cost, so reading the
 *  opponent is rewarded and a defensive fighter is never the one who runs dry. */
export const DODGE_REWARD = 12
export const SWAY_SLIDE = 1.0
export const HEAD_SWAY = 0.35
export const HEAD_DUCK = 0.35
export const HEAD_LERP = 0.25

// stamina
export const STAMINA_MAX = 100
/** Per second, in every state except the punch itself (windup, active, recover) and being down. Moving costs
 *  nothing; only punches, absorbed blocks and dodges spend stamina. Empty to full in two and a half seconds. */
export const REGEN_IDLE = 40
export const FATIGUE_KNEE = 30
export const GETUP_STAMINA = 40
export const REST_STAMINA = 45

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
/** Bot-controlled fighters (the House, both Fight Night corners) start with more health so their fights run longer.
 *  Their knockdown marks scale with it, so a knockdown still lands at the same fraction of the bar. */
export const BOT_HP_MAX = 120

// feel flags
export const HITSTOP: Record<PunchKind, number> = { jab: 0, cross: 4 }
export const HITSTOP_STAGGER = 8
export const SHAKE: Record<PunchKind, number> = { jab: 0.25, cross: 0.6 }
