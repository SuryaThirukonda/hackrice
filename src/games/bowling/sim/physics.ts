import { BALL_END_Z, BALL_MASS, BALL_R, BALL_STOP_SPEED, DECK_END_Z, DECK_HALF, DT, E_BALL_PIN, E_PIN_PIN, GUTTER_W, HOOK_ACCEL, LANE_HALF, OIL_Z, PIN_DOWN_DIST, PIN_DOWN_SPEED, PIN_FRICTION, PIN_MASS, PIN_R, PIN_R_DOWN, PIN_SPOTS, PIN_Z, ROLL_FRICTION, SOLVER_ITERS } from './constants'
import type { Ball, Body, BowlingEvent, Pin } from './types'

export const makePins = (): Pin[] => PIN_SPOTS.map((s, index) => ({ index, x: s.x, z: s.z, vx: 0, vz: 0, spot: { ...s }, down: false, removed: false, hit: false, maxSpeed: 0 }))
export const speedOf = (b: Body): number => Math.hypot(b.vx, b.vz)
export const isStanding = (p: Pin): boolean => !p.down && !p.removed
export const pinRadius = (p: Pin): number => (p.down ? PIN_R_DOWN : PIN_R)

/** Scale velocity down by a constant deceleration; returns the new speed. */
function decel(b: Body, a: number): number {
  const s = speedOf(b)
  if (s === 0) return 0
  const s2 = Math.max(0, s - a * DT)
  b.vx *= s2 / s; b.vz *= s2 / s
  return s2
}

/** Ball: hook after the oil line (until the pins), rolling friction, gutter drop, stop rule. */
export function stepBall(b: Ball, events: BowlingEvent[]): void {
  if (!b.moving) return
  if (!b.gutter && b.z > OIL_Z && b.z < PIN_Z) b.vx += b.hook * HOOK_ACCEL * DT
  const s = decel(b, ROLL_FRICTION)
  b.x += b.vx * DT; b.z += b.vz * DT
  if (!b.gutter && b.z < PIN_Z - PIN_R - BALL_R && Math.abs(b.x) + BALL_R > LANE_HALF) {
    b.gutter = true; b.x = Math.sign(b.x) * (LANE_HALF + GUTTER_W / 2); b.vx = 0
    events.push({ kind: 'gutter' })
  }
  if (s < BALL_STOP_SPEED || b.z > BALL_END_Z || (!b.gutter && Math.abs(b.x) > DECK_HALF + BALL_R)) { b.moving = false; b.vx = 0; b.vz = 0 }
}

/** Pins: friction, integrate, fall/remove rules. Speed is sampled before friction so impulses from last tick count. */
export function stepPins(pins: Pin[]): void {
  for (const p of pins) {
    if (p.removed) continue
    p.maxSpeed = Math.max(p.maxSpeed, speedOf(p))
    decel(p, PIN_FRICTION)
    p.x += p.vx * DT; p.z += p.vz * DT
    if (!p.down && (p.maxSpeed > PIN_DOWN_SPEED || Math.hypot(p.x - p.spot.x, p.z - p.spot.z) > PIN_DOWN_DIST)) p.down = true
    if (Math.abs(p.x) > DECK_HALF || p.z > DECK_END_Z) { p.removed = true; p.down = true; p.vx = 0; p.vz = 0 }
  }
}

/** Circle-circle contact: optional restitution impulse, then push apart by inverse mass. Returns true on contact. */
function contact(a: Body, b: Body, rr: number, ma: number, mb: number, e: number, impulse: boolean): boolean {
  const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz
  if (d2 >= rr * rr) return false
  const d = Math.sqrt(d2)
  const nx = d > 1e-9 ? dx / d : 0, nz = d > 1e-9 ? dz / d : 1
  const ia = 1 / ma, ib = 1 / mb, w = ia + ib
  if (impulse) {
    const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz
    if (vn > 0) { const j = (1 + e) * vn / w; a.vx -= j * ia * nx; a.vz -= j * ia * nz; b.vx += j * ib * nx; b.vz += j * ib * nz }
  }
  const pen = rr - d, ca = pen * ia / w, cb = pen * ib / w
  a.x -= nx * ca; a.z -= nz * ca; b.x += nx * cb; b.z += nz * cb
  return true
}

/** Fixed-order contact solve: ball vs pins by index, then pin pairs i<j; SOLVER_ITERS impulse passes then position-only passes until clean. */
export function resolveContacts(ball: Ball | null, pins: Pin[], events: BowlingEvent[]): void {
  const live = pins.filter((p) => !p.removed)
  const b = ball && !ball.gutter ? ball : null
  const touch = (p: Pin): void => { if (!p.hit) { p.hit = true; events.push({ kind: 'pin_hit', pin: p.index }) } }
  for (let it = 0; it < SOLVER_ITERS + 8; it++) {
    const imp = it < SOLVER_ITERS
    let any = false
    if (b) for (const p of live) if (contact(b, p, BALL_R + pinRadius(p), BALL_MASS, PIN_MASS, E_BALL_PIN, imp)) { any = true; touch(p) }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      if (contact(live[i], live[j], pinRadius(live[i]) + pinRadius(live[j]), PIN_MASS, PIN_MASS, E_PIN_PIN, imp)) { any = true; if (live[i].hit || live[j].hit) { touch(live[i]); touch(live[j]) } }
    }
    if (!imp && !any) break
  }
}

export const anyMoving = (ball: Ball, pins: Pin[]): boolean => ball.moving || pins.some((p) => !p.removed && (p.vx !== 0 || p.vz !== 0))
