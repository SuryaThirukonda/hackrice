import type { Rng } from '../../boxing/sim/rng'
import { CLUBS } from './clubs'
import { ACC_DEG, ACC_LOSS, BOUNCE_JITTER_DEG, BOUNCE_KEEP, CUP_MAX_SPEED, CUP_R, DT, LIE_MUL, MAX_SHOT_TICKS, POWER_EXP, PUTT_SPEED, RESTITUTION, ROLL_DECEL, ROLL_START, flyStep } from './flight'
import { surfaceAt } from './holes'
import type { Hole, Shot, ShotEvent, Surface, V2, V3 } from './types'

const TRAIL_EVERY = 3
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
export type BallMode = 'fly' | 'roll' | 'stop'
export type ShotOutcome = 'ok' | 'holed' | 'water' | 'ob'

/** Distance from point q to segment ab (horizontal plane). */
function segDist(q: V2, a: V3, b: V3): number {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2)) : 0
  return Math.hypot(a.x + dx * t - q.x, a.z + dz * t - q.z)
}

/** One shot, stepped at 120 Hz: flight, bounces, roll, hazards and cup capture. Deterministic for a given rng. */
export class ShotSim {
  readonly hole: Hole
  readonly start: V3
  readonly wind: V2
  readonly rng: Rng
  readonly lie: Surface
  pos: V3
  vel: V3
  mode: BallMode
  trail: V3[] = []
  t = 0
  carry = -1
  outcome: ShotOutcome = 'ok'
  done = false

  constructor(hole: Hole, from: V3, shot: Shot, wind: V2, rng: Rng) {
    this.hole = hole; this.start = { ...from }; this.wind = { ...wind }; this.rng = rng
    this.lie = surfaceAt(hole, from)
    const acc = Math.max(-1, Math.min(1, shot.accuracy))
    const h = (shot.aimDeg + acc * ACC_DEG) * Math.PI / 180
    const dir = { x: Math.sin(h), z: Math.cos(h) }
    const frac = clamp01(shot.power) * (1 - Math.abs(acc) * ACC_LOSS) * LIE_MUL[this.lie]
    this.pos = { x: from.x, y: 0, z: from.z }
    if (shot.club === 'putter') {
      const s = PUTT_SPEED * frac
      this.vel = { x: dir.x * s, y: 0, z: dir.z * s }; this.mode = 'roll'; this.carry = 0
    } else {
      const c = CLUBS[shot.club], s = c.speed * Math.pow(frac, POWER_EXP), a = c.angle * Math.PI / 180
      this.vel = { x: dir.x * Math.cos(a) * s, y: Math.sin(a) * s, z: dir.z * Math.cos(a) * s }; this.mode = 'fly'
    }
    this.trail.push({ ...this.pos })
  }

  get inFlight(): boolean { return this.mode === 'fly' }
  speed(): number { return Math.hypot(this.vel.x, this.vel.z) }

  step(): ShotEvent[] {
    const ev: ShotEvent[] = []
    if (this.done) return ev
    this.t++
    const prev = { ...this.pos }
    if (this.mode === 'fly') {
      flyStep(this.pos, this.vel, this.wind)
      if (this.pos.y <= 0 && this.vel.y < 0) {
        const f = prev.y > 0 ? prev.y / (prev.y - this.pos.y) : 0
        this.pos.x = prev.x + (this.pos.x - prev.x) * f; this.pos.z = prev.z + (this.pos.z - prev.z) * f; this.pos.y = 0
        if (this.carry < 0) this.carry = Math.hypot(this.pos.x - this.start.x, this.pos.z - this.start.z)
        const surf = surfaceAt(this.hole, this.pos)
        if (surf === 'water' || surf === 'ob') { this.hazard(surf, ev); return ev }
        const vy = -this.vel.y * RESTITUTION[surf], keep = BOUNCE_KEEP[surf]
        const j = this.rng.range(-BOUNCE_JITTER_DEG[surf], BOUNCE_JITTER_DEG[surf]) * Math.PI / 180
        const cs = Math.cos(j), sn = Math.sin(j), vx = this.vel.x, vz = this.vel.z
        this.vel.x = (vx * cs - vz * sn) * keep; this.vel.z = (vx * sn + vz * cs) * keep; this.vel.y = vy
        ev.push({ kind: 'bounce', surface: surf, pos: { ...this.pos } })
        if (vy < ROLL_START) { this.vel.y = 0; this.mode = 'roll' }
      }
    } else if (this.mode === 'roll') {
      const surf = surfaceAt(this.hole, this.pos)
      if (surf === 'water' || surf === 'ob') { this.hazard(surf, ev); return ev }
      const sp = this.speed(), dec = ROLL_DECEL[surf] * DT
      if (sp <= dec) { this.settle(surf, ev); return ev }
      const k = (sp - dec) / sp
      this.vel.x *= k; this.vel.z *= k
      this.pos.x += this.vel.x * DT; this.pos.z += this.vel.z * DT
      if (surf === 'green' && segDist(this.hole.cup, prev, this.pos) <= CUP_R) {
        if (sp < CUP_MAX_SPEED) { this.pos.x = this.hole.cup.x; this.pos.z = this.hole.cup.z; this.stop(); this.outcome = 'holed'; ev.push({ kind: 'cup' }) }
      }
    }
    if (this.t % TRAIL_EVERY === 0 || this.done) this.trail.push({ ...this.pos })
    if (!this.done && this.t >= MAX_SHOT_TICKS) this.settle(surfaceAt(this.hole, this.pos), ev)
    return ev
  }

  private stop(): void { this.vel = { x: 0, y: 0, z: 0 }; this.mode = 'stop'; this.done = true }
  private settle(surf: Surface, ev: ShotEvent[]): void { this.stop(); ev.push({ kind: 'settle', surface: surf, pos: { ...this.pos } }); this.trail.push({ ...this.pos }) }

  /** Water: drop at the last dry point along the shot line before the hazard. OB: back to where the shot was played. */
  private hazard(surf: Surface, ev: ShotEvent[]): void {
    const entry = { ...this.pos }
    if (surf === 'water') {
      const dx = this.start.x - entry.x, dz = this.start.z - entry.z, len = Math.hypot(dx, dz)
      const q = { x: entry.x, z: entry.z }
      if (len > 0) {
        let s = 0
        while (s < len && surfaceAt(this.hole, q) === 'water') { s += 0.5; q.x = entry.x + dx * s / len; q.z = entry.z + dz * s / len }
        s = Math.min(len, s + 1); q.x = entry.x + dx * s / len; q.z = entry.z + dz * s / len
      }
      this.pos = { x: q.x, y: 0, z: q.z }; this.outcome = 'water'
      ev.push({ kind: 'in_water', pos: entry })
    } else { this.pos = { ...this.start }; this.outcome = 'ob'; ev.push({ kind: 'out_of_bounds', pos: entry }) }
    this.stop(); this.trail.push(entry)
  }
}

export interface ShotResult { trail: V3[]; end: V3; carry: number; outcome: ShotOutcome; surface: Surface; events: ShotEvent[] }
/** Pure: run a whole shot to rest (used for the aim preview and by the bot). */
export function simulateShot(hole: Hole, from: V3, shot: Shot, wind: V2, rng: Rng): ShotResult {
  const s = new ShotSim(hole, from, shot, wind, rng), events: ShotEvent[] = []
  while (!s.done) events.push(...s.step())
  return { trail: s.trail, end: { ...s.pos }, carry: Math.max(0, s.carry), outcome: s.outcome, surface: surfaceAt(hole, s.pos), events }
}
