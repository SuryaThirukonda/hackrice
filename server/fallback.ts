import { RECOVER_BELOW, type AgentOutput, type BoxScript, type Sport } from './tools'
import type { BoxingSummary, BowlingSummary, GolfSummary, Summary } from './summarize'

/** Deterministic scripts used when the model is slow, down, or answers garbage. A dead API still produces a fight. */
export function fallback(sport: Sport, s: Summary | null, seedTick = 0, strategy = false): AgentOutput {
  if (strategy) return { sport, strategy: { plan: 'Work the jab, step in for the cross when the guard drops, block when tired.' } }
  if (sport === 'boxing') {
    const b = s as BoxingSummary | null
    const dist = b?.dist ?? 1.5, stamina = b?.me.stamina ?? 100
    let script: BoxScript
    if (stamina < RECOVER_BELOW) script = { steps: [{ at_ms: 0, do: 'block_on' }, { at_ms: 200, do: 'out' }, { at_ms: 1400, do: 'block_off' }] }
    else if (dist > 1.3) script = { steps: [{ at_ms: 0, do: 'in' }, { at_ms: 900, do: 'jab' }, { at_ms: 1300, do: 'block_on' }] }
    else if (seedTick % 3 === 0) script = { steps: [{ at_ms: 0, do: 'jab' }, { at_ms: 450, do: 'in' }, { at_ms: 600, do: 'cross' }, { at_ms: 1200, do: 'block_on' }] }
    else if (seedTick % 3 === 1) script = { steps: [{ at_ms: 0, do: 'block_on' }, { at_ms: 700, do: 'block_off' }, { at_ms: 750, do: 'jab' }, { at_ms: 1100, do: 'jab' }] }
    else script = { steps: [{ at_ms: 0, do: 'swayR' }, { at_ms: 500, do: 'cross' }, { at_ms: 1100, do: 'left' }] }
    return { sport, script }
  }
  if (sport === 'bowling') {
    const b = s as BowlingSummary | null
    const first = !b || b.ball === 1 || b.standing.length === 10
    return { sport, shot: first ? { lane_pos: 0.09, angle_deg: 0, power: 0.75, hook: 0.6 } : { lane_pos: 0, angle_deg: 0, power: 0.65, hook: 0.2 } }
  }
  const g = s as GolfSummary | null
  const d = g?.distToCup ?? 150
  const club = g?.surface === 'green' ? 'putter' : d > 215 ? 'driver' : d > 180 ? 'wood3' : d > 147 ? 'iron5' : d > 110 ? 'iron7' : 'wedge'
  const carry = { driver: 230, wood3: 200, iron5: 160, iron7: 135, wedge: 90, putter: 20 }[club]
  return { sport, shot: { club, aim_deg: 0, power: Math.min(1, d / carry), risk: 0.3 } }
}
