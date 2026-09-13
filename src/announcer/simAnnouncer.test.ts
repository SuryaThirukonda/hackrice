import { describe, expect, it } from 'vitest'
import { BoxingMatch } from '../games/boxing/sim/match'
import { TIERS as BOXING_TIERS } from '../games/boxing/sim/tiers'
import { BowlingGame } from '../games/bowling/sim/game'
import { TIERS as BOWLING_TIERS } from '../games/bowling/sim/bot'
import { GolfRound, TIERS as GOLF_TIERS } from '../games/golf/sim'
import { createMap, type Say } from './director'
import { CUES } from './lines'

/** Every cue the maps emit must exist in the catalogue with at least one line. */
function expectKnown(calls: Say[]): void {
  for (const call of calls) for (const cue of call) expect(CUES[cue]?.lines.length ?? 0, cue).toBeGreaterThan(0)
}

// The maps read sim state at event time exactly as the scenes do. These runs check that reading against real matches.
describe('announcer maps on real sims', () => {
  it('boxing: every count digit is called and the match ends with its result call', () => {
    for (const seed of [1, 2, 3]) {
      const match = new BoxingMatch({ seed, botA: BOXING_TIERS.champ, botB: BOXING_TIERS.rookie })
      const map = createMap('boxing', { mode: '1p' })
      const calls: Say[] = []
      let digits = 0
      for (let i = 0; i < 120 * 60 * 20 && match.phase !== 'over'; i++) {
        match.step(null, null)
        for (const e of match.events) {
          if (e.kind === 'count' && e.n < 10) digits++
          const a = match.a.dealtRound, b = match.b.dealtRound
          const roundWinner: 'a' | 'b' | 'draw' | undefined = e.kind === 'bell' && e.end ? (a > b ? 'a' : b > a ? 'b' : 'draw') : undefined
          calls.push(...map.event(e, () => ({ tick: match.tick, round: match.round, rounds: match.rounds, roundWinner })))
        }
        calls.push(...map.frame(match.snapshot()))
      }
      expect(match.phase, `seed ${seed}`).toBe('over')
      expectKnown(calls)
      expect(calls.filter((c) => c.length === 1 && c[0].startsWith('count.')).length).toBe(digits)
      const last = calls[calls.length - 1]
      if (match.getResult()!.by === 'ko') expect(last.slice(0, 2)).toEqual(['count.10', 'boxing.ko'])
      else expect(last[0]).toBe('boxing.decision')
    }
  })

  it('bowling: every strike and spare is called and the game ends with its result call', () => {
    for (const seed of [4, 5]) {
      const game = new BowlingGame({ seed, botA: BOWLING_TIERS.champ, botB: BOWLING_TIERS.pro })
      const map = createMap('bowling', { mode: '2p' })
      const calls: Say[] = []
      let strikes = 0, spares = 0
      for (let i = 0; i < 120 * 60 * 30 && game.phase !== 'game_end'; i++) {
        game.step()
        const batch = game.events
        for (const e of batch) {
          if (e.kind === 'strike') strikes++
          if (e.kind === 'spare') spares++
          calls.push(...map.event(e, () => ({ batch, standing: game.standingPins().map((p) => p.index), player: game.current, frame: game.frame })))
        }
        calls.push(...map.frame(game.snapshot()))
      }
      expect(game.phase, `seed ${seed}`).toBe('game_end')
      expectKnown(calls)
      const first = (ids: string[]) => calls.filter((c) => ids.includes(c[0])).length
      expect(first(['bowling.strike', 'bowling.double', 'bowling.turkey', 'bowling.hot'])).toBe(strikes)
      expect(first(['bowling.spare', 'bowling.split.made'])).toBe(spares)
      expect(calls[calls.length - 1][0]).toBe('bowling.final')
    }
  })

  it('golf: every hole is introduced, every holed ball gets its score word, and the round ends with its result', () => {
    const round = new GolfRound({ seed: 21, holes: [0, 1, 2], botA: GOLF_TIERS.pro, botB: GOLF_TIERS.rookie })
    const map = createMap('golf', { mode: '1p' })
    const nHoles = round.holeList.length
    const ctx = (player?: 'a' | 'b') => () => ({ par: round.holeData.par, hole: round.hole, nHoles, windMax: 6, strokes: player ? round.balls[player].strokes : 0 })
    // The scene re-sends hole one's wind once its 3D world is ready; the sim's own copy is cleared by the first step.
    const calls: Say[] = [...map.event({ kind: 'wind', x: round.wind.x, z: round.wind.z }, ctx())]
    let holed = 0
    for (let i = 0; i < 120 * 60 * 30 && round.phase !== 'round_end'; i++) {
      round.step()
      for (const e of round.events) {
        if (e.kind === 'holed') holed++
        calls.push(...map.event(e, ctx('player' in e ? e.player : undefined)))
      }
      calls.push(...map.frame(round.snapshot()))
    }
    expect(round.phase).toBe('round_end')
    expectKnown(calls)
    const first = (ids: string[]) => calls.filter((c) => ids.includes(c[0])).length
    expect(first(['golf.hole.1', 'golf.hole.2', 'golf.hole.3', 'golf.hole.last'])).toBe(nHoles)
    expect(first(['golf.ace', 'golf.eagle', 'golf.birdie', 'golf.par', 'golf.bogey', 'golf.double', 'golf.worse'])).toBe(holed)
    expect(calls[calls.length - 1][0]).toBe('golf.final')
  })
})
