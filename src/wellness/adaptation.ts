import type { HealthSport } from '../health/energy'
import type { PlayerState } from './playerState'

/**
 * Simplified consumer adaptation: PERFORMANCE + MOVEMENT, with optional recovery as a small bonus.
 * Total change clamped to roughly ±5%.
 */
export type AdaptationReason =
  | 'strong_performance_good_recovery'
  | 'strong_performance_movement'
  | 'low_performance_high_movement'
  | 'steady_course'

export interface AdaptationDecision {
  difficultyDelta: number
  recoverySecondsDelta: number
  nextSportBias?: HealthSport
  reasonCode: AdaptationReason
}

const round = (v: number): number => Math.round(v * 100) / 100
const clampDelta = (d: number): number => Math.max(-.05, Math.min(.05, d))

export class AdaptationEngine {
  decide(p: PlayerState, sport: HealthSport): AdaptationDecision {
    let delta = 0
    let reason: AdaptationReason = 'steady_course'
    let recoverySecondsDelta = 0
    let nextSportBias: HealthSport | undefined

    if (p.performance >= .7 && p.motionIntensity >= .45) {
      delta = .03
      reason = 'strong_performance_movement'
    } else if (p.performance < .4 && p.motionIntensity >= .55) {
      delta = -.03
      reason = 'low_performance_high_movement'
      recoverySecondsDelta = 10
      nextSportBias = sport === 'boxing' ? 'bowling' : 'golf'
    }

    if (p.recovery !== null && p.recovery >= .6 && delta > 0) {
      delta += .02
      reason = 'strong_performance_good_recovery'
      recoverySecondsDelta = -5
    }

    return { difficultyDelta: clampDelta(delta), recoverySecondsDelta, nextSportBias, reasonCode: reason }
  }

  apply(current: number, d: AdaptationDecision): number {
    return round(Math.max(0, Math.min(1, current + clampDelta(d.difficultyDelta))))
  }
}

export const adaptationCopy = (r: string): string | null => {
  const map: Record<string, string> = {
    strong_performance_good_recovery: 'Strong play and a solid recovery — Tempo adds a little challenge.',
    strong_performance_movement: 'Good performance and movement earned a small challenge bump.',
    low_performance_high_movement: 'Tempo eases the next challenge so you can keep moving with control.',
    steady_course: 'Your challenge stays steady for the next segment.',
    // Legacy reason codes from earlier sessions
    movement_only_progress: 'Strong movement and game performance earned a small challenge increase.',
    high_exertion_limited_recovery: 'That was a demanding segment. Tempo is holding challenge.',
    low_performance_high_exertion: 'Tempo is easing the next challenge so you can keep moving with control.',
  }
  return map[r] ?? null
}
