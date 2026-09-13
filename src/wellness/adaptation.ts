import type { HealthSport } from '../health/energy'
import type { PlayerState } from './playerState'

export type AdaptationReason = 'strong_performance_good_recovery' | 'high_exertion_limited_recovery' | 'low_performance_high_exertion' | 'movement_only_progress' | 'steady_course'
export interface AdaptationDecision { difficultyDelta: number; recoverySecondsDelta: number; nextSportBias?: HealthSport; reasonCode: AdaptationReason }
const round = (v: number): number => Math.round(v * 100) / 100

export class AdaptationEngine {
  decide(p: PlayerState, sport: HealthSport): AdaptationDecision {
    if (p.performance >= .72 && p.recovery !== null && p.recovery >= .6 && p.exertion <= .85) return { difficultyDelta: .05, recoverySecondsDelta: -5, reasonCode: 'strong_performance_good_recovery' }
    if (p.exertion >= .75 && (p.recovery === null || p.recovery < .4)) return { difficultyDelta: 0, recoverySecondsDelta: 15, nextSportBias: sport === 'boxing' ? 'bowling' : 'golf', reasonCode: 'high_exertion_limited_recovery' }
    if (p.performance < .4 && p.exertion >= .55) return { difficultyDelta: -.05, recoverySecondsDelta: 10, nextSportBias: 'golf', reasonCode: 'low_performance_high_exertion' }
    if (!p.sources.physiology && p.performance >= .7 && p.motionIntensity >= .45) return { difficultyDelta: .03, recoverySecondsDelta: 0, reasonCode: 'movement_only_progress' }
    return { difficultyDelta: 0, recoverySecondsDelta: 0, reasonCode: 'steady_course' }
  }
  apply(current: number, d: AdaptationDecision): number { return round(Math.max(0, Math.min(1, current + Math.max(-.1, Math.min(.1, d.difficultyDelta))))) }
}

export const adaptationCopy = (r: AdaptationReason): string => ({
  strong_performance_good_recovery: 'You performed strongly and recovered toward your starting pulse. Tempo is turning it up.',
  high_exertion_limited_recovery: 'That was a demanding segment. Tempo is holding challenge and giving you more recovery.',
  low_performance_high_exertion: 'Tempo is easing the next challenge so you can keep moving with control.',
  movement_only_progress: 'Strong movement and game performance earned a small challenge increase.',
  steady_course: 'Your challenge is staying steady for the next segment.',
})[r]

