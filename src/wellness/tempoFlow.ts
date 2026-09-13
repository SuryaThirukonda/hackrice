import { loadSettings, type Difficulty } from '../agent/sliders'
import type { HealthSport } from '../health/energy'
import type { SessionSummaryLine } from '../health/tracker'
import type { AdaptationDecision } from './adaptation'
import { SessionPlanner, type SessionGoal, type SessionSegment } from './sessionPlanner'
import type { PlayerState } from './playerState'

export interface CompletedSegment { sport: HealthSport; summary: SessionSummaryLine | null; performance: number; consistency: number; player?: PlayerState; decision?: AdaptationDecision }
class TempoFlow {
  goal: SessionGoal = 'move'; duration: 5 | 10 | 15 = 10; plan: SessionSegment[] = []; cursor = 0
  baselinePulse: number | null = null; physiologyMode: 'live' | 'mock' | 'off' = 'off'
  segments: CompletedSegment[] = []; difficulty: Difficulty = { ...loadSettings().difficulty }
  start(goal: SessionGoal, duration: 5 | 10 | 15): void {
    this.goal = goal; this.duration = duration; this.plan = new SessionPlanner().plan(goal, duration); this.cursor = 0
    this.baselinePulse = null; this.physiologyMode = 'off'; this.segments = []; this.difficulty = { ...loadSettings().difficulty }
  }
  nextSport(): HealthSport | null {
    while (this.cursor < this.plan.length) { const s = this.plan[this.cursor++]; if (s.phase === 'active' && s.sport) return s.sport }
    return null
  }
  addSegment(sport: HealthSport, summary: SessionSummaryLine | null, performance: number, consistency: number): CompletedSegment {
    const row = { sport, summary, performance, consistency }; this.segments.push(row); return row
  }
  get latest(): CompletedSegment | null { return this.segments.at(-1) ?? null }
}
export const tempoFlow = new TempoFlow()
