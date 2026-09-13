import { AIM_MAX_X, BALL_START_Z, PIN_Z, POCKET_X, SHOT_LIMITS, SPEED_MAX, SPEED_MIN } from './constants'
import { stepBall } from './physics'
import type { Rng } from '../../boxing/sim/rng'
import type { Ball, BallNo, BotParams, Pin, Shot } from './types'

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const releaseSpeed = (power: number): number => SPEED_MIN + (SPEED_MAX - SPEED_MIN) * clamp(power, 0, 1)

/** Lateral drift at the head pin produced by the hook alone (no pins, straight release from x = 0). */
export function hookDrift(hook: number, power: number): number {
  const b: Ball = { x: 0, z: BALL_START_Z, vx: 0, vz: releaseSpeed(power), hook, gutter: false, moving: true }
  while (b.moving && b.z < PIN_Z) stepBall(b, [])
  return b.x
}

/** Shot whose ball centre arrives at targetX at the head pin, compensating for hook; overflow goes into the angle. */
export function aimShot(targetX: number, hook = 0, power = 0.75): Shot {
  const want = clamp(targetX, -AIM_MAX_X, AIM_MAX_X) - hookDrift(hook, power)
  const lanePos = clamp(want, -AIM_MAX_X, AIM_MAX_X)
  const angleDeg = clamp((Math.atan2(want - lanePos, PIN_Z - BALL_START_Z) * 180) / Math.PI, -SHOT_LIMITS.angleDeg, SHOT_LIMITS.angleDeg)
  return { lanePos, angleDeg, power, hook }
}

/** The right-hander's 1-3 pocket ball. */
export const pocketShot = (hook = 0.6, power = 0.75): Shot => aimShot(POCKET_X, hook, power)

export const TIERS: Record<'rookie' | 'pro' | 'champ', BotParams> = {
  rookie: { aimNoiseDeg: 1.5, powerNoise: 0.2, hookSkill: 0.05, spareSkill: 0.2, timing: 0.14 },
  pro: { aimNoiseDeg: 0.65, powerNoise: 0.11, hookSkill: 0.45, spareSkill: 0.5, timing: 0.45 },
  // The champ's release timing stays where it was: the suite pins how close to centre a champ releases,
  // and anything looser fails it. Aim, power, hook and spare skill are all softer than before.
  champ: { aimNoiseDeg: 0.22, powerNoise: 0.045, hookSkill: 0.85, spareSkill: 0.86, timing: 0.92 },
}

/** Deterministic opponent: pocket ball on a full rack, centroid of the standing pins otherwise, seeded noise on top. */
export class BowlingBot {
  p: BotParams
  constructor(p: BotParams) { this.p = p }

  /** How far (degrees) from the sway's centre this bot is willing to release. Rookies barely wait; champs wait for the centre. */
  releaseTolerance(ampDeg: number): number { return ampDeg * 1.05 - (ampDeg * 1.05 - 0.12) * clamp(this.p.timing, 0, 1) }

  decide(standing: readonly Pin[], _frame: number, _ball: BallNo, rng: Rng): Shot {
    const p = this.p
    let shot: Shot, noise: number
    if (standing.length === 10) {
      const skilled = p.hookSkill >= 0.5
      shot = skilled ? pocketShot(0.6, 0.75) : aimShot(0.1, 0, 0.75)
      noise = p.aimNoiseDeg
    } else {
      const cx = standing.reduce((s, q) => s + q.x, 0) / standing.length
      shot = aimShot(cx, 0, 0.7)
      noise = p.aimNoiseDeg * (1.5 - p.spareSkill)
    }
    shot.angleDeg = clamp(shot.angleDeg + rng.range(-noise, noise), -SHOT_LIMITS.angleDeg, SHOT_LIMITS.angleDeg)
    shot.power = clamp(shot.power + rng.range(-p.powerNoise, p.powerNoise), 0, 1)
    return shot
  }
}
