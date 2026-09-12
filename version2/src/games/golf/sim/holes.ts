import type { Hole, Prop, PropKind, Surface, V2 } from './types'

const p = (x: number, z: number): V2 => ({ x, z })
const rect = (x0: number, z0: number, x1: number, z1: number): V2[] => [p(x0, z0), p(x1, z0), p(x1, z1), p(x0, z1)]
const prop = (kind: PropKind, x: number, z: number, s?: number): Prop => (s === undefined ? { kind, p: p(x, z) } : { kind, p: p(x, z), s })

/**
 * Metres: x east, z north, y up. Tee near the origin, hole plays north.
 * 0..2 Meadow Links, 3..5 Desert Canyon, 6..8 Neon Night (see courses.ts).
 */
export const HOLES: Hole[] = [
  // ---- Meadow Links ----
  { // par 3, 150 m straight; one bunker guarding the right of the green
    par: 3, tee: p(0, 0), cup: p(0, 150), greenR: 9, theme: 'meadow',
    fairway: [p(-14, -5), p(14, -5), p(16, 165), p(-16, 165)], course: rect(-40, -15, 40, 180),
    bunkers: [{ c: p(11, 143), r: 3.5 }], water: [],
    trees: [p(-24, 40), p(-26, 80), p(-22, 120), p(24, 30), p(27, 70), p(23, 110), p(-20, 160), p(20, 162)], windSeedOffset: 101,
  },
  { // par 4, 330 m, slight dogleg right; bunker at the inside corner and one short-left of the green
    par: 4, tee: p(0, 0), cup: p(70, 322), greenR: 9, theme: 'meadow',
    fairway: [p(-18, -5), p(18, -5), p(20, 180), p(55, 270), p(90, 300), p(95, 340), p(45, 345), p(25, 290), p(-20, 200)],
    course: [p(-60, -20), p(60, -20), p(130, 260), p(130, 370), p(20, 370), p(-60, 220)],
    bunkers: [{ c: p(78, 284), r: 5 }, { c: p(58, 313), r: 4 }], water: [],
    trees: [p(35, 60), p(38, 120), p(45, 200), p(70, 250), p(90, 270), p(-30, 60), p(-32, 140), p(-5, 240), p(10, 300), p(110, 330)], windSeedOffset: 202,
  },
  { // par 5, 470 m straight; water crosses the fairway at 180..210 m
    par: 5, tee: p(0, 0), cup: p(0, 470), greenR: 9, theme: 'meadow',
    fairway: rect(-20, -5, 20, 480), course: rect(-50, -15, 50, 500),
    bunkers: [{ c: p(14, 300), r: 5 }, { c: p(-12, 455), r: 4 }], water: [rect(-45, 180, 45, 210)],
    trees: [p(-30, 50), p(30, 90), p(-32, 250), p(34, 340), p(-30, 400), p(28, 430), p(-26, 485), p(26, 488)], windSeedOffset: 303,
  },
  // ---- Desert Canyon ----
  { // par 4, 340 m straight; a dry wash of sand crosses the whole hole at 160..185 m
    par: 4, tee: p(0, 0), cup: p(0, 340), greenR: 9, theme: 'canyon',
    fairway: [p(-16, -5), p(16, -5), p(18, 352), p(-18, 352)], course: rect(-50, -15, 50, 360),
    bunkers: [-40, -20, 0, 20, 40].map((x) => ({ c: p(x, 172.5), r: 13 })).concat([{ c: p(12, 330), r: 4 }]), water: [],
    trees: [], windSeedOffset: 404,
    props: [prop('rock', -36, 60), prop('boulder', 38, 120, 1.3), prop('cactus', -30, 30), prop('cactus', 32, 210), prop('rock', -40, 250, 1.2),
      prop('boulder', 36, 300), prop('cactus', -28, 320), prop('rock', 40, 20), prop('cactus', -42, 150)],
  },
  { // par 3, 165 m across a ravine: the course is a C, the ravine (x > -30, 60..110 m) is out of bounds; a thin neck on the west stays in play
    par: 3, tee: p(0, 0), cup: p(0, 165), greenR: 9, theme: 'canyon',
    fairway: [p(-42, -5), p(14, -5), p(14, 52), p(-33, 52), p(-33, 118), p(16, 118), p(16, 178), p(-42, 178)],
    course: [p(-45, -15), p(45, -15), p(45, 60), p(-30, 60), p(-30, 110), p(45, 110), p(45, 185), p(-45, 185)],
    bunkers: [{ c: p(-14, 152), r: 4 }], water: [],
    trees: [], windSeedOffset: 505,
    props: [prop('boulder', 25, 54, 1.2), prop('rock', -15, 52), prop('rock', 20, 116), prop('boulder', -10, 114), prop('cactus', 35, 20),
      prop('cactus', -38, 140), prop('cactus', 38, 170), prop('rock', 40, 40), prop('boulder', -44, 85, 0.8)],
  },
  { // par 5, 500 m; rock walls pinch the fairway to 16 m wide between 240 and 290 m
    par: 5, tee: p(0, 0), cup: p(0, 500), greenR: 9, theme: 'canyon',
    fairway: [p(-20, -5), p(20, -5), p(20, 200), p(8, 240), p(8, 290), p(20, 330), p(20, 510), p(-20, 510), p(-20, 330), p(-8, 290), p(-8, 240), p(-20, 200)],
    course: rect(-55, -15, 55, 520),
    bunkers: [{ c: p(16, 470), r: 5 }, { c: p(-16, 496), r: 4 }], water: [],
    trees: [], windSeedOffset: 606,
    props: [prop('boulder', -14, 230, 1.5), prop('boulder', 14, 230, 1.5), prop('boulder', -16, 255, 1.7), prop('boulder', 16, 255, 1.7), prop('boulder', -14, 280, 1.5), prop('boulder', 14, 280, 1.5),
      prop('rock', -30, 150), prop('rock', 30, 150), prop('cactus', 35, 60), prop('cactus', -35, 400), prop('cactus', 40, 450), prop('rock', -40, 505), prop('cactus', 30, 20)],
  },
  // ---- Neon Night ----
  { // par 3, 140 m island green: water wraps the green on every side except the causeway from the tee
    par: 3, tee: p(0, 0), cup: p(0, 140), greenR: 10, theme: 'neon',
    fairway: [p(-12, -5), p(12, -5), p(12, 94), p(4, 94), p(4, 125), p(15, 125), p(15, 157), p(-15, 157), p(-15, 125), p(-4, 125), p(-4, 94), p(-12, 94)],
    course: rect(-45, -15, 45, 175),
    bunkers: [], water: [[p(-40, 95), p(-5, 95), p(-5, 124), p(-16, 124), p(-16, 158), p(16, 158), p(16, 124), p(5, 124), p(5, 95), p(40, 95), p(40, 170), p(-40, 170)]],
    trees: [], windSeedOffset: 707,
    props: [prop('tower', -42, 60), prop('tower', 42, 120), prop('lamp', -10, -8), prop('lamp', 10, -8), prop('lamp', -14, 50), prop('lamp', 14, 50),
      prop('palm', -30, 30), prop('palm', 30, 30), prop('palm', -43, 150), prop('palm', 43, 20)],
  },
  { // par 4, 330 m; canals on both sides of an 22 m wide fairway from 40 to 300 m
    par: 4, tee: p(0, 0), cup: p(0, 330), greenR: 9, theme: 'neon',
    fairway: rect(-11, -5, 11, 340), course: rect(-50, -15, 50, 350),
    bunkers: [{ c: p(13, 315), r: 4 }], water: [rect(-45, 40, -16, 300), rect(16, 40, 45, 300)],
    trees: [], windSeedOffset: 808,
    props: [prop('tower', -46, 20), prop('tower', 46, 20), prop('tower', -46, 320), prop('tower', 46, 320), prop('lamp', -13, 100), prop('lamp', 13, 100),
      prop('lamp', -13, 200), prop('lamp', 13, 200), prop('palm', -30, 20), prop('palm', 30, 20), prop('palm', -35, 330), prop('palm', 35, 330)],
  },
  { // par 5, 480 m; out of bounds all along the east side and a moat 20 m short of the green
    par: 5, tee: p(0, 0), cup: p(0, 480), greenR: 9, theme: 'neon',
    fairway: rect(-18, -5, 18, 490), course: rect(-55, -15, 35, 500),
    bunkers: [{ c: p(-20, 300), r: 5 }, { c: p(14, 466), r: 4 }], water: [rect(-45, 432, 30, 452)],
    trees: [], windSeedOffset: 909,
    props: [prop('tower', -50, 100), prop('tower', -50, 400), prop('tower', 30, 250), prop('palm', -40, 50), prop('palm', 28, 60), prop('palm', -42, 200), prop('palm', 26, 380),
      prop('lamp', -20, 150), prop('lamp', 20, 150), prop('lamp', -20, 460), prop('lamp', 20, 460), prop('tower', 30, 10)],
  },
]

/** Even-odd ray cast; points exactly on an edge count as inside often enough for a game. */
export function pointInPolygon(q: V2, poly: V2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.z > q.z) !== (b.z > q.z) && q.x < ((b.x - a.x) * (q.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

export function surfaceAt(hole: Hole, q: V2): Surface {
  if (!pointInPolygon(q, hole.course)) return 'ob'
  for (const w of hole.water) if (pointInPolygon(q, w)) return 'water'
  for (const b of hole.bunkers) if (Math.hypot(q.x - b.c.x, q.z - b.c.z) <= b.r) return 'bunker'
  if (Math.hypot(q.x - hole.cup.x, q.z - hole.cup.z) <= hole.greenR) return 'green'
  return pointInPolygon(q, hole.fairway) ? 'fairway' : 'rough'
}
