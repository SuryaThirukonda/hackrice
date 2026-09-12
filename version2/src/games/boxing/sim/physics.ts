import { BODY_GAP, DT, FRICTION, HEAD_LERP, KNOCK_EPS, RING_HALF } from './constants'
import type { Fighter, V2 } from './types'

export const dist = (a: Fighter, b: Fighter): number => Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z)

/** Unit vector from a to b, or the previous direction when they coincide. */
export function facing(a: Fighter, b: Fighter, prev: V2): V2 {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-6) return { ...prev }
  return { x: dx / d, z: dz / d }
}
/** True right of a fighter facing dir in a Y-up right-handed world. */
export const rightOf = (dir: V2): V2 => ({ x: -dir.z, z: dir.x })

export function integrate(f: Fighter): void {
  f.pos.x += (f.vMove.x + f.vKnock.x) * DT
  f.pos.z += (f.vMove.z + f.vKnock.z) * DT
  const k = Math.max(0, 1 - FRICTION * DT)
  f.vKnock.x *= k; f.vKnock.z *= k
  if (Math.hypot(f.vKnock.x, f.vKnock.z) < KNOCK_EPS) { f.vKnock.x = 0; f.vKnock.z = 0 }
  f.headOffset.x += (f.headTarget.x - f.headOffset.x) * HEAD_LERP
  f.headOffset.y += (f.headTarget.y - f.headOffset.y) * HEAD_LERP
  f.moving = Math.hypot(f.vMove.x, f.vMove.z)
}

export const pinned = (f: Fighter): boolean => Math.abs(f.pos.x) >= RING_HALF - 1e-9 || Math.abs(f.pos.z) >= RING_HALF - 1e-9

/** Keep at least BODY_GAP between centres. A rope-pinned or downed fighter does not move; the other takes the full push. */
export function separate(a: Fighter, b: Fighter, dir: V2): void {
  const d = dist(a, b)
  if (d >= BODY_GAP) return
  let ux = dir.x, uz = dir.z
  if (d > 1e-6) { ux = (b.pos.x - a.pos.x) / d; uz = (b.pos.z - a.pos.z) / d }
  const push = BODY_GAP - d
  const aFixed = pinned(a) || a.state === 'down', bFixed = pinned(b) || b.state === 'down'
  if (aFixed && bFixed) return
  const pa = aFixed ? 0 : bFixed ? push : push / 2
  const pb = bFixed ? 0 : aFixed ? push : push / 2
  a.pos.x -= ux * pa; a.pos.z -= uz * pa
  b.pos.x += ux * pb; b.pos.z += uz * pb
}

export function clampRopes(f: Fighter): void {
  if (f.pos.x > RING_HALF) { f.pos.x = RING_HALF; if (f.vKnock.x > 0) f.vKnock.x = 0 }
  if (f.pos.x < -RING_HALF) { f.pos.x = -RING_HALF; if (f.vKnock.x < 0) f.vKnock.x = 0 }
  if (f.pos.z > RING_HALF) { f.pos.z = RING_HALF; if (f.vKnock.z > 0) f.vKnock.z = 0 }
  if (f.pos.z < -RING_HALF) { f.pos.z = -RING_HALF; if (f.vKnock.z < 0) f.vKnock.z = 0 }
}
