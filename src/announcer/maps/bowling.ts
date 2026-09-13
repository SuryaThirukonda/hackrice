import { PIN_SPACING, PIN_SPOTS } from '../../games/bowling/sim/constants'
import type { BowlingEvent, Side, Snapshot } from '../../games/bowling/sim/types'
import { sideKey, winnerCue, type Perspective, type Say, type SportMap } from './shared'

/** What the bowling map reads from the scene when an event needs it: the tick's events and the pins still up. */
export interface BowlingCtx { batch: readonly BowlingEvent[]; standing: readonly number[]; player: Side; frame: number }

/** Neighbouring pins in the rack are exactly one spacing apart; anything farther is not touching. */
const NEIGHBOUR = PIN_SPACING * 1.1

/** A split: the head pin is down, and the pins still standing form two or more groups that aren't neighbours. */
export function isSplit(standing: readonly number[]): boolean {
  const pins = [...new Set(standing)].filter((i) => Number.isInteger(i) && i >= 0 && i < PIN_SPOTS.length)
  if (pins.length < 2 || pins.includes(0)) return false
  const seen = new Set<number>([pins[0]])
  const todo = [pins[0]]
  while (todo.length) {
    const i = todo.pop()!
    for (const j of pins) {
      if (seen.has(j)) continue
      if (Math.hypot(PIN_SPOTS[i].x - PIN_SPOTS[j].x, PIN_SPOTS[i].z - PIN_SPOTS[j].z) <= NEIGHBOUR) { seen.add(j); todo.push(j) }
    }
  }
  return seen.size < pins.length
}

export function bowlingMap(p: Perspective): SportMap<BowlingEvent, BowlingCtx, Snapshot> {
  const streak: Record<Side, number> = { a: 0, b: 0 }
  let splitLeft: { player: Side; frame: number } | null = null
  let turn = ''
  let tenthCalled = false

  return {
    colour: 'bowling.colour',
    start: (): Say[] => [['bowling.intro']],
    event(e, ctx): Say[] {
      switch (e.kind) {
        case 'gutter': return [['bowling.gutter']]
        case 'pins_down': {
          const c = ctx()
          // Only a ball rolled at a full rack says anything about the leave or the strike streak.
          if (e.count + c.standing.length !== 10 || c.batch.some((x) => x.kind === 'strike')) return []
          streak[c.player] = 0
          if (isSplit(c.standing)) { splitLeft = { player: c.player, frame: c.frame }; return [['bowling.split']] }
          return c.standing.length === 1 ? [['bowling.onepin']] : []
        }
        case 'strike': {
          const s = ++streak[e.player]
          return [[s === 1 ? 'bowling.strike' : s === 2 ? 'bowling.double' : s === 3 ? 'bowling.turkey' : 'bowling.hot']]
        }
        case 'spare': {
          const made = !!splitLeft && splitLeft.player === e.player && splitLeft.frame === ctx().frame
          splitLeft = null
          return [[made ? 'bowling.split.made' : 'bowling.spare']]
        }
        case 'frame_end': splitLeft = null; return []
        case 'game_end': return [['bowling.final', winnerCue(p, e.winner)]]
        default: return []
      }
    },
    frame(v): Say[] {
      if (v.phase !== 'aim') return []
      const key = `${v.current}:${v.frame}`
      if (key === turn) return []
      const first = turn === ''
      turn = key
      if (v.frame === 10 && v.current === 'a' && !tenthCalled) { tenthCalled = true; return [['bowling.tenth']] }
      if (p.mode !== '2p' || first) return []
      const k = sideKey(p, v.current)
      return k ? [[`bowling.up.${k}`]] : []
    },
    live: (v) => v.phase === 'aim' && (p.mode === '2p' || v.current === 'a'),
  }
}
