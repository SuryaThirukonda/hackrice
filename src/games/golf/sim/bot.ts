import { Rng } from '../../boxing/sim/rng'
import { CLUBS, FULL_CLUBS } from './clubs'
import { LIE_MUL, ROLL_DECEL, PUTT_SPEED } from './flight'
import { surfaceAt } from './holes'
import { simulateShot } from './shot'
import type { BotParams, Club, Hole, Shot, V2, V3 } from './types'

export const TIERS: Record<'rookie' | 'pro' | 'champ', BotParams> = {
  // Holing is contact-based (no lip-out), so putting no longer separates the tiers much; the gap lives
  // in approach play. Every tier is still easier than the original (rookie 0.14/6, champ 0.02/0.8).
  rookie: { distNoise: 0.24, aimNoiseDeg: 11, greenSkill: 0.2, riskiness: 0.85 },
  pro: { distNoise: 0.11, aimNoiseDeg: 4.5, greenSkill: 0.55, riskiness: 0.55 },
  champ: { distNoise: 0.035, aimNoiseDeg: 1.2, greenSkill: 0.9, riskiness: 0.3 },
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
    // Water on the line: lay up short of it unless feeling risky, but only when laying up is a real
    // option. From a layup spot the same water is still ahead, and a bot that lays up again dribbles ten
    // metres at a time until the hole's stroke cap. So if the longest club clears the far bank, or the
    // layup would be a token step, the shot is played over the water.
    let target = d
    const reach = CLUBS.driver.carry * LIE_MUL[lie]
    let waterStart = -1, waterEnd = -1
    for (let s = 5; s < Math.min(d, reach * 1.1); s += 5) {
      const wet = surfaceAt(hole, { x: from.x + dx * s / d, z: from.z + dz * s / d }) === 'water'
      if (wet && waterStart < 0) waterStart = s
      if (!wet && waterStart >= 0) { waterEnd = s; break }
    }
    if (waterStart >= 0) {
      const canClear = waterEnd >= 0 && waterEnd + 10 <= reach
      const layup = waterStart - LAYUP_MARGIN
      if (!canClear && layup >= 30 && rng.next() > p.riskiness) target = layup
    }
    // Club by carry, then power by bisection on the deterministic preview.
    const plan = (want: number) => {
      let club: Club = 'driver'
      for (const c of [...FULL_CLUBS].reverse()) if (CLUBS[c].carry * LIE_MUL[lie] >= want) { club = c; break }
      let lo = 0.1, hi = 1, power = Math.min(1, want / (CLUBS[club].carry * LIE_MUL[lie]))
      let preview = simulateShot(hole, from, { club, aimDeg: aim, power, accuracy: 0 }, wind, new Rng(1))
      for (let i = 0; i < 7; i++) {
        const along = ((preview.end.x - from.x) * dx + (preview.end.z - from.z) * dz) / d
        if (along < want) lo = power; else hi = power
        power = (lo + hi) / 2
        preview = simulateShot(hole, from, { club, aimDeg: aim, power, accuracy: 0 }, wind, new Rng(1))
      }
      return { club, power, preview }
    }
    // A bot can see its own preview, so it never knowingly plays into water or out of bounds. An accurate
    // bot that did would replay the identical shot into the identical trouble until the stroke cap, since
    // an out-of-bounds ball is replayed from the same spot. Shorten until the preview ends dry.
    let chosen = plan(target)
    for (const k of [0.75, 0.5, 0.3]) {
      if (chosen.preview.outcome !== 'water' && chosen.preview.outcome !== 'ob') break
      chosen = plan(Math.max(10, target * k))
    }
    const power = Math.min(1, Math.max(0.05, chosen.power * (1 + rng.range(-1, 1) * p.distNoise)))
    return { club: chosen.club, aimDeg: aim + rng.range(-1, 1) * p.aimNoiseDeg, power, accuracy: 0 }
  }
}
