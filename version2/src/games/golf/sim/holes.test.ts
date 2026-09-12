import { describe, expect, it } from 'vitest'
import { TIERS } from './bot'
import { COURSES } from './courses'
import { HZ } from './flight'
import { HOLES, pointInPolygon, surfaceAt } from './holes'
import { GolfRound } from './round'
import type { Hole, V2 } from './types'

const cross = (o: V2, a: V2, b: V2): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
const onSeg = (p: V2, a: V2, b: V2): boolean => Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.z, b.z) <= p.z && p.z <= Math.max(a.z, b.z)
/** Proper or touching intersection of segments ab and cd. */
function segmentsIntersect(a: V2, b: V2, c: V2, d: V2): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  if (d1 === 0 && onSeg(a, c, d)) return true
  if (d2 === 0 && onSeg(b, c, d)) return true
  if (d3 === 0 && onSeg(c, a, b)) return true
  if (d4 === 0 && onSeg(d, a, b)) return true
  return false
}
/** Simple polygon: at least three vertices and no two non-adjacent edges intersect. */
function isSimple(poly: V2[]): boolean {
  const n = poly.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue // adjacent edges share a vertex
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false
    }
  }
  return true
}
const inWaterOrOb = (h: Hole, q: V2): boolean => { const s = surfaceAt(h, q); return s === 'water' || s === 'ob' }

describe('courses', () => {
  it('there are three courses of three holes each, with distinct ids and valid hole indices', () => {
    expect(COURSES).toHaveLength(3)
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(3)
    for (const c of COURSES) {
      expect(c.holes).toHaveLength(3)
      for (const i of c.holes) { expect(HOLES[i]).toBeDefined(); expect(HOLES[i].theme).toBe(c.id) }
      expect(c.wind.min).toBeGreaterThanOrEqual(0); expect(c.wind.max).toBeGreaterThan(c.wind.min)
    }
    expect(new Set(HOLES.map((h) => h.windSeedOffset)).size).toBe(HOLES.length)
  })
})

describe.each(HOLES.map((h, i) => [i, h] as const))('hole %i', (_i, h) => {
  it('tee and cup are in play, the cup is on the green, the tee is on turf', () => {
    expect(pointInPolygon(h.tee, h.course)).toBe(true)
    expect(pointInPolygon(h.cup, h.course)).toBe(true)
    expect(surfaceAt(h, h.cup)).toBe('green')
    expect(['fairway', 'rough']).toContain(surfaceAt(h, h.tee))
    expect(inWaterOrOb(h, h.cup)).toBe(false)
    // the whole green disc stays dry and in bounds
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, q = { x: h.cup.x + Math.cos(a) * h.greenR, z: h.cup.z + Math.sin(a) * h.greenR }
      expect(pointInPolygon(q, h.course)).toBe(true)
      for (const w of h.water) expect(pointInPolygon(q, w)).toBe(false)
    }
  })
  it('fairway, course and water polygons are simple', () => {
    expect(isSimple(h.fairway)).toBe(true)
    expect(isSimple(h.course)).toBe(true)
    for (const w of h.water) expect(isSimple(w)).toBe(true)
  })
  it('props and trees stand inside the course', () => {
    for (const pr of h.props ?? []) expect(pointInPolygon(pr.p, h.course)).toBe(true)
    for (const t of h.trees) expect(pointInPolygon(t, h.course)).toBe(true)
  })
})

describe('bot rounds on every course', () => {
  for (const c of COURSES) {
    it(`${c.name}: pro vs champ completes for seeds 1..3 within the pick-up cap`, () => {
      const cap = c.holes.reduce((s, i) => s + HOLES[i].par + 4, 0)
      for (const seed of [1, 2, 3]) {
        const r = new GolfRound({ seed, holes: c.holes, windRange: c.wind, botA: TIERS.pro, botB: TIERS.champ })
        let winds = 0
        for (let i = 0; i < HZ * 3000 && !r.over; i++) { r.step(); for (const e of r.events) if (e.kind === 'wind') winds++ }
        expect(r.phase).toBe('round_end')
        expect(winds).toBe(2) // the first hole's wind event is raised in the constructor, before any step
        const t = r.scorecard().totals
        expect(t.a).toBeLessThanOrEqual(cap); expect(t.b).toBeLessThanOrEqual(cap)
        expect(r.scorecard().holes).toHaveLength(3)
      }
    })
  }
})
