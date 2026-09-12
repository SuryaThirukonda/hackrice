import { releaseSpeed, clamp } from './bot'
import { AIM_SWAY, BALL_START_Z, DT, PIN_Z, SHOT_LIMITS } from './constants'
import { stepBall } from './physics'
import type { Ball, Shot, V2 } from './types'

/** Predicted ball path for a shot (no jitter, no pins): the straight run, the hook after the oil line, or the gutter drop. */
export function previewPath(shot: Shot, swayDeg: number, stepM = 0.35): V2[] {
  const angle = clamp(shot.angleDeg + swayDeg, -SHOT_LIMITS.angleDeg - AIM_SWAY.ampDeg, SHOT_LIMITS.angleDeg + AIM_SWAY.ampDeg)
  const speed = releaseSpeed(shot.power), a = (angle * Math.PI) / 180
  const b: Ball = { x: clamp(shot.lanePos, -SHOT_LIMITS.lanePos, SHOT_LIMITS.lanePos), z: BALL_START_Z, vx: speed * Math.sin(a), vz: speed * Math.cos(a), hook: clamp(shot.hook, -1, 1), gutter: false, moving: true }
  const out: V2[] = [{ x: b.x, z: b.z }]
  let acc = 0, n = 0
  while (b.moving && b.z < PIN_Z && n++ < 20_000) {
    stepBall(b, [])
    acc += Math.hypot(b.vx, b.vz) * DT
    if (acc >= stepM) { out.push({ x: b.x, z: b.z }); acc = 0 }
  }
  out.push({ x: b.x, z: Math.min(b.z, PIN_Z) })
  return out
}
