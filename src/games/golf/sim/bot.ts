import { Rng } from '../../boxing/sim/rng'
import { CLUBS, FULL_CLUBS } from './clubs'
import { LIE_MUL, ROLL_DECEL, PUTT_SPEED } from './flight'
import { surfaceAt } from './holes'
import { simulateShot } from './shot'
import type { BotParams, Club, Hole, Shot, V2, V3 } from './types'

export const TIERS: Record<'rookie' | 'pro' | 'champ', BotParams> = {
  rookie: { distNoise: 0.14, aimNoiseDeg: 6, greenSkill: 0.3, riskiness: 0.8 },
  pro: { distNoise: 0.06, aimNoiseDeg: 2.5, greenSkill: 0.7, riskiness: 0.5 },
  champ: { distNoise: 0.02, aimNoiseDeg: 0.8, greenSkill: 0.97, riskiness: 0.3 },
}
const LAYUP_MARGIN = 25
const PUTT_FROM_FAIRWAY = 20

/** Deterministic opponent: club by carry, power refined on the shot preview, then tier noise on aim and power. */
export class GolfBot {
  p: BotParams
  constructor(p: BotParams) { this.p = p }
  setParams(p: BotParams): void { this.p = p }

  decide(hole: Hole, from: V3, wind: V2, rng: Rng): Shot {
    const p = this.p, lie = surfaceAt(hole, from)
    const dx = hole.cup.x - from.x, dz = hole.cup.z - from.z, d = Math.hypot(dx, dz)
    const aim = Math.atan2(dx, dz) * 180 / Math.PI
    if (lie === 'green' || (lie === 'fairway' && d <= PUTT_FROM_FAIRWAY)) {
      const v0 = Math.sqrt(2 * ROLL_DECEL[lie] * (d + 0.5)) / LIE_MUL[lie]
      const power = (v0 / PUTT_SPEED) * (1 + rng.range(-1, 1) * 0.25 * (1 - p.greenSkill))
      return { club: 'putter', aimDeg: aim + rng.range(-1, 1) * 1.5 * (1 - p.greenSkill), power: Math.min(1, power), accuracy: 0 }
    }
    // lay up short of water that the shot could reach, unless feeling risky
    let target = d
    for (let s = 5; s < Math.min(d, CLUBS.driver.carry * LIE_MUL[lie] * 1.1); s += 5) {
      if (surfaceAt(hole, { x: from.x + dx * s / d, z: from.z + dz * s / d }) !== 'water') continue
      if (rng.next() > p.riskiness) target = Math.max(10, s - LAYUP_MARGIN)
      break
    }
    let club: Club = 'driver'
    for (const c of [...FULL_CLUBS].reverse()) if (CLUBS[c].carry * LIE_MUL[lie] >= target) { club = c; break }
    let lo = 0.1, hi = 1, power = Math.min(1, target / (CLUBS[club].carry * LIE_MUL[lie]))
    for (let i = 0; i < 7; i++) {
      const r = simulateShot(hole, from, { club, aimDeg: aim, power, accuracy: 0 }, wind, new Rng(1))
      const along = ((r.end.x - from.x) * dx + (r.end.z - from.z) * dz) / d
      if (along < target) lo = power; else hi = power
      power = (lo + hi) / 2
    }
    power = Math.min(1, Math.max(0.05, power * (1 + rng.range(-1, 1) * p.distNoise)))
    return { club, aimDeg: aim + rng.range(-1, 1) * p.aimNoiseDeg, power, accuracy: 0 }
  }
}
