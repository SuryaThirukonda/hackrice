import { describe, expect, it } from 'vitest'
import { HealthStore } from './health'
import type { Epoch } from '../src/health/energy'

const sec = (t: number, mean: number, swings = 0): Epoch => ({ t: t * 1000, mean, peak: mean * 3, swings, rotation: 0 })
const minute = (mean: number, from = 0): Epoch[] => Array.from({ length: 60 }, (_, i) => sec(from + i, mean))

describe('HealthStore', () => {
  it('records a session, recomputes its summary on finish, and rolls it into the day and sport totals', () => {
    const db = new HealthStore(':memory:')
    const t0 = Date.parse('2026-09-12T18:00:00')
    const id = db.start({ sport: 'boxing', controller: 'controller_1', startedAt: t0, weightKg: 70, source: 'phone' })
    db.add(id, minute(4), [90, 110])
    db.add(id, minute(0.2, 60), [])
    const row = db.finish(id, t0 + 120_000)
    expect(row).toMatchObject({ id, sport: 'boxing', durationMs: 120_000, activeSeconds: 60, activeMinutes: 1, swings: 0, romMean: 100, romMax: 110 })
    expect(row!.kcal).toBeGreaterThan(0)
    const s = db.summary(t0 + 3_600_000, 7)
    expect(s.today.sessions).toBe(1); expect(s.today.activeSeconds).toBe(60)
    expect(s.bySport.boxing.sessions).toBe(1); expect(s.bySport.golf.sessions).toBe(0)
    expect(s.days).toHaveLength(7); expect(s.streakDays).toBe(1)
    expect(s.lastSession?.epochs).toHaveLength(120)
    db.close()
  })
  it('ignores a duplicate epoch delivered twice, so a retried post cannot double the calories', () => {
    const db = new HealthStore(':memory:')
    const id = db.start({ sport: 'golf', controller: 'controller_1', startedAt: 0, weightKg: 70, source: 'phone' })
    db.add(id, minute(3), [])
    db.add(id, minute(3), []) // same seconds again
    expect(db.finish(id, 60_000)!.activeSeconds).toBe(60)
    db.close()
  })
  it('a keyboard session stores as such, with no movement and no calories', () => {
    const db = new HealthStore(':memory:')
    const id = db.start({ sport: 'bowling', controller: 'keyboard', startedAt: 0, weightKg: 70, source: 'keyboard' })
    const row = db.finish(id, 300_000)!
    expect(row.source).toBe('keyboard'); expect(row.kcal).toBe(0); expect(row.activeSeconds).toBe(0)
    db.close()
  })
  it('keeps active energy unknown without optional weight and persists normalized motion load', () => {
    const db = new HealthStore(':memory:')
    const id = db.start({ sport: 'boxing', controller: 'controller_1', startedAt: 0, weightKg: null, source: 'phone' })
    db.add(id, [{ ...sec(0, 1), accelRms: 5, gyroRms: 260, activeFraction: .8, actionPower: .7 }], [84])
    const row = db.finish(id, 1000)!
    expect(row.weightKg).toBeNull(); expect(row.kcal).toBeNull(); expect(row.energyConfidence).toBe('LOW')
    expect(row.motionLoad).toBeGreaterThan(.5)
    expect(db.epochs(id)[0].motionLoad).toBeCloseTo(row.motionLoad)
    db.close()
  })
  it('stores and exposes the latest deterministic adaptation decision', () => {
    const db = new HealthStore(':memory:')
    const id = db.start({ sport: 'golf', controller: 'controller_1', startedAt: 0, weightKg: null, source: 'phone' })
    const player = { performance: .8, motionIntensity: .6, exertion: .65, recovery: .7, consistency: .8, engagement: .75, physiologyConfidence: .8, sources: { motion: true, performance: true, physiology: true }, timestamp: 1000 }
    db.addAdaptation(id, 1000, player, .5, .55, { difficultyDelta: .05, recoverySecondsDelta: -5, reasonCode: 'strong_performance_good_recovery' })
    expect(db.latestAdaptation()).toEqual({ sessionId: id, at: 1000, previousDifficulty: .5, newDifficulty: .55, reasonCode: 'strong_performance_good_recovery' })
    db.close()
  })
  it('clear wipes everything', () => {
    const db = new HealthStore(':memory:')
    const id = db.start({ sport: 'boxing', controller: 'controller_1', startedAt: 0, weightKg: 70, source: 'phone' })
    db.add(id, minute(4), [50]); db.finish(id, 60_000)
    db.clear()
    expect(db.sessions()).toEqual([]); expect(db.summary(0).today.sessions).toBe(0)
    db.close()
  })
})
