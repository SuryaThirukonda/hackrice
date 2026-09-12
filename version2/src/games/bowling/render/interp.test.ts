import { describe, expect, it } from 'vitest'
import { BowlingGame } from '../sim/game'
import { lerpBowlingView } from './interp'

describe('bowling presentation interpolation', () => {
  it('interpolates transforms without changing authoritative gameplay fields', () => {
    const game = new BowlingGame({ seed: 42 })
    game.lockSway()
    game.startRoll({ lanePos: 0.2, angleDeg: 1, power: 0.8, hook: 0.3 })
    const previous = game.snapshot()
    game.step()
    const current = game.snapshot()
    const view = lerpBowlingView(previous, current, 0.5)

    expect(view.ballPos.x).toBeCloseTo((previous.ballPos.x + current.ballPos.x) / 2)
    expect(view.ballPos.z).toBeCloseTo((previous.ballPos.z + current.ballPos.z) / 2)
    expect(view.phase).toBe(current.phase)
    expect(view.scoreboard).toBe(current.scoreboard)
    expect(game.snapshot()).toEqual(current)
  })

  it('does not blend across a phase boundary', () => {
    const game = new BowlingGame({ seed: 7 })
    const aim = game.snapshot()
    game.startRoll({ lanePos: 0, angleDeg: 0, power: 0.6, hook: 0 })
    const rolling = game.snapshot()

    expect(lerpBowlingView(aim, rolling, 0.5)).toBe(rolling)
  })
})
