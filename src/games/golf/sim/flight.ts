import type { Surface, V2, V3 } from './types'

export const HZ = 120
export const DT = 1 / HZ
export const ticks = (seconds: number): number => Math.round(seconds * HZ)
export const G = 9.81
export const DRAG_K = 0.006
export const LIFT_K = 0.0025
export const POWER_EXP = 0.7   // launch speed = full speed * frac^POWER_EXP, so carry is roughly linear in power
/** Capture radius. A regulation hole is 0.054 m, but the cup is drawn at 0.2 m radius (CourseScene 'cup' cylinder,
 *  scale 0.4) and the ball is drawn at 0.12 m, so at 0.054 the ball visibly rolled across the hole and missed.
 *  Matched to just inside the drawn cup so anything passing over the hole slowly drops in. */
/** The ball's own radius, as modelled: touching means the ball's edge reaches the cup's edge, not its centre. */
export const BALL_R = 0.03
/** Drawn cup radius. The render draws the cup as a 0.4 m cylinder. */
export const CUP_DRAWN_R = 0.2
/** Capture radius, centre to centre: the moment the ball touches the drawn hole it is in. There is no
 *  speed limit and no lip-out; a ball that reaches the hole is finished. */
export const CUP_R = CUP_DRAWN_R + BALL_R
export const PUTT_SPEED = 12
export const ACC_DEG = 8
export const ACC_LOSS = 0.06
export const ROLL_START = 0.5  // vertical bounce speed below which the ball rolls
export const MAX_SHOT_TICKS = ticks(40)

export const LIE_MUL: Record<Surface, number> = { green: 1, fairway: 1, rough: 0.85, bunker: 0.6, water: 1, ob: 1 }
export const RESTITUTION: Record<Surface, number> = { green: 0.25, fairway: 0.4, rough: 0.3, bunker: 0.05, water: 0, ob: 0 }
export const BOUNCE_KEEP: Record<Surface, number> = { green: 0.7, fairway: 0.7, rough: 0.7, bunker: 0.2, water: 0, ob: 0 }
export const BOUNCE_JITTER_DEG: Record<Surface, number> = { green: 0, fairway: 1, rough: 4, bunker: 4, water: 0, ob: 0 }
export const ROLL_DECEL: Record<Surface, number> = { green: 1.0, fairway: 2.2, rough: 4.5, bunker: 8, water: 8, ob: 8 }

/** One 120 Hz step of ball flight: gravity, quadratic drag and lift on the air-relative velocity. */
export function flyStep(pos: V3, vel: V3, wind: V2): void {
  const rx = vel.x - wind.x, ry = vel.y, rz = vel.z - wind.z
  const s = Math.hypot(rx, ry, rz), sh = Math.hypot(rx, rz)
  let ax = -DRAG_K * s * rx, ay = -G - DRAG_K * s * ry, az = -DRAG_K * s * rz
  if (sh > 1e-6) { const l = LIFT_K * s; ax -= l * ry * rx / sh; ay += l * sh; az -= l * ry * rz / sh }
  vel.x += ax * DT; vel.y += ay * DT; vel.z += az * DT
  pos.x += vel.x * DT; pos.y += vel.y * DT; pos.z += vel.z * DT
}

/** Horizontal distance to the first touchdown for a launch at speed and angle on flat ground. */
export function carryFor(speed: number, angleDeg: number, wind: V2 = { x: 0, z: 0 }): number {
  const a = angleDeg * Math.PI / 180
  const pos: V3 = { x: 0, y: 0, z: 0 }, vel: V3 = { x: 0, y: speed * Math.sin(a), z: speed * Math.cos(a) }
  for (let i = 0; i < MAX_SHOT_TICKS; i++) {
    const py = pos.y, pz = pos.z
    flyStep(pos, vel, wind)
    if (pos.y <= 0 && vel.y < 0 && i > 0) { const f = py / (py - pos.y); return pz + (pos.z - pz) * f }
  }
  return pos.z
}
