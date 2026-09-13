import { AdaptationEngine } from './adaptation'
import { buildPlayerState } from './playerState'
import { tempoFlow } from './tempoFlow'

const PREVIEWS = new Set(['tempo-session', 'baseline', 'recovery', 'session-summary', 'health'])

/** Dev-only visual-QA entry point. It never runs in production builds. */
export function wellnessPreview(): string | null {
  if (!import.meta.env.DEV) return null
  const scene = new URLSearchParams(window.location.search).get('wellnessPreview')
  if (!scene || !PREVIEWS.has(scene)) return null
  if (scene === 'recovery' || scene === 'session-summary') {
    tempoFlow.start('move', 10)
    tempoFlow.physiologyMode = 'mock'
    tempoFlow.baselinePulse = 72
    const segment = tempoFlow.addSegment('boxing', {
      id: -1, activeMinutes: 2.4, activeSeconds: 144, kcal: null, motionLoad: .68,
      energyConfidence: 'LOW', swings: 38, romMean: 62, romMax: 104, source: 'phone',
    }, .78, .83)
    if (scene === 'session-summary') {
      const player = buildPlayerState({ performance: segment.performance, consistency: segment.consistency, motionIntensity: .68, engagement: .86, recovery: .74, physiologyConfidence: .8 })
      segment.player = player
      segment.decision = new AdaptationEngine().decide(player, 'boxing')
    }
  }
  return scene
}
