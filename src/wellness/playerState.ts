export interface PlayerState {
  performance: number; motionIntensity: number; exertion: number; recovery: number | null
  consistency: number; engagement: number; physiologyConfidence: number
  sources: { motion: boolean; performance: boolean; physiology: boolean }
  timestamp: number
}
export interface PlayerStateInput { performance?: number; motionIntensity?: number; recovery?: number | null; consistency?: number; engagement?: number; physiologyConfidence?: number; timestamp?: number }
const c = (v: number | undefined): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v! : 0))
export function buildPlayerState(i: PlayerStateInput): PlayerState {
  const performance = c(i.performance), motionIntensity = c(i.motionIntensity), consistency = c(i.consistency), engagement = c(i.engagement)
  const recovery = i.recovery === null || i.recovery === undefined || !Number.isFinite(i.recovery) ? null : c(i.recovery)
  const physiologyConfidence = recovery === null ? 0 : c(i.physiologyConfidence)
  return { performance, motionIntensity, exertion: c(motionIntensity * .7 + engagement * .3), recovery, consistency, engagement, physiologyConfidence,
    sources: { motion: i.motionIntensity !== undefined, performance: i.performance !== undefined, physiology: recovery !== null }, timestamp: i.timestamp ?? Date.now() }
}

