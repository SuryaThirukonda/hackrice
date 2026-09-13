import { describe, expect, it } from 'vitest'
import { motionLoad } from './motionLoad'
import { recoveryProgress } from './recovery'
import { buildPlayerState } from './playerState'
import { AdaptationEngine } from './adaptation'
import { SessionPlanner } from './sessionPlanner'
import { metricUsable } from './physiology'
import { tempoFlow } from './tempoFlow'
import type { Epoch } from '../health/energy'

const epoch = (mean: number, rotation = 0, swings = 0): Epoch => ({ t: 0, mean, peak: mean * 2, rotation, swings })
describe('wellness core', () => {
  it('makes MotionLoad deterministic, bounded, and monotonic for representative traces', () => {
    const still = motionLoad('boxing', epoch(0)), moderate = motionLoad('boxing', epoch(2, 80, 1)), hard = motionLoad('boxing', epoch(7, 500, 3))
    expect(still).toBe(0); expect(moderate).toBeGreaterThan(still); expect(hard).toBeGreaterThan(moderate); expect(hard).toBeLessThanOrEqual(1)
  })
  it('quality-gates physiology on validation, range, stability, confidence and freshness', () => {
    expect(metricUsable(72, 80, true, [40, 110], 'Ok', 1_000, 2_000)).toBe(true)
    expect(metricUsable(72, 80, false, [40, 110], 'Ok', 1_000, 2_000)).toBe(false)
    expect(metricUsable(72, 90, true, [40, 110], 'ExcessiveMotion', 1_000, 2_000)).toBe(false)
    expect(metricUsable(150, 90, true, [40, 110], 'Ok', 1_000, 2_000)).toBe(false)
    expect(metricUsable(72, 90, true, [40, 110], 'Ok', 1_000, 7_000)).toBe(false)
  })
  it('calculates recovery only from a meaningful personal baseline delta', () => {
    expect(recoveryProgress({ baselinePulse: 70, postActivityPulse: 100, currentPulse: 85, sampleAt: 1_000, now: 2_000, valid: true })).toBeCloseTo(.5)
    expect(recoveryProgress({ baselinePulse: 70, postActivityPulse: 74, currentPulse: 72, sampleAt: 1_000, now: 2_000, valid: true })).toBeNull()
  })
  it('falls back without physiology and keeps adaptation deterministic and bounded', () => {
    const p = buildPlayerState({ performance: .8, motionIntensity: .6, engagement: .9, consistency: .7, recovery: null })
    const e = new AdaptationEngine(), d = e.decide(p, 'boxing')
    expect(p.sources.physiology).toBe(false); expect(d.reasonCode).toBe('strong_performance_movement'); expect(e.apply(.99, d)).toBeLessThanOrEqual(1)
  })
  it('plans deterministic goal-appropriate sessions', () => {
    const p = new SessionPlanner(); expect(p.plan('energize', 10)).toEqual(p.plan('energize', 10))
    expect(p.plan('energize', 10).filter((x) => x.sport === 'boxing').length).toBeGreaterThan(p.plan('reset', 10).filter((x) => x.sport === 'boxing').length)
  })
  it('applies a boundary decision next-sport bias without changing the stored plan', () => {
    tempoFlow.start('energize', 10); const plan = JSON.stringify(tempoFlow.plan); expect(tempoFlow.nextSport()).toBe('boxing')
    const segment = tempoFlow.addSegment('boxing', null, .5, .5)
    segment.decision = { difficultyDelta: -.03, recoverySecondsDelta: 10, nextSportBias: 'bowling', reasonCode: 'low_performance_high_movement' }
    expect(tempoFlow.peekNextSport()).toBe('bowling'); expect(tempoFlow.nextSport()).toBe('bowling')
    expect(JSON.stringify(tempoFlow.plan)).toBe(plan)
  })
  it('starts a single-sport session from Ready-Up without the intent maze', () => {
    tempoFlow.startSport('boxing')
    expect(tempoFlow.selectedSport).toBe('boxing')
    expect(tempoFlow.nextSport()).toBe('boxing')
    expect(tempoFlow.readyToStart).toBe(false)
    tempoFlow.controllerMode = 'keyboard'
    expect(tempoFlow.readyToStart).toBe(true)
  })
})
