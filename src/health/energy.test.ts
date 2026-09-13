import { describe, expect, it } from 'vitest'
import { ACTIVE_LOAD, formatActive, kcalPerMinute, metForLoad, praise, summarize, type Epoch } from './energy'

const sec = (t: number, mean: number, motionLoad?: number, swings = 0): Epoch => ({ t: t * 1000, mean, peak: mean * 3, swings, rotation: 0, motionLoad })
const seconds = (n: number, mean: number, load: number, from = 0): Epoch[] => Array.from({ length: n }, (_, i) => sec(from + i, mean, load))
describe('activity-epoch energy model', () => {
  it('maps MotionLoad monotonically through sport-specific exergame bands', () => {
    expect(metForLoad('boxing', 0)).toBe(1); expect(metForLoad('boxing', ACTIVE_LOAD)).toBeCloseTo(2.3)
    expect(metForLoad('boxing', .7)).toBeGreaterThan(metForLoad('boxing', .4)); expect(metForLoad('boxing', 1)).toBe(7.5)
    expect(metForLoad('bowling', 1)).toBeLessThan(metForLoad('boxing', 1))
  })
  it('uses the standard MET conversion and subtracts rest for active energy', () => {
    expect(kcalPerMinute(6, 70)).toBeCloseTo(7.35, 6)
    const s = summarize('boxing', seconds(60, 4, .7), [], 70)
    expect(s.kcal).toBeCloseTo((metForLoad('boxing', .7) - 1) * 3.5 * 70 / 200, 5)
  })
  it('does not invent absolute energy without optional weight', () => {
    const s = summarize('boxing', seconds(60, 4, .7), [], null)
    expect(s.kcal).toBeNull(); expect(s.energyConfidence).toBe('LOW')
  })
  it('never gives calories merely for swing count', () => {
    const noWeight = summarize('golf', [{ ...sec(0, .1, 0, 20) }], Array.from({ length: 20 }, () => 30), null)
    expect(noWeight.kcal).toBeNull()
    const weighted = summarize('golf', [{ ...sec(0, .1, 0, 20) }], Array.from({ length: 20 }, () => 30), 70)
    expect(weighted.kcal).toBe(0)
  })
  it('counts active seconds and qualifies a minute after twenty active epochs', () => {
    expect(summarize('golf', [...seconds(19, 3, .4), ...seconds(41, .1, 0, 19)], [], 70).activeMinutes).toBe(0)
    expect(summarize('golf', [...seconds(20, 3, .4), ...seconds(40, .1, 0, 20)], [], 70).activeMinutes).toBe(1)
  })
  it('keeps ROM contextual and movement trend deterministic', () => {
    const s = summarize('boxing', [...seconds(30, 5, .8), ...seconds(30, 2.5, .4, 30)], [80, 120, 100], 70)
    expect(s.romMean).toBe(100); expect(s.romMax).toBe(120); expect(s.fatigue).toBeCloseTo(.5)
  })
  it('formats active time and speaks to the active-minute goal', () => {
    expect(formatActive(754)).toBe('12:34'); expect(praise(null, 0, 0, 30)).toContain('active minutes')
    expect(praise(2, 20, 120, 30)).toContain('28 min')
  })
})
