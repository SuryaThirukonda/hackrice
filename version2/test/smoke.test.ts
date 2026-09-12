import { describe, expect, it } from 'vitest'
import { BoxingMatch } from '../src/games/boxing/sim/match'
import { TIERS as BOX_TIERS } from '../src/games/boxing/sim/tiers'
import { BowlingGame, TIERS as BOWL_TIERS } from '../src/games/bowling/sim'
import { GolfRound, TIERS as GOLF_TIERS } from '../src/games/golf/sim'
import { boxingParams, bowlingParams, golfParams, PRESETS } from '../src/agent/sliders'

/** One full bot-vs-bot game per sport, plus the slider mappings, as the headless release gate. */
describe('smoke: every sport plays to the end headlessly', () => {
  it('boxing', () => {
    const m = new BoxingMatch({ seed: 2026, botA: BOX_TIERS.pro, botB: BOX_TIERS.champ, roundS: 30, restS: 1 })
    let n = 0
    while (!m.over && n++ < 120 * 400) m.step()
    expect(m.over).toBe(true)
  })
  it('bowling', () => {
    const g = new BowlingGame({ seed: 2026, botA: BOWL_TIERS.pro, botB: BOWL_TIERS.champ })
    let n = 0
    while (g.phase !== 'game_end' && n++ < 120 * 600) g.step()
    expect(g.phase).toBe('game_end')
    const sb = g.scoreboard()
    expect(sb.a.total).toBeGreaterThanOrEqual(0); expect(sb.b.total).toBeLessThanOrEqual(300)
  })
  it('golf', () => {
    const r = new GolfRound({ seed: 2026, botA: GOLF_TIERS.pro, botB: GOLF_TIERS.champ })
    let n = 0
    while (!r.over && n++ < 120 * 900) r.step()
    expect(r.over).toBe(true)
  })
  it('difficulty sliders map monotonically for every sport', () => {
    const lo = PRESETS.rookie, hi = PRESETS.champ
    expect(boxingParams(hi).reactionTicks).toBeLessThan(boxingParams(lo).reactionTicks)
    expect(boxingParams(hi).blockP).toBeGreaterThan(boxingParams(lo).blockP)
    expect(bowlingParams(hi).aimNoiseDeg).toBeLessThan(bowlingParams(lo).aimNoiseDeg)
    expect(bowlingParams(hi).hookSkill).toBeGreaterThan(bowlingParams(lo).hookSkill)
    expect(golfParams(hi).distNoise).toBeLessThan(golfParams(lo).distNoise)
    expect(golfParams(hi).greenSkill).toBeGreaterThan(golfParams(lo).greenSkill)
  })
})
