/**
 * Coarse head-motion index from face landmark centers.
 * Supplementary boxing activity only — never dominates calorie estimates.
 */
export function headMotionDelta(
  prev: { x: number; y: number } | null,
  next: { x: number; y: number } | null,
): number {
  if (!prev || !next) return 0
  const dx = next.x - prev.x
  const dy = next.y - prev.y
  // Landmarks are typically normalized ~0..1; scale displacement into a small 0..1 index.
  return Math.max(0, Math.min(1, Math.hypot(dx, dy) * 8))
}

/** Cap how much head motion may add to boxing MotionLoad (absolute add, not a weight share). */
export const HEAD_MOTION_LOAD_CAP = 0.06

export function withHeadMotionBoost(baseLoad: number, headMotion: number | undefined, sport: string): number {
  if (sport !== 'boxing' || headMotion === undefined) return baseLoad
  return Math.max(0, Math.min(1, baseLoad + Math.min(HEAD_MOTION_LOAD_CAP, headMotion * HEAD_MOTION_LOAD_CAP)))
}
