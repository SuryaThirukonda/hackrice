import type { Snapshot, FighterView } from '../sim/types'

/** Interpolated view between two sim snapshots (alpha 0..1). Only same-state fields are lerped. */
export function lerpFighter(p: FighterView, c: FighterView, t: number): FighterView {
  const same = p.state === c.state && p.punch === c.punch
  return {
    ...c,
    pos: { x: p.pos.x + (c.pos.x - p.pos.x) * t, z: p.pos.z + (c.pos.z - p.pos.z) * t },
    head: { x: p.head.x + (c.head.x - p.head.x) * t, y: p.head.y + (c.head.y - p.head.y) * t },
    progress: same ? p.progress + (c.progress - p.progress) * t : c.progress,
  }
}
export function lerpView(p: Snapshot, c: Snapshot, t: number): Snapshot {
  return { ...c, dir: { x: p.dir.x + (c.dir.x - p.dir.x) * t, z: p.dir.z + (c.dir.z - p.dir.z) * t }, dist: p.dist + (c.dist - p.dist) * t, a: lerpFighter(p.a, c.a, t), b: lerpFighter(p.b, c.b, t) }
}
