import type { Epoch, HealthSport } from '../health/energy'

export interface MotionLoadWeights {
  acceleration: number
  rotation: number
  activeFraction: number
  actionFrequency: number
  actionPower: number
  rangeOfMotion: number
}

/** Explicit sport-specific weights. Boxing rewards sustained motion; bowling and golf emphasize the
 * brief, deliberate action without pretending the downtime has the same load. */
export const MOTION_LOAD_WEIGHTS: Record<HealthSport, MotionLoadWeights> = {
  boxing: { acceleration: .28, rotation: .20, activeFraction: .25, actionFrequency: .14, actionPower: .08, rangeOfMotion: .05 },
  bowling: { acceleration: .20, rotation: .22, activeFraction: .12, actionFrequency: .18, actionPower: .18, rangeOfMotion: .10 },
  golf: { acceleration: .18, rotation: .22, activeFraction: .10, actionFrequency: .18, actionPower: .20, rangeOfMotion: .12 },
}

const c01 = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
const scale = (v: number, low: number, high: number): number => c01((v - low) / (high - low))

/** Deterministic load in [0,1]. Inputs are normalized against conservative phone-motion ceilings. */
export function motionLoad(sport: HealthSport, epoch: Epoch): number {
  const w = MOTION_LOAD_WEIGHTS[sport]
  const accel = scale(epoch.accelRms ?? epoch.mean, .35, 6)
  const rotation = scale(epoch.gyroRms ?? epoch.rotation, 15, 450)
  const active = c01(epoch.activeFraction ?? (epoch.mean >= .8 ? 1 : epoch.mean / .8))
  const frequency = c01(epoch.swings / 3)
  const power = c01(epoch.actionPower ?? (epoch.swings ? epoch.peak / 18 : 0))
  const rom = c01(epoch.rotation / 360)
  return c01(accel * w.acceleration + rotation * w.rotation + active * w.activeFraction + frequency * w.actionFrequency + power * w.actionPower + rom * w.rangeOfMotion)
}

