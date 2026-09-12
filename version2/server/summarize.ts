import type { Sport } from './tools'

/** Compact state the browser sends. Everything the model needs, nothing more (well under 300 tokens). */
export interface BoxingSummary { plan?: string; round: number; clock: number; me: { hp: number; stamina: number; state: string; kd: number }; opp: { hp: number; stamina: number; state: string; kd: number; guard: boolean }; dist: number; recent: string[]; oppTendencies: { blockRate: number; punchesPerSec: number; favorite: string } }
export interface BowlingSummary { frame: number; ball: number; standing: number[]; myTotal: number; oppTotal: number; lastRolls: string[] }
export interface GolfSummary { hole: number; par: number; strokes: number; oppStrokes: number; distToCup: number; surface: string; wind: { speed: number; fromDeg: number }; hazards: string; recent: string[] }
export type Summary = BoxingSummary | BowlingSummary | GolfSummary

export function instructions(sport: Sport, persona: string): string {
  const base = `You are ${persona}, a fighter in a comic-book casino arcade. Answer ONLY by calling the tool. Be fast and decisive. Taunts are optional, short, PG, and in character.`
  if (sport === 'boxing') return `${base} Boxing rules: a punch in reach (dist <= 1.2 jab, 1.3 cross) lands unless the opponent dodges or blocks. Blocking costs the blocker stamina; at 0 stamina their guard breaks. Stepping in ('in') before a cross adds damage. Dodges (swayL/swayR/duck) are invulnerable briefly with a cooldown. If dist > 1.3 step 'in' first. Low stamina (<25): 'block_on' and 'out'. Script at most 6 steps for the next 1500 ms.`
  if (sport === 'bowling') return `${base} Bowling: the 1-3 pocket is at lane_pos ~0.09 with hook ~0.6 and power ~0.75 for a right-handed roll. For spares aim at the centroid of the standing pins with less hook.`
  return `${base} Golf: pick the club whose carry (driver 230, wood3 200, iron5 160, iron7 135, wedge 90 metres, putter on the green) best matches the distance, power = distance / carry. Aim at 0 unless the wind or a hazard says otherwise. Lay up before water when risk is low.`
}

export function render(sport: Sport, s: Summary): string {
  if (sport === 'boxing') {
    const b = s as BoxingSummary
    return `${b.plan ? `game plan: ${b.plan}\n` : ''}round ${b.round} clock ${b.clock.toFixed(0)}s dist ${b.dist.toFixed(2)}m\nme: hp ${b.me.hp.toFixed(0)} stamina ${b.me.stamina.toFixed(0)} state ${b.me.state} knockdowns ${b.me.kd}\nopp: hp ${b.opp.hp.toFixed(0)} stamina ${b.opp.stamina.toFixed(0)} state ${b.opp.state} guard ${b.opp.guard ? 'up' : 'down'} knockdowns ${b.opp.kd}\nopp tendencies: blocks ${(b.oppTendencies.blockRate * 100).toFixed(0)}% of the time, ${b.oppTendencies.punchesPerSec.toFixed(1)} punches/s, favourite ${b.oppTendencies.favorite}\nrecent: ${b.recent.slice(-5).join('; ') || 'nothing yet'}`
  }
  if (sport === 'bowling') {
    const b = s as BowlingSummary
    return `frame ${b.frame} ball ${b.ball} standing pins [${b.standing.join(',')}] totals me ${b.myTotal} opp ${b.oppTotal}\nlast rolls: ${b.lastRolls.join('; ') || 'none'}`
  }
  const g = s as GolfSummary
  return `hole ${g.hole} par ${g.par} my strokes ${g.strokes} opp ${g.oppStrokes}\nball ${g.distToCup.toFixed(0)}m from the cup on ${g.surface}; wind ${g.wind.speed.toFixed(1)} m/s from ${g.wind.fromDeg.toFixed(0)}deg; hazards: ${g.hazards}\nrecent: ${g.recent.slice(-4).join('; ') || 'none'}`
}
