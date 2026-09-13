import { describe, expect, it } from 'vitest'
import { BoxingMatch } from './match'
import { REGEN_IDLE, REGEN_GUARD_MUL, BODY_GAP, BLOCK_DMG_MUL, DODGE_COOLDOWN, DT, FRAME, FRICTION, GUARD_RECOVER_STAMINA, HZ, RING_HALF, START_DIST, STAGGER_DMG, STAMINA_MAX } from './constants'
import { TIERS } from './tiers'
import { Rng } from './rng'
import { cmd, IDLE, type Command, type SimEvent } from './types'

/** Match with no bots (both sides scripted) that is already in the fighting phase. */
function fighting(seed = 1, cfg: Partial<ConstructorParameters<typeof BoxingMatch>[0]> = {}): BoxingMatch {
  const m = new BoxingMatch({ seed, botA: null, botB: null, ...cfg })
  while (m.phase === 'countdown') m.step(IDLE, IDLE)
  return m
}
type Src = Command | (() => Command) | null
/** null means "let the bot decide". */
function run(m: BoxingMatch, n: number, a: Src = IDLE, b: Src = IDLE): SimEvent[] {
  const ev: SimEvent[] = []
  for (let i = 0; i < n; i++) {
    m.step(typeof a === 'function' ? a() : a, typeof b === 'function' ? b() : b)
    ev.push(...m.events)
  }
  return ev
}
/** Put fighters on the z axis, d apart, both idle. */
function place(m: BoxingMatch, d: number): void {
  m.a.pos.x = 0; m.a.pos.z = -d / 2; m.b.pos.x = 0; m.b.pos.z = d / 2
  m.a.vKnock.x = m.a.vKnock.z = m.b.vKnock.x = m.b.vKnock.z = 0
  m.dir = { x: 0, z: 1 }
}
const once = (c: Command): (() => Command) => { let sent = false; return () => { if (sent) return IDLE; sent = true; return c } }
/** Steps from the throw tick until the impact tick inclusive. */
const IMPACT = (k: 'jab' | 'cross') => FRAME[k].windup + 1
const punches = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { kind: 'punch' }> => e.kind === 'punch')

describe('timestep and determinism', () => {
  it('120 steps advance the round clock by exactly one second', () => {
    const m = fighting()
    const t0 = m.roundTick
    run(m, HZ)
    expect(m.roundTick - t0).toBe(HZ)
    expect(DT * HZ).toBeCloseTo(1, 12)
  })
  it('same seed and same inputs replay identically, bots included', () => {
    const play = () => {
      const m = new BoxingMatch({ seed: 42, botB: TIERS.pro })
      const r = new Rng(7)
      const log: string[] = []
      for (let i = 0; i < 1500; i++) {
        const c = cmd({ punch: r.next() < 0.03 ? 'jab' : r.next() < 0.02 ? 'cross' : null, block: r.next() < 0.2, forward: r.next() < 0.5 ? 1 : 0, dodge: r.next() < 0.01 ? 'swayL' : null })
        m.step(c)
        for (const e of m.events) log.push(JSON.stringify(e))
      }
      return log.join('\n') + JSON.stringify(m.snapshot())
    }
    expect(play()).toBe(play())
  })
})

describe('punch resolution (auto-target)', () => {
  it('a jab in range lands exactly at the end of windup, not before', () => {
    const m = fighting(); place(m, 0.9)
    const w = FRAME.jab.windup
    const hp0 = m.b.hp
    m.step(cmd({ punch: 'jab' }), IDLE) // tick 1: windup starts, stateT = 12
    for (let i = 1; i < w; i++) { m.step(IDLE, IDLE); expect(m.b.hp).toBe(hp0) }
    m.step(IDLE, IDLE) // tick w+1: windup -> active -> resolve
    expect(m.b.hp).toBeLessThan(hp0)
    expect(m.events.some((e) => e.kind === 'punch' && e.result === 'hit')).toBe(true)
  })
  it('whiffs out of range and hits in range regardless of lateral offset', () => {
    const m = fighting(); place(m, 2.0)
    const ev = run(m, 60, once(cmd({ punch: 'jab' })))
    expect(punches(ev)[0]?.result).toBe('whiff')
    const m2 = fighting(); place(m2, 0.9); m2.b.pos.x = 0.4; m2.dir = { x: 0, z: 1 }
    const ev2 = run(m2, 60, once(cmd({ punch: 'jab' })))
    expect(punches(ev2)[0]?.result).toBe('hit')
  })
  it('a punch thrown while stepping in carries momentum: ~1.5x damage and more knockback', () => {
    const still = fighting(); place(still, 1.0)
    const evS = run(still, 60, once(cmd({ punch: 'cross' })))
    const dmgS = punches(evS)[0].dmg
    const moving = fighting(); place(moving, 1.5)
    run(moving, 30, cmd({ forward: 1 }))
    const evM = run(moving, 60, once(cmd({ punch: 'cross', forward: 1 })))
    const hit = punches(evM)[0]
    expect(hit.result).toBe('hit')
    expect(hit.momentum).toBeCloseTo(1, 5)
    expect(hit.dmg / dmgS).toBeCloseTo(1.5, 5)
  })
  it('knockback pushes the target back and decays with friction to zero', () => {
    const m = fighting(); place(m, 1.0)
    run(m, IMPACT('cross'), once(cmd({ punch: 'cross' })))
    expect(m.b.vKnock.z).toBeGreaterThan(0)
    const z0 = m.b.pos.z
    let last = m.b.pos.z, monotone = true
    for (let i = 0; i < 120; i++) { m.step(IDLE, IDLE); if (m.b.pos.z < last - 1e-9) monotone = false; last = m.b.pos.z }
    expect(monotone).toBe(true)
    expect(m.b.vKnock.z).toBe(0)
    expect(m.b.pos.z - z0).toBeGreaterThan(0.1)
    expect(m.b.pos.z - z0).toBeLessThan(FRAME.cross.knock / FRICTION + 0.05)
  })
})

describe('dodge', () => {
  it('a sway issued on the impact tick avoids the punch; one tick late does not', () => {
    const w = FRAME.jab.windup
    const m1 = fighting(); place(m1, 0.9)
    m1.step(cmd({ punch: 'jab' }), IDLE)
    for (let i = 1; i < w; i++) m1.step(IDLE, IDLE)
    m1.step(IDLE, cmd({ dodge: 'swayL' }))
    expect(m1.events.some((e) => e.kind === 'punch' && e.result === 'dodged')).toBe(true)
    expect(m1.b.hp).toBe(100)
    const m2 = fighting(); place(m2, 0.9)
    m2.step(cmd({ punch: 'jab' }), IDLE)
    for (let i = 1; i < w; i++) m2.step(IDLE, IDLE)
    m2.step(IDLE, IDLE) // impact
    expect(m2.b.hp).toBeLessThan(100)
  })
  it('a duck also avoids, and a second dodge inside the cooldown is refused', () => {
    const m = fighting(); place(m, 0.9)
    const ev = run(m, 3, IDLE, once(cmd({ dodge: 'duck' })))
    expect(ev.filter((e) => e.kind === 'dodge')).toHaveLength(1)
    const ev2 = run(m, DODGE_COOLDOWN - 10, IDLE, once(cmd({ dodge: 'swayR' })))
    expect(ev2.filter((e) => e.kind === 'dodge')).toHaveLength(0)
    const ev3 = run(m, 40, IDLE, cmd({ dodge: 'swayR' })) // held every tick: accepted exactly once when the cooldown ends
    expect(ev3.filter((e) => e.kind === 'dodge')).toHaveLength(1)
  })
})

describe('block and guard', () => {
  it('a held guard auto-blocks: damage <= 15% and the defender pays stamina', () => {
    const open = fighting(); place(open, 1.0)
    const dOpen = punches(run(open, 60, once(cmd({ punch: 'cross' }))))[0].dmg
    const m = fighting(); place(m, 1.0)
    m.b.stamina = 50 // below the cap, so the refill on both runs is comparable
    const st0 = m.b.stamina, hp0 = m.b.hp
    const ev = run(m, 60, once(cmd({ punch: 'cross' })), cmd({ block: true }))
    const p = punches(ev)[0]
    expect(p.result).toBe('blocked')
    expect(p.dmg).toBeLessThanOrEqual(dOpen * BLOCK_DMG_MUL + 1e-9)
    expect(hp0 - m.b.hp).toBeLessThan(dOpen * 0.2)
    // the refill runs while guarding, so isolate the block's cost against a guard held with nothing thrown
    const idle = fighting(); place(idle, 1.0); idle.b.stamina = st0
    run(idle, 60, null, cmd({ block: true }))
    expect(idle.b.stamina - m.b.stamina).toBeCloseTo(FRAME.cross.blockCost, 0)
    expect(m.a.stamina).toBeLessThanOrEqual(STAMINA_MAX - FRAME.cross.stamina + 5)
  })
  it('punches can be blocked on reaction: a guard raised 140 ms into a jab or 250 ms into a cross still blocks', () => {
    // A punch resolves against the guard as it stands on its first active tick, so the wind-up is the
    // defender's whole window. These margins are what the frame data is tuned for; a shorter wind-up fails here.
    const guardAfter = (ticks: number) => { let t = 0; return () => cmd({ block: t++ >= ticks }) }
    for (const [kind, reactMs] of [['jab', 140], ['cross', 250]] as const) {
      const react = Math.round((reactMs / 1000) * HZ)
      const inTime = fighting(); place(inTime, 1.0)
      expect(punches(run(inTime, 90, once(cmd({ punch: kind })), guardAfter(react)))[0].result).toBe('blocked')
      // one tick after the wind-up ends is too late: the window is exactly the wind-up
      const late = fighting(); place(late, 1.0)
      expect(punches(run(late, 90, once(cmd({ punch: kind })), guardAfter(FRAME[kind].windup + 1)))[0].result).toBe('hit')
    }
  })
  it('the guard breaks at zero stamina, the next punch lands even with block held, and recovers at 15 stamina', () => {
    const m = fighting(); place(m, 0.9)
    m.b.stamina = 1 // a held guard refills, so it has to be nearly empty to break
    const ev = run(m, IMPACT('cross'), once(cmd({ punch: 'cross' })), cmd({ block: true }))
    expect(ev.some((e) => e.kind === 'guard_break')).toBe(true)
    expect(m.b.stamina).toBeLessThan(1) // broken at zero, then the refill starts again
    expect(m.b.state).toBe('stagger')
    expect(m.b.guard).toBe(false)
    run(m, 48, IDLE, cmd({ block: true })) // a finishes recovering while b is still staggered / guard-broken
    const ev2 = run(m, 40, once(cmd({ punch: 'jab' })), cmd({ block: true }))
    expect(punches(ev2)[0].result).toBe('hit')
    m.b.stamina = GUARD_RECOVER_STAMINA
    run(m, 80, IDLE, cmd({ block: true }))
    expect(m.b.guardBroken).toBe(false)
    expect(m.b.guard).toBe(true)
  })
})

describe('stagger, hitstun, stamina', () => {
  it('a heavy hit staggers and cancels the target windup; a jab only hitstuns', () => {
    const m = fighting(); place(m, 1.0)
    const ev = run(m, IMPACT('cross'), once(cmd({ punch: 'cross', forward: 1 })), once(cmd({ punch: 'cross' })))
    // a threw first (both threw on tick 1, symmetric); a's cross with forward momentum lands as a's momentum is ~0 here, so check by damage
    const hit = punches(ev).find((p) => p.result === 'hit')!
    if (hit.dmg >= STAGGER_DMG) expect(ev.some((e) => e.kind === 'stagger')).toBe(true)
    const m2 = fighting(); place(m2, 0.9)
    const ev2 = run(m2, 40, once(cmd({ punch: 'jab' })))
    expect(punches(ev2)[0].result).toBe('hit')
    expect(ev2.some((e) => e.kind === 'stagger')).toBe(false)
    expect(m2.b.state === 'hitstun' || m2.b.state === 'idle').toBe(true)
    // stepping-in cross on an idle target staggers
    const m3 = fighting(); place(m3, 1.3)
    run(m3, 30, cmd({ forward: 1 }))
    const ev3 = run(m3, 60, once(cmd({ punch: 'cross', forward: 1 })))
    expect(ev3.some((e) => e.kind === 'stagger')).toBe(true)
  })
  it('a punch interrupts the target windup so it never lands', () => {
    const m = fighting(); place(m, 0.9)
    m.step(cmd({ punch: 'jab' }), IDLE)
    for (let i = 0; i < 6; i++) m.step(IDLE, IDLE)
    m.step(IDLE, cmd({ punch: 'cross' })) // b starts a cross mid a's windup
    const ev = run(m, 60)
    const ps = punches(ev)
    expect(ps.some((p) => p.who === 'a' && p.result === 'hit')).toBe(true)
    expect(ps.some((p) => p.who === 'b')).toBe(false)
  })
  it('stamina: punches cost, idle regen is 40/s, gassed fighters cannot punch, tired punches are slow and weak', () => {
    const m = fighting(); place(m, 1.0)
    run(m, 2, once(cmd({ punch: 'jab' })))
    expect(m.a.stamina).toBeCloseTo(STAMINA_MAX - FRAME.jab.stamina, 5)
    run(m, 60)
    m.a.stamina = 50
    const s0 = m.a.stamina
    run(m, HZ)
    expect(m.a.stamina - s0).toBeCloseTo(REGEN_IDLE, 0)
    m.a.stamina = 3
    const ev = run(m, 5, once(cmd({ punch: 'jab' })))
    expect(ev.some((e) => e.kind === 'gassed')).toBe(true)
    expect(ev.some((e) => e.kind === 'windup')).toBe(false)
    m.a.stamina = 10
    const ev2 = run(m, 80, once(cmd({ punch: 'jab' })))
    const w = ev2.find((e): e is Extract<SimEvent, { kind: 'windup' }> => e.kind === 'windup')!
    expect(w.ticks).toBeGreaterThan(FRAME.jab.windup)
    expect(punches(ev2)[0].dmg).toBeLessThan(FRAME.jab.dmg)
  })
})

describe('ring and bodies', () => {
  it('3000 ticks of random inputs keep both inside the ropes and apart', () => {
    const m = fighting(3)
    const r = new Rng(99)
    const rc = (): Command => cmd({ forward: ([-1, 0, 1] as const)[r.int(0, 2)], strafe: ([-1, 0, 1] as const)[r.int(0, 2)], punch: r.next() < 0.05 ? 'cross' : null, dodge: r.next() < 0.02 ? 'swayR' : null, block: r.next() < 0.3 })
    for (let i = 0; i < 3000; i++) {
      m.step(rc(), rc())
      if (m.phase !== 'fighting') break
      for (const f of [m.a, m.b]) { expect(Math.abs(f.pos.x)).toBeLessThanOrEqual(RING_HALF + 1e-9); expect(Math.abs(f.pos.z)).toBeLessThanOrEqual(RING_HALF + 1e-9) }
      expect(m.distance()).toBeGreaterThanOrEqual(BODY_GAP - 1e-6)
    }
  })
  it('a rope-pinned defender never crosses the rope; the attacker is pushed back instead', () => {
    const m = fighting(); place(m, BODY_GAP + 0.05)
    m.b.pos.z = RING_HALF; m.a.pos.z = RING_HALF - BODY_GAP - 0.05
    run(m, 200, cmd({ forward: 1 }))
    expect(m.b.pos.z).toBeLessThanOrEqual(RING_HALF + 1e-9)
    expect(m.distance()).toBeGreaterThanOrEqual(BODY_GAP - 1e-6)
  })
})

describe('rounds, knockdowns, KO', () => {
  it('countdown 3,2,1,0 then bell, and round 1 starts at START_DIST', () => {
    const m = new BoxingMatch({ seed: 1, botA: null, botB: null })
    const ev = run(m, 4 * HZ + 2)
    expect(ev.filter((e) => e.kind === 'countdown').map((e) => (e as { n: number }).n)).toEqual([3, 2, 1, 0])
    expect(ev.some((e) => e.kind === 'bell' && !e.end)).toBe(true)
    expect(m.phase).toBe('fighting')
    expect(m.distance()).toBeCloseTo(START_DIST, 5)
  })
  it('a knockdown freezes the clock, counts to 8, gets up, resets positions', () => {
    const m = fighting(); place(m, 1.0)
    m.b.hp = 61
    const ev = run(m, IMPACT('cross'), once(cmd({ punch: 'cross' })))
    expect(ev.some((e) => e.kind === 'knockdown' && !e.ko)).toBe(true)
    expect(m.phase).toBe('count')
    const rt = m.roundTick
    const ev2 = run(m, 8 * HZ)
    expect(ev2.filter((e) => e.kind === 'count').map((e) => (e as { n: number }).n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(ev2.some((e) => e.kind === 'getup')).toBe(true)
    expect(m.phase).toBe('fighting')
    expect(m.distance()).toBeCloseTo(START_DIST, 5)
    expect(m.b.stamina).toBeGreaterThanOrEqual(40)
    expect(m.roundTick).toBe(rt)
  })
  it('hp 0 is a KO: counted to 10, match over, no further events', () => {
    const m = fighting(); place(m, 1.0)
    m.b.hp = 5
    const ev = run(m, IMPACT('cross') + 11 * HZ, once(cmd({ punch: 'cross' })))
    expect(ev.some((e) => e.kind === 'knockdown' && e.ko)).toBe(true)
    expect(ev.filter((e) => e.kind === 'count')).toHaveLength(10)
    expect(ev.some((e) => e.kind === 'ko')).toBe(true)
    expect(m.phase).toBe('over')
    expect(m.getResult()).toEqual({ winner: 'a', by: 'ko', round: 1 })
    expect(run(m, 100)).toHaveLength(0)
  })
  it('rounds end on the bell, rest, next round, and decision by damage dealt', () => {
    const m = new BoxingMatch({ seed: 1, botA: null, botB: null, roundS: 2, restS: 1 })
    const ev = run(m, HZ * 24, () => (m.phase === 'fighting' && m.round === 1 ? cmd({ forward: m.distance() > 0.9 ? 1 : 0, punch: m.distance() <= 1.0 && m.roundTick % 40 === 0 ? 'jab' : null }) : IDLE))
    const bells = ev.filter((e): e is Extract<SimEvent, { kind: 'bell' }> => e.kind === 'bell')
    expect(bells.filter((b) => b.end).map((b) => b.round)).toEqual([1, 2, 3])
    const d = ev.find((e): e is Extract<SimEvent, { kind: 'decision' }> => e.kind === 'decision')!
    expect(d.winner).toBe('a')
    expect(m.getResult()?.by).toBe('decision')
    const draw = new BoxingMatch({ seed: 1, botA: null, botB: null, roundS: 1, restS: 0.5 })
    run(draw, HZ * 18)
    expect(draw.getResult()).toEqual({ winner: 'draw', by: 'draw', round: 3 })
  })
})

describe('bots', () => {
  it('a rookie closes distance and throws within 600 ticks', () => {
    const m = new BoxingMatch({ seed: 5, botA: null, botB: TIERS.rookie })
    while (m.phase === 'countdown') m.step(IDLE)
    place(m, 2.5)
    const ev = run(m, 600, IDLE, null)
    expect(ev.some((e) => e.kind === 'windup' && e.who === 'b')).toBe(true)
  })
  it('a champ defends more than a rookie against a scripted attacker', () => {
    const defended = (tier: keyof typeof TIERS) => {
      let total = 0, def = 0
      for (let seed = 1; seed <= 6; seed++) {
        const m = new BoxingMatch({ seed, botA: null, botB: TIERS[tier], roundS: 30 })
        while (m.phase === 'countdown') m.step(IDLE)
        let t = 0
        const ev = run(m, 30 * HZ, () => (++t % 70 === 0 ? cmd({ punch: 'cross', forward: 1 }) : cmd({ forward: m.distance() > 1.0 ? 1 : 0 })), null)
        for (const p of punches(ev)) if (p.who === 'a' && p.result !== 'whiff') { total++; if (p.result !== 'hit') def++ }
      }
      return def / Math.max(1, total)
    }
    expect(defended('champ')).toBeGreaterThan(defended('rookie'))
  })
  it('a bot never retreats: low stamina never produces a step back, only guard, dodges and punches', () => {
    const m = new BoxingMatch({ seed: 5, botA: null, botB: TIERS.pro })
    while (m.phase !== 'fighting') m.step(null, null)
    m.b.stamina = 10
    let backSteps = 0
    for (let i = 0; i < 600; i++) { const c = m.botB!.decide(m.b, m.a, m.distance(), m.tick + i, m.rng); if (c.forward < 0) backSteps++ }
    expect(backSteps).toBe(0)
  })
  it('bot vs bot completes 20 seeded matches with all invariants intact', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = new BoxingMatch({ seed, botA: TIERS.pro, botB: TIERS.champ, roundS: 40, restS: 1 })
      let n = 0
      while (!m.over && n < HZ * 400) {
        m.step(); n++
        for (const f of [m.a, m.b]) {
          const bad = Number.isNaN(f.pos.x + f.pos.z + f.hp + f.stamina) || f.hp < 0 || f.hp > 100 || f.stamina < 0 || f.stamina > STAMINA_MAX || Math.abs(f.pos.x) > RING_HALF + 1e-9 || Math.abs(f.pos.z) > RING_HALF + 1e-9
          if (bad) throw new Error(`invariant broken seed ${seed} tick ${n}: ${JSON.stringify(f)}`)
        }
      }
      expect(m.over).toBe(true)
      expect(m.getResult()).not.toBeNull()
    }
  }, 30_000)
})

describe('fight feel: bot pressure, cadence, stamina economy', () => {
  const perMinute = (tier: keyof typeof TIERS, seeds = [1, 2, 3, 4]) => {
    let punches = 0, ticks = 0, closeBy = 0, bells = 0
    for (const seed of seeds) {
      const m = new BoxingMatch({ seed, botA: null, botB: TIERS[tier], roundS: 60, restS: 1 })
      let sinceBell = -1
      while (!m.over && ticks < 120 * 60 * 3 * seeds.length) {
        m.step(cmd({ forward: m.distance() > 1.05 ? 1 : 0, block: m.b.state === 'windup', punch: m.tick % 150 === 0 ? 'jab' : null }))
        ticks++
        for (const e of m.events) { if (e.kind === 'windup' && e.who === 'b') punches++; if (e.kind === 'bell' && !e.end) { bells++; sinceBell = 0 } }
        if (m.phase === 'fighting') { if (sinceBell >= 0) { sinceBell++; if (sinceBell === 120 * 3 && m.distance() <= FRAME.jab.reach + 0.05) closeBy++ } }
      }
    }
    return { ppm: (punches / (ticks / 120)) * 60, closeRate: closeBy / bells }
  }
  it('the bot comes forward: in reach shortly after each bell', () => {
    const r = perMinute('rookie')
    expect(r.closeRate).toBeGreaterThan(0.6)
  })
  it('punches per minute sit in the tier bands', () => {
    expect(perMinute('rookie').ppm).toBeGreaterThan(4); expect(perMinute('rookie').ppm).toBeLessThan(10)
    expect(perMinute('champ').ppm).toBeGreaterThan(perMinute('rookie').ppm)
    expect(perMinute('champ').ppm).toBeLessThan(36) // refill is 18/s and footwork is free, so a champ boxes at pace
  })
  it('stamina is a real limiter: a long run of jabs is refused, and a held guard refills at half rate', () => {
    const m = fighting(); place(m, 2.5) // out of reach so nothing lands; only costs matter
    // Refill is quick between exchanges but pauses for the whole punch (windup, active, recover), so a
    // fighter holding the jab button down still runs dry: the next jab starts the moment the arm is free.
    const ev = run(m, 42 * 30, cmd({ punch: 'jab' }))
    const thrown = ev.filter((e) => e.kind === 'windup').length
    const refused = ev.filter((e) => e.kind === 'gassed').length
    expect(thrown).toBeLessThanOrEqual(24)
    expect(refused).toBeGreaterThanOrEqual(1)
    const g = fighting(); place(g, 2.5)
    g.a.stamina = 40
    run(g, HZ, cmd({ block: true }))
    expect(g.a.stamina - 40).toBeCloseTo(REGEN_IDLE * REGEN_GUARD_MUL, 0) // a held guard still refills, at half rate
  })
})
