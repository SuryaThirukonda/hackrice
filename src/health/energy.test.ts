import { describe, expect, it } from 'vitest'
import { ACTIVE_MEAN, DEFAULT_WEIGHT_KG, kcalPerMinute, metFor, summarize, type Epoch } from './energy'

const sec = (t: number, mean: number, peak = mean * 3, swings = 0, rotation = 0): Epoch => ({ t: t * 1000, mean, peak, swings, rotation })
const seconds = (n: number, mean: number, from = 0): Epoch[] => Array.from({ length: n }, (_, i) => sec(from + i, mean))

describe('energy model', () => {
  it('rests at one MET and climbs through the sport band with intensity', () => {
    expect(metFor('boxing', 0)).toBe(1)
    expect(metFor('boxing', ACTIVE_MEAN - 0.01)).toBe(1)
    expect(metFor('boxing', ACTIVE_MEAN)).toBeCloseTo(3, 6)
    expect(metFor('boxing', 99)).toBeCloseTo(6, 6) // clamped at the top of the band
    expect(metFor('golf', 3)).toBeGreaterThan(2.5); expect(metFor('golf', 3)).toBeLessThan(3.5)
  })
  it('uses the standard weight-based formula', () => {
    // 6 MET at 70 kg: 6 × 3.5 × 70 / 200 = 7.35 kcal/min
    expect(kcalPerMinute(6, 70)).toBeCloseTo(7.35, 6)
  })
  it('counts exact active seconds and minutes, and only estimates calories above rest', () => {
    // one minute moving hard, one minute still
    const epochs = [...seconds(60, 4), ...seconds(60, 0.1, 60)]
    const s = summarize('boxing', epochs, [], DEFAULT_WEIGHT_KG)
    expect(s.durationSeconds).toBe(120)
    expect(s.activeSeconds).toBe(60)
    expect(s.activeMinutes).toBe(1)
    // the still minute adds nothing; the moving minute adds (MET - 1) × 3.5 × 70 / 200
    const met = metFor('boxing', 4)
    expect(s.kcal).toBeCloseTo((met - 1) * 3.5 * 70 / 200, 5)
    expect(s.meanIntensity).toBeCloseTo(4, 6)
  })
  it('a minute needs twenty moving seconds to count as active', () => {
    const light = [...seconds(19, 3), ...seconds(41, 0.1, 19)]
    expect(summarize('golf', light, []).activeMinutes).toBe(0)
    const enough = [...seconds(20, 3), ...seconds(40, 0.1, 20)]
    expect(summarize('golf', enough, []).activeMinutes).toBe(1)
  })
  it('reads range of motion from the per-swing rotations and fatigue from the intensity trend', () => {
    const s = summarize('boxing', [...seconds(30, 5), ...seconds(30, 2.5, 30)], [80, 120, 100])
    expect(s.romMean).toBeCloseTo(100, 6); expect(s.romMax).toBe(120)
    expect(s.fatigue).toBeCloseTo(0.5, 6) // last third at 2.5 over first third at 5
    expect(summarize('boxing', seconds(6, 3), []).fatigue).toBe(1) // too short to say
  })
})
