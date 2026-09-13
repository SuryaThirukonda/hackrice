import { HZ } from '../../games/boxing/sim/constants'
import type { Side, SimEvent, Snapshot } from '../../games/boxing/sim/types'
import { nameKey, otherSide, winnerCue, type Perspective, type Say, type SportMap } from './shared'

/** What the boxing map reads from the scene when an event needs it. */
export interface BoxingCtx { tick: number; round: number; rounds: number; roundWinner?: Side | 'draw' }

const COMBO_WINDOW = 2.5 * HZ
const COMBO_HITS = 3
const DEFENSE_WINDOW = 4 * HZ
const DEFENSE_BLOCKS = 3
const GASSED_EVERY = 30 * HZ
const BIG_CROSS_MOMENTUM = 0.5

export function boxingMap(p: Perspective): SportMap<SimEvent, BoxingCtx, Snapshot> {
  let run: { side: Side; first: number; hits: number } | null = null
  const blocks: Record<Side, { first: number; n: number } | null> = { a: null, b: null }
  const gassedAt: Record<Side, number> = { a: -Infinity, b: -Infinity }
  let lastTenRound = 0
  const down = (who: Side): string => { const k = nameKey(p, who); return k ? `down.${k}` : 'down.generic' }

  return {
    colour: 'boxing.colour',
    start(): Say[] {
      if (p.mode !== 'card') return []
      const intro: string[] = []
      if (p.a) intro.push(`corner.blue.${p.a}`)
      if (p.b) intro.push(`corner.red.${p.b}`)
      intro.push('card.bets.open')
      return [intro]
    },
    event(e, ctx): Say[] {
      switch (e.kind) {
        case 'countdown': {
          if (e.n !== 3) return []
          const { round, rounds } = ctx()
          if (round >= rounds) return [['boxing.round.3']]
          return round === 1 ? [['boxing.round.1']] : round === 2 ? [['boxing.round.2']] : []
        }
        case 'bell': {
          if (!e.end) return e.round === 1 ? [['boxing.fight']] : []
          const { rounds, roundWinner } = ctx()
          if (e.round >= rounds) return [] // the decision follows half a second later
          const say = ['boxing.round.end']
          if (roundWinner === 'draw') say.push('round.even')
          else if (roundWinner) { const k = nameKey(p, roundWinner); if (k) say.push(`round.won.${k}`) }
          return [say]
        }
        case 'punch': {
          if (e.result === 'hit') {
            const t = ctx().tick
            blocks[otherSide(e.who)] = null // something got through
            if (run && run.side === e.who && t - run.first <= COMBO_WINDOW) run.hits++
            else run = { side: e.who, first: t, hits: 1 }
            if (run.hits >= COMBO_HITS) { run = null; return [['boxing.combo']] }
            return e.punch === 'cross' && e.momentum > BIG_CROSS_MOMENTUM ? [['boxing.cross']] : []
          }
          if (e.result === 'blocked') {
            const t = ctx().tick, d = otherSide(e.who), b = blocks[d]
            const next = b && t - b.first <= DEFENSE_WINDOW ? { first: b.first, n: b.n + 1 } : { first: t, n: 1 }
            if (next.n >= DEFENSE_BLOCKS) { blocks[d] = null; return [['boxing.defense']] }
            blocks[d] = next
          }
          return []
        }
        case 'stagger': return [['boxing.stagger']]
        case 'guard_break': return [['boxing.guardbreak']]
        case 'gassed': {
          if (p.mode === '1p' && e.who !== 'a') return [] // the HUD only shows your own stamina
          const t = ctx().tick
          if (t - gassedAt[e.who] < GASSED_EVERY) return []
          gassedAt[e.who] = t
          return [['boxing.gassed']]
        }
        case 'knockdown': run = null; return [[down(e.who)]]
        case 'count': return e.n >= 1 && e.n <= 9 ? [[`count.${e.n}`]] : []
        case 'getup': return [['boxing.getup']]
        // Count ten and the knockout arrive in the same tick: one call carries both, then the winner.
        case 'ko': return [['count.10', 'boxing.ko', winnerCue(p, otherSide(e.who))]]
        case 'decision': return [['boxing.decision', winnerCue(p, e.winner)]]
        default: return []
      }
    },
    frame(v): Say[] {
      if (v.phase !== 'fighting' || v.clock > 10 || v.clock <= 0 || v.round === lastTenRound) return []
      lastTenRound = v.round
      return [['boxing.last10']]
    },
    live: (v) => v.phase === 'fighting',
  }
}
