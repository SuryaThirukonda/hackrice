import type { GolfEvent, GolfSnapshot, Phase, Player } from '../../games/golf/sim/types'
import { sideKey, winnerCue, type Perspective, type Say, type SportMap } from './shared'

/** What the golf map reads from the scene when an event needs it. `strokes` is the event player's count so far. */
export interface GolfCtx { par: number; hole: number; nHoles: number; windMax: number; strokes: number }

/** Wind at or above this share of the course's maximum gets a warning. */
const STRONG_WIND = 0.7

export function golfMap(p: Perspective): SportMap<GolfEvent, GolfCtx, GolfSnapshot> {
  let prevPhase: Phase | null = null
  let lastShooter: Player | null = null
  /** Water, out of bounds or holed on this shot: where the ball stopped needs no call. */
  let shotDecided = false

  return {
    colour: 'golf.colour',
    start: (): Say[] => [], // hole one is introduced by its wind event
    event(e, ctx): Say[] {
      switch (e.kind) {
        case 'wind': {
          const c = ctx()
          lastShooter = null; shotDecided = false
          const say: string[] = []
          if (c.hole >= c.nHoles - 1) say.push('golf.hole.last')
          else if (c.hole < 3) say.push(`golf.hole.${c.hole + 1}`)
          if (c.par >= 3 && c.par <= 5) say.push(`golf.par.${c.par}`)
          if (c.windMax > 0 && Math.hypot(e.x, e.z) >= STRONG_WIND * c.windMax) say.push('golf.wind')
          return say.length ? [say] : []
        }
        case 'shot': lastShooter = e.player; shotDecided = false; return []
        case 'in_water': shotDecided = true; return [['golf.water']]
        case 'out_of_bounds': shotDecided = true; return [['golf.ob']]
        case 'on_green': {
          const { par, strokes } = ctx()
          return [[strokes === par - 3 ? 'golf.putt.eagle' : strokes === par - 2 ? 'golf.putt.birdie' : 'golf.green']]
        }
        case 'holed': {
          shotDecided = true
          const d = e.strokes - ctx().par
          if (e.strokes === 1) return [['golf.ace']]
          return [[d <= -2 ? 'golf.eagle' : d === -1 ? 'golf.birdie' : d === 0 ? 'golf.par' : d === 1 ? 'golf.bogey' : d === 2 ? 'golf.double' : 'golf.worse']]
        }
        case 'pick_up': return [['golf.pickup']]
        case 'hole_end': {
          if (e.hole >= ctx().nHoles - 1) return [] // the round result follows
          const { a, b } = e.scores
          if (a === b) return [['golf.halved']]
          const k = sideKey(p, a < b ? 'a' : 'b')
          return k ? [[`golf.won.${k}`]] : []
        }
        case 'round_end': return [['golf.final', winnerCue(p, e.winner)]]
        default: return []
      }
    },
    frame(v): Say[] {
      const prev = prevPhase
      prevPhase = v.phase
      if (prev === null || prev === v.phase) return []
      if (v.phase === 'settled' && !shotDecided && v.balls[v.current].surface === 'bunker') return [['golf.bunker']]
      if (v.phase === 'aim' && p.mode === '2p' && lastShooter !== null && v.current !== lastShooter) return [[v.current === 'a' ? 'golf.away.p1' : 'golf.away.p2']]
      return []
    },
    live: (v) => v.phase === 'aim' && (p.mode === '2p' || v.current === 'a'),
  }
}
