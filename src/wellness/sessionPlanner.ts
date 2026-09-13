import type { HealthSport } from '../health/energy'
export type SessionGoal = 'energize' | 'move' | 'focus' | 'reset' | 'just-play'
export type SessionPhase = 'baseline' | 'active' | 'recovery' | 'cooldown' | 'summary'
export interface SessionSegment { phase: SessionPhase; sport?: HealthSport; minutes: number }

const plans: Record<SessionGoal, HealthSport[]> = {
  energize: ['boxing', 'boxing', 'bowling', 'boxing'], move: ['boxing', 'bowling', 'golf', 'boxing'],
  focus: ['golf', 'bowling', 'golf'], reset: ['golf', 'bowling', 'golf'], 'just-play': ['boxing', 'bowling', 'golf'],
}
export class SessionPlanner {
  plan(goal: SessionGoal, duration: 5 | 10 | 15): SessionSegment[] {
    const sports = plans[goal]
    const baseline = 1, cooldown = 1, available = Math.max(2, duration - baseline - cooldown)
    const chosen = sports.slice(0, Math.max(1, Math.min(sports.length, Math.round(available / 3))))
    const each = Math.max(1, Math.floor((available - Math.max(0, chosen.length - 1)) / chosen.length))
    const out: SessionSegment[] = [{ phase: 'baseline', minutes: baseline }]
    chosen.forEach((sport, i) => { out.push({ phase: 'active', sport, minutes: each }); if (i < chosen.length - 1) out.push({ phase: 'recovery', minutes: 1 }) })
    out.push({ phase: 'cooldown', minutes: cooldown }, { phase: 'summary', minutes: 0 })
    return out
  }
}

