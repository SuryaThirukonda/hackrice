import { describe, expect, it } from 'vitest'
import { formatEstimatedEnergy, formatEstimatedEnergyLine, movementIntensity, sessionRomLabel } from './display'
import { displayToKg, formatWeightLabel, kgToDisplay, parseWeightInput } from './weightInput'
import { ExpressionAggregator, normalizeExpressionKey } from '../wellness/expressions'
import { pulseTier } from '../wellness/presageQuality'
import { headMotionDelta, withHeadMotionBoost } from '../wellness/headMotion'
import { HealthStore } from '../../server/health'
import { summarize } from './energy'

describe('estimated active energy display', () => {
  it('never renders positive sub-1 kcal as ~0', () => {
    expect(formatEstimatedEnergy(0.4).value).toBe('<1')
    expect(formatEstimatedEnergy(1.25).value).toBe('1.3')
    expect(formatEstimatedEnergy(12.4).value).toBe('12')
    expect(formatEstimatedEnergy(null).value).toBe('NOT ESTIMATED')
    expect(formatEstimatedEnergyLine(0.2)).toContain('<1')
    expect(formatEstimatedEnergyLine(null)).toBe('NOT ESTIMATED')
  })
})

describe('movement intensity', () => {
  it('maps MotionLoad to LOW / MODERATE / HIGH bands', () => {
    expect(movementIntensity(0.1)).toBe('LOW')
    expect(movementIntensity(0.3)).toBe('MODERATE')
    expect(movementIntensity(0.7)).toBe('HIGH')
  })
})

describe('session ROM labels', () => {
  it('is sport-specific and omits empty ROM', () => {
    expect(sessionRomLabel('golf', 118, 140, 8)).toEqual({ label: 'Swing ROM', degrees: 118 })
    expect(sessionRomLabel('bowling', 74, 90, 5)).toEqual({ label: 'Average Swing ROM', degrees: 74 })
    expect(sessionRomLabel('boxing', 80, 96, 12)).toEqual({ label: 'Peak Punch Arc', degrees: 96 })
    expect(sessionRomLabel('golf', 0, 0, 0)).toBeNull()
  })
})

describe('body weight input', () => {
  it('parses decimals, converts units, rejects junk', () => {
    expect(parseWeightInput('75.0', 'kg')).toEqual({ ok: true, kg: 75 })
    const lb = parseWeightInput('165', 'lb')
    expect(lb.ok).toBe(true)
    if (lb.ok && lb.kg !== null) expect(lb.kg).toBe(Math.round(displayToKg(165, 'lb') * 10) / 10)
    expect(parseWeightInput('nope', 'kg').ok).toBe(false)
    expect(parseWeightInput('5', 'kg').ok).toBe(false)
    expect(parseWeightInput('', 'kg')).toEqual({ ok: true, kg: null })
    expect(formatWeightLabel(70, 'lb')).toContain('lb')
    expect(kgToDisplay(70, 'kg')).toBe(70)
  })
})

describe('historical energy recompute', () => {
  it('recomputes kcal from epochs when weight becomes available later', () => {
    const store = new HealthStore(':memory:')
    const id = store.start({ sport: 'boxing', controller: 'c1', startedAt: 1_000, weightKg: null, source: 'phone' })
    const epochs = Array.from({ length: 30 }, (_, i) => ({ t: i * 1000, mean: 4, peak: 8, swings: 1, rotation: 40, motionLoad: 0.6 }))
    store.add(id, epochs, [90, 100])
    store.finish(id, 40_000, 'phone')
    const without = store.summary(50_000, 7, null)
    expect(without.lastSession?.kcal).toBeNull()
    const withWeight = store.summary(50_000, 7, 70)
    expect(withWeight.lastSession?.kcal).toBeGreaterThan(0)
    // Recompute uses stored epoch loads (derived on insert), not the client-side motionLoad field.
    const stored = store.epochs(id)
    expect(withWeight.lastSession?.kcal).toBeCloseTo(summarize('boxing', stored, [], 70).kcal!, 5)
    store.close()
  })
})

describe('expression aggregation', () => {
  it('maps SDK short names and gates coverage / mixed dominance', () => {
    expect(normalizeExpressionKey('happy')).toBe('happiness')
    expect(normalizeExpressionKey('angry')).toBe('anger')
    const a = new ExpressionAggregator()
    for (let i = 0; i < 10; i++) a.sample(1, false, null)
    expect(a.summary().dominant).toBeNull()
    for (let i = 0; i < 20; i++) a.sample(1, true, { happy: 0.42, contempt: 0.40, neutral: 0.18 })
    const close = a.summary()
    expect(close.coverage).toBeGreaterThan(0.5)
    expect(close.mixed || close.dominant === null).toBe(true)
    const b = new ExpressionAggregator()
    for (let i = 0; i < 20; i++) b.sample(1, true, { happy: 0.7, neutral: 0.3 })
    expect(b.summary().dominant).toBe('happiness')
    expect(b.liveExpression()).toBe('happiness')
  })
})

describe('presage displayable vs trusted', () => {
  it('allows estimating unstable pulse without trusting it', () => {
    const now = 1_000_000
    expect(pulseTier(82, 30, false, 'Ok', now - 500, now)).toBe('estimating')
    expect(pulseTier(82, 80, true, 'Ok', now - 500, now)).toBe('trusted')
    expect(pulseTier(82, 80, true, 'NoFaceFound', now - 500, now)).toBe('none')
  })
})

describe('head motion boost', () => {
  it('only nudges boxing load within a small cap', () => {
    expect(headMotionDelta({ x: 0.5, y: 0.4 }, { x: 0.52, y: 0.41 })).toBeGreaterThan(0)
    expect(withHeadMotionBoost(0.4, 1, 'boxing')).toBeCloseTo(0.46, 5)
    expect(withHeadMotionBoost(0.4, 1, 'golf')).toBe(0.4)
  })
})
