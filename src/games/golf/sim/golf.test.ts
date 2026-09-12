import { describe, expect, it } from 'vitest'
import { Rng } from '../../boxing/sim/rng'
import { TIERS } from './bot'
import { CLUBS, FULL_CLUBS, carryTable } from './clubs'
import { ACC_DEG, CUP_R, HZ, ROLL_DECEL, ROLL_START, RESTITUTION, BOUNCE_KEEP } from './flight'
import { HOLES, surfaceAt } from './holes'
import { GolfRound } from './round'
import { ShotSim, simulateShot } from './shot'
import type { Club, GolfEvent, Player, Shot, V3 } from './types'

const NO_WIND = { x: 0, z: 0 }
const flat = HOLES[2]                       // long straight hole: 20 m wide fairway, water at z 180..210
const tee: V3 = { x: 0, y: 0, z: 0 }
const shot = (club: Club, power = 1, aimDeg = 0, accuracy = 0): Shot => ({ club, aimDeg, power, accuracy })
const angleOf = (p: V3): number => Math.atan2(p.x, p.z) * 180 / Math.PI

/** Steps until the phase is one of the given ones (or the cap is reached); returns all events seen. */
function until(r: GolfRound, phases: string[], cap = HZ * 60): GolfEvent[] {
  const ev: GolfEvent[] = []
  for (let i = 0; i < cap && !phases.includes(r.phase); i++) { r.step(); ev.push(...r.events) }
  return ev
}
const play = (r: GolfRound, s: Shot): GolfEvent[] => { expect(r.shoot(s)).toBe(true); return until(r, ['aim', 'round_end']) }
const kinds = (ev: GolfEvent[]): string[] => ev.map((e) => e.kind)
/** Round on one hole with no bots, both balls placed by hand. */
function scripted(holeIdx: number, seed = 3): GolfRound { return new GolfRound({ seed, holes: [holeIdx], botA: null, botB: null }) }
function placeBall(r: GolfRound, p: Player, x: number, z: number): void { r.balls[p].pos = { x, y: 0, z } }

describe('clubs and flight', () => {
  it('each club at full power with no wind carries within 5% of the table from flat fairway', () => {
    for (const c of FULL_CLUBS) {
      const res = simulateShot(flat, tee, shot(c), NO_WIND, new Rng(1))
      expect(Math.abs(res.carry - carryTable[c]) / carryTable[c]).toBeLessThan(0.05)
      expect(CLUBS[c].speed).toBeGreaterThan(20)
    }
  })
  it('a 6 m/s headwind shortens the driver and a tailwind lengthens it by at least 8%', () => {
    const calm = simulateShot(flat, tee, shot('driver'), NO_WIND, new Rng(1)).carry
    const head = simulateShot(flat, tee, shot('driver'), { x: 0, z: -6 }, new Rng(1)).carry
    const tail = simulateShot(flat, tee, shot('driver'), { x: 0, z: 6 }, new Rng(1)).carry
    expect(head).toBeLessThan(calm * 0.92)
    expect(tail).toBeGreaterThan(calm * 1.08)
  })
  it('accuracy -1 lands left and +1 lands right by roughly the deviation angle, slightly shorter', () => {
    const straight = simulateShot(flat, tee, shot('iron7'), NO_WIND, new Rng(1))
    const left = simulateShot(flat, tee, shot('iron7', 1, 0, -1), NO_WIND, new Rng(1))
    const right = simulateShot(flat, tee, shot('iron7', 1, 0, 1), NO_WIND, new Rng(1))
    const land = (r: ReturnType<typeof simulateShot>) => r.events.find((e) => e.kind === 'bounce')!.pos
    expect(angleOf(land(left))).toBeCloseTo(-ACC_DEG, 0)
    expect(angleOf(land(right))).toBeCloseTo(ACC_DEG, 0)
    expect(left.carry).toBeLessThan(straight.carry)
    expect(left.carry).toBeGreaterThan(straight.carry * 0.9)
  })
  it('lie penalties: rough and bunker shorten the shot, and the ball is a putt-only roll with the putter', () => {
    const fair = simulateShot(flat, { x: 0, y: 0, z: 20 }, shot('iron5'), NO_WIND, new Rng(1)).carry
    const rough = simulateShot(flat, { x: 30, y: 0, z: 20 }, shot('iron5'), NO_WIND, new Rng(1)).carry
    const bunker = simulateShot(flat, { x: 14, y: 0, z: 300 }, shot('iron5'), NO_WIND, new Rng(1)).carry
    expect(rough / fair).toBeGreaterThan(0.75); expect(rough / fair).toBeLessThan(0.92)
    expect(bunker / fair).toBeLessThan(0.7)
    expect(simulateShot(flat, tee, shot('putter', 0.5), NO_WIND, new Rng(1)).trail.every((p) => p.y === 0)).toBe(true)
  })
})

describe('landing and roll', () => {
  /** A ball dropped onto the surface at 30 m/s horizontal and 20 m/s down; returns roll-phase distance and total distance. */
  function landAt(x: number, z: number) {
    const s = new ShotSim(flat, { x, y: 0, z }, shot('wedge', 0.5), NO_WIND, new Rng(1))
    s.pos = { x, y: 0.001, z }; s.vel = { x: 0, y: -20, z: 30 }
    let rollFrom: V3 | null = null
    while (!s.done) { s.step(); if (!rollFrom && s.mode === 'roll') rollFrom = { ...s.pos } }
    const rf = rollFrom!
    return { roll: Math.hypot(s.pos.x - rf.x, s.pos.z - rf.z), total: Math.hypot(s.pos.x - x, s.pos.z - z), end: s.pos }
  }
  it('bounces lose height by restitution and horizontal speed by the keep factor, then the roll obeys the surface', () => {
    expect(RESTITUTION.fairway).toBe(0.4); expect(BOUNCE_KEEP.bunker).toBe(0.2); expect(ROLL_START).toBe(0.5)
    const f = landAt(0, 20), r = landAt(35, 20)
    expect(f.roll).toBeLessThanOrEqual(25); expect(f.roll).toBeGreaterThan(1)
    expect(r.roll).toBeLessThanOrEqual(10)
    expect(r.total).toBeLessThan(f.total)
    expect(surfaceAt(flat, f.end)).toBe('fairway'); expect(surfaceAt(flat, r.end)).toBe('rough')
    expect(ROLL_DECEL.rough).toBeGreaterThan(ROLL_DECEL.fairway)
  })
})

describe('hazards', () => {
  it('a shot into the water costs a stroke and drops the ball short of the hazard on the shot line', () => {
    const r = scripted(2); r.wind = { x: 0, z: 0 }
    let power = 0.5
    for (let p = 0.5; p <= 1; p += 0.01) { if (simulateShot(flat, tee, shot('driver', p), NO_WIND, new Rng(1)).carry >= 190) { power = p; break } }
    const ev = play(r, shot('driver', power))
    expect(kinds(ev)).toContain('in_water')
    expect(r.balls.a.strokes).toBe(2)
    const b = r.ball('a')
    expect(b.z).toBeLessThan(180); expect(b.z).toBeGreaterThan(160); expect(Math.abs(b.x)).toBeLessThan(0.01)
    expect(surfaceAt(flat, b)).toBe('fairway')
  })
  it('out of bounds costs a stroke and is replayed from the previous spot', () => {
    const r = scripted(2); r.wind = { x: 0, z: 0 }
    placeBall(r, 'a', 0, 50)
    const ev = play(r, shot('driver', 1, 90))
    expect(kinds(ev)).toContain('out_of_bounds')
    expect(r.balls.a.strokes).toBe(2)
    expect(r.ball('a')).toEqual({ x: 0, y: 0, z: 50 })
    expect(r.current).toBe('b') // b, still on the tee, is now farthest
  })
})

describe('cup', () => {
  it('a 3 m putt at moderate power holes out; at full power it lips out and rolls past', () => {
    const r = scripted(0); r.wind = { x: 0, z: 0 }
    placeBall(r, 'a', 0, 147); placeBall(r, 'b', 0, 147)
    const ev = play(r, shot('putter', 0.25))
    expect(ev.find((e) => e.kind === 'holed')).toEqual({ kind: 'holed', player: 'a', strokes: 1 })
    expect(r.balls.a.holed).toBe(true)
    expect(r.current).toBe('b')
    const ev2 = play(r, shot('putter', 1))
    expect(kinds(ev2)).not.toContain('holed')
    expect(r.ball('b').z).toBeGreaterThan(150 + 5)
  })

  it('a slow putt that rolls over the edge of the drawn cup drops in', () => {
    // The cup is drawn at 0.2 m radius. A 2 degree miss over 3 m passes about 0.10 m off centre, which is
    // visibly inside the hole; at the old 0.054 m capture radius it rolled straight over and missed.
    expect(CUP_R).toBeGreaterThan(0.1)
    const r = scripted(0); r.wind = NO_WIND
    placeBall(r, 'a', 0, 147); placeBall(r, 'b', 0, 147)
    expect(kinds(play(r, shot('putter', 0.25, 2)))).toContain('holed')
  })
})

describe('hole and round flow', () => {
  it('alternates by farthest from the cup, ends the hole when both are holed and scores the card', () => {
    const r = scripted(0, 5); r.wind = { x: 0, z: 0 }
    expect(r.current).toBe('a')
    play(r, shot('wedge', 0.6))            // a: ~50 m
    expect(r.current).toBe('b')            // b still on the tee, farthest
    play(r, shot('iron5', 0.9))            // b: near the green
    expect(r.current).toBe('a')            // a is farther
    placeBall(r, 'a', 0, 148); placeBall(r, 'b', 0, 146)
    play(r, shot('putter', 0.22))          // a holes out: 2 strokes
    expect(r.balls.a.holed).toBe(true); expect(r.current).toBe('b')
    const ev = play(r, shot('putter', 0.27)) // b holes out from 4 m: 2 strokes
    expect(kinds(ev)).toEqual(expect.arrayContaining(['holed', 'hole_end', 'round_end']))
    const sc = r.scorecard()
    expect(sc.holes[0]).toEqual({ hole: 0, par: 3, strokes: { a: 2, b: 2 }, toPar: { a: -1, b: -1 } })
    expect(sc.totals).toEqual({ a: 2, b: 2 })
    expect(r.result()).toEqual({ winner: 'draw', totals: { a: 2, b: 2 } })
    expect(r.phase).toBe('round_end')
  })
  it('a player who reaches par+4 picks up with that score; lower total wins the round', () => {
    const r = scripted(0, 5); r.wind = { x: 0, z: 0 }
    placeBall(r, 'a', 0, 149)
    play(r, shot('putter', 0.15))          // a holes from 1 m
    expect(r.balls.a.holed).toBe(true); expect(r.current).toBe('b')
    let ev: GolfEvent[] = []
    for (let i = 0; i < 7 && r.phase === 'aim'; i++) ev = play(r, shot('putter', 0.01))
    expect(r.balls.b.strokes).toBe(7)
    expect(kinds(ev)).toContain('pick_up')
    expect(r.scorecard().toPar).toEqual({ a: -2, b: 4 })
    expect(r.result()?.winner).toBe('a')
  })
  it('refuses shots outside the aim phase and the putter from a bunker', () => {
    const r = scripted(2); placeBall(r, 'a', 14, 300)
    expect(surfaceAt(flat, r.ball('a'))).toBe('bunker')
    expect(r.shoot(shot('putter', 0.5))).toBe(false)
    expect(r.shoot(shot('wedge', 0.5))).toBe(true)
    expect(r.shoot(shot('wedge', 0.5))).toBe(false)
  })
})

describe('determinism and bots', () => {
  it('same seed and same shots twice give identical event logs and snapshots', () => {
    const run = () => {
      const r = new GolfRound({ seed: 11, botB: TIERS.pro }), src = new Rng(9), log: string[] = []
      for (let i = 0; i < HZ * 400 && !r.over; i++) {
        if (r.phase === 'aim' && r.current === 'a') r.shoot(shot(src.choice(FULL_CLUBS), src.range(0.3, 1), src.range(-10, 10), src.range(-0.5, 0.5)))
        r.step(); for (const e of r.events) log.push(JSON.stringify(e))
      }
      return log.join('\n') + JSON.stringify(r.snapshot())
    }
    expect(run()).toBe(run())
  })
  it('bot vs bot finishes three holes within the pick-up cap for several seeds', () => {
    const cap = HOLES.reduce((s, h) => s + h.par + 4, 0)
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = new GolfRound({ seed, botA: TIERS.pro, botB: TIERS.rookie })
      const ev = until(r, ['round_end'], HZ * 3000)
      expect(r.phase).toBe('round_end')
      expect(kinds(ev).filter((k) => k === 'wind')).toHaveLength(2)
      const t = r.scorecard().totals
      expect(t.a).toBeLessThanOrEqual(cap); expect(t.b).toBeLessThanOrEqual(cap)
      expect(r.scorecard().holes).toHaveLength(3)
    }
  })
  it('champ beats rookie on average over six seeds', () => {
    let champ = 0, rookie = 0
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const r = new GolfRound({ seed, botA: TIERS.champ, botB: TIERS.rookie })
      until(r, ['round_end'], HZ * 3000)
      const t = r.scorecard().totals; champ += t.a; rookie += t.b
    }
    expect(champ).toBeLessThan(rookie)
  })
})
