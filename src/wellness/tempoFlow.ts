import type { HealthSport } from '../health/energy'
import type { SessionSummaryLine } from '../health/tracker'
import type { AdaptationDecision } from './adaptation'
import { SessionPlanner, type SessionGoal, type SessionSegment } from './sessionPlanner'
import type { PlayerState } from './playerState'
import { loadSettings, type Difficulty } from '../agent/sliders'

export type ControllerMode = 'phone' | 'keyboard' | null
export type CameraMode = 'off' | 'live' | 'skipped'

export interface CompletedSegment {
  sport: HealthSport
  summary: SessionSummaryLine | null
  performance: number
  consistency: number
  player?: PlayerState
  decision?: AdaptationDecision
}

/** Minimal session state for the simplified Tempo flow: pick a sport, ready up, play, summarize. */
class TempoFlow {
  goal: SessionGoal = 'just-play'
  duration: 5 | 10 | 15 = 10
  plan: SessionSegment[] = []
  cursor = 0
  baselinePulse: number | null = null
  physiologyMode: 'live' | 'mock' | 'off' = 'off'
  segments: CompletedSegment[] = []
  difficulty: Difficulty = { ...loadSettings().difficulty }
  selectedSport: HealthSport | null = null
  controllerMode: ControllerMode = null
  cameraMode: CameraMode = 'off'

  /** Simple single-sport session (consumer MVP). */
  startSport(sport: HealthSport): void {
    this.selectedSport = sport
    this.goal = 'just-play'
    this.duration = 10
    this.plan = [
      { phase: 'baseline', minutes: 1 },
      { phase: 'active', sport, minutes: 8 },
      { phase: 'recovery', minutes: 1 },
      { phase: 'summary', minutes: 0 },
    ]
    this.cursor = 0
    this.baselinePulse = null
    this.physiologyMode = 'off'
    this.segments = []
    this.difficulty = { ...loadSettings().difficulty }
    this.controllerMode = null
    this.cameraMode = 'off'
  }

  /** Legacy multi-sport planner (kept for tests / advanced path). */
  start(goal: SessionGoal, duration: 5 | 10 | 15): void {
    this.goal = goal
    this.duration = duration
    this.plan = new SessionPlanner().plan(goal, duration)
    this.cursor = 0
    this.baselinePulse = null
    this.physiologyMode = 'off'
    this.segments = []
    this.difficulty = { ...loadSettings().difficulty }
    this.selectedSport = this.plan.find((s) => s.sport)?.sport ?? null
    this.controllerMode = null
    this.cameraMode = 'off'
  }

  peekNextSport(): HealthSport | null {
    const planned = this.plan.slice(this.cursor).find((s) => s.phase === 'active' && s.sport)?.sport ?? null
    return planned ? this.latest?.decision?.nextSportBias ?? planned : null
  }

  nextSport(): HealthSport | null {
    while (this.cursor < this.plan.length) {
      const s = this.plan[this.cursor++]
      if (s.phase === 'active' && s.sport) return this.latest?.decision?.nextSportBias ?? s.sport
    }
    return null
  }

  addSegment(sport: HealthSport, summary: SessionSummaryLine | null, performance: number, consistency: number): CompletedSegment {
    const row = { sport, summary, performance, consistency }
    this.segments.push(row)
    return row
  }

  get latest(): CompletedSegment | null { return this.segments.at(-1) ?? null }

  get readyToStart(): boolean { return this.controllerMode === 'phone' || this.controllerMode === 'keyboard' }
}

export const tempoFlow = new TempoFlow()
