import { CROSS_COST, JAB_COST, RECOVER_BELOW, SCRIPT_BUDGET, type Sport } from './tools'

/** Compact state the browser sends. Everything the model needs, nothing more (well under 300 tokens). */
export interface BoxingSummary { plan?: string; round: number; clock: number; me: { hp: number; stamina: number; state: string; kd: number }; opp: { hp: number; stamina: number; state: string; kd: number; guard: boolean }; dist: number; recent: string[]; oppTendencies: { blockRate: number; punchesPerSec: number; favorite: string } }
export interface BowlingSummary { frame: number; ball: number; standing: number[]; myTotal: number; oppTotal: number; lastRolls: string[] }
export interface GolfSummary { hole: number; par: number; strokes: number; oppStrokes: number; distToCup: number; surface: string; wind: { speed: number; fromDeg: number }; hazards: string; recent: string[] }
export type Summary = BoxingSummary | BowlingSummary | GolfSummary

export function instructions(sport: Sport, persona: string): string {
  const base = `You are ${persona}, a fighter in a comic-book casino arcade. Answer ONLY by calling the tool. Be fast and decisive. Taunts are optional, short, PG, and in character.`
  // Boxing: kept deliberately short and rule-shaped. Stamina comes first because agents otherwise script
  // nothing but punches, gas out, and spend the round refused. The BUDGET line in the state is authoritative.
  if (sport === 'boxing') {
    return `${base}
Stamina decides this fight. jab -9, cross -16, dodge -4, guard -1/s; regen +8/s resting, +3/s guarding. A punch you cannot afford is REFUSED and wasted.
Never spend more than the BUDGET line allows, and never script more than 3 punches. Below 30 stamina throw nothing: block_on, out, recover.
Reach: jab 1.2 m, cross 1.3 m. Farther than that, step 'in' first or you punch air. 'in' before a cross adds damage.
Pair every punch with a dodge (swayL/swayR/duck) or block_on. Script the next 2.5 s.`
  }
  if (sport === 'bowling') return `${base} Bowling: the 1-3 pocket is at lane_pos ~0.09 with hook ~0.6 and power ~0.75 for a right-handed roll. For spares aim at the centroid of the standing pins with less hook.`
  return `${base} Golf: pick the club whose carry (driver 230, wood3 200, iron5 160, iron7 135, wedge 90 metres, putter on the green) best matches the distance, power = distance / carry. Aim at 0 unless the wind or a hazard says otherwise. Lay up before water when risk is low.`
}

export function render(sport: Sport, s: Summary): string {
  if (sport === 'boxing') {
    const b = s as BoxingSummary
    // The arithmetic is done here, not by the model: it consistently mis-budgets stamina and reach when left to infer them.
    const budget = b.me.stamina < RECOVER_BELOW ? 0 : Math.floor(b.me.stamina * SCRIPT_BUDGET)
    const afford = budget === 0 ? 'NOTHING — recover this script' : `${Math.floor(budget / JAB_COST)} jab / ${Math.floor(budget / CROSS_COST)} cross`
    const reach = b.dist <= 1.2 ? 'both punches in reach' : b.dist <= 1.3 ? 'cross only; step in for the jab' : "out of reach — step 'in' first"
    return `${b.plan ? `game plan: ${b.plan}\n` : ''}round ${b.round} clock ${b.clock.toFixed(0)}s
dist ${b.dist.toFixed(2)}m — ${reach}
me: hp ${b.me.hp.toFixed(0)} stamina ${b.me.stamina.toFixed(0)} state ${b.me.state} knockdowns ${b.me.kd}
BUDGET this script: ${budget} stamina = ${afford}
opp: hp ${b.opp.hp.toFixed(0)} stamina ${b.opp.stamina.toFixed(0)} state ${b.opp.state} guard ${b.opp.guard ? 'up' : 'down'} knockdowns ${b.opp.kd}
opp tendencies: blocks ${(b.oppTendencies.blockRate * 100).toFixed(0)}% of the time, ${b.oppTendencies.punchesPerSec.toFixed(1)} punches/s, favourite ${b.oppTendencies.favorite}
recent: ${b.recent.slice(-5).join('; ') || 'nothing yet'}`
  }
  if (sport === 'bowling') {
    const b = s as BowlingSummary
    return `frame ${b.frame} ball ${b.ball} standing pins [${b.standing.join(',')}] totals me ${b.myTotal} opp ${b.oppTotal}\nlast rolls: ${b.lastRolls.join('; ') || 'none'}`
  }
  const g = s as GolfSummary
  return `hole ${g.hole} par ${g.par} my strokes ${g.strokes} opp ${g.oppStrokes}\nball ${g.distToCup.toFixed(0)}m from the cup on ${g.surface}; wind ${g.wind.speed.toFixed(1)} m/s from ${g.wind.fromDeg.toFixed(0)}deg; hazards: ${g.hazards}\nrecent: ${g.recent.slice(-4).join('; ') || 'none'}`
}
