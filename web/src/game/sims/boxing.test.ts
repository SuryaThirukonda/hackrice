import { describe, expect, it } from 'vitest'
import { BoxingSim, JAB } from './boxing'
import type { StartPayload } from './types'

function start(seed = 3, mode: '1p' | '2p' | 'card' = '1p', tierParams: Record<string, unknown> = {}): StartPayload {
  const params = { aggression: 0.55, telegraph_ms: 600, reaction_ms: 500, pattern: ['jab', 'jab', 'hook'], dodge_p: 0.08, block_p: 0.3, ...tierParams }
  return { match_id: 'm', sport: 'boxing', seed, mode, card: mode === 'card', tier: { id: 'rookie', name: 'Sparring Sam', params }, tier_b: mode === 'card' ? { id: 'boss', name: 'The House Champ', params: { ...params, aggression: 1.1, reaction_ms: 160, block_p: 0.6, dodge_p: 0.35 } } : null,
    players: mode === '2p' ? { A: 'Ann', B: 'Bo' } : { P1: 'Sim' }, seats: mode === '2p' ? [{ seat_id: 'A' }, { seat_id: 'B' }] : mode === 'card' ? [] : [{ seat_id: 'P1' }],
    scenario: {}, adjustments: {}, game: { boxing: { rounds: 3, round_s: 60, rest_s: 4, down_s: 3 } }, betting_s: 12, between_s: 2 }
}
const g = (kind: string, extra: Record<string, unknown> = {}, power = 0.8) => ({ seat_id: 'P1', kind, power, t_server: 0, duration_ms: 80, extra })
function run(sim: BoxingSim, n: number, dt = 0.016) { const evs: { kind: string; result?: string }[] = []; for (let i = 0; i < n; i++) { sim.step(dt); evs.push(...sim.events) } return evs }

describe('boxing physics', () => {
  it('whiffs out of reach, lands after windup in reach, knocks back', () => {
    const sim = new BoxingSim(); sim.setup(start()); sim.planTurn(); sim.b.ai = null
    sim.a.x = -0.9; sim.b.x = 0.9
    sim.onGesture('P1', g('punch', { type: 'jab' }))
    expect(run(sim, 40).some((e) => e.kind === 'punch' && e.result === 'whiff')).toBe(true)
    expect(sim.b.hp).toBe(100)
    sim.onGesture('P1', g('move', { dir: 1 })); run(sim, 120); sim.onGesture('P1', g('move_stop'))
    expect(Math.abs(sim.b.x - sim.a.x)).toBeLessThanOrEqual(JAB.reach + 0.02)
    const hp0 = sim.b.hp
    sim.onGesture('P1', g('punch', { type: 'jab' }, 1)); sim.step(0.016)
    expect(sim.b.hp).toBe(hp0)                       // no damage during the windup
    const evs = run(sim, 30)
    expect(evs.some((e) => e.kind === 'punch' && e.result === 'hit')).toBe(true)
    expect(sim.b.hp).toBeLessThan(hp0)
    expect(sim.b.x).toBeGreaterThan(0)                // knocked back
  })

  it('block absorbs to chip damage, parry stuns, dodge avoids, stamina gates', () => {
    const sim = new BoxingSim(); sim.setup(start(5)); sim.planTurn(); sim.b.ai = null
    sim.a.x = -0.12; sim.b.x = 0.12
    sim.b.wantsGuard = true; sim.step(0.016)
    const hp1 = sim.b.hp
    sim.onGesture('P1', g('punch', { type: 'jab' }, 1)); run(sim, 30)
    expect(hp1 - sim.b.hp).toBeGreaterThan(0); expect(hp1 - sim.b.hp).toBeLessThan(3)
    sim.b.wantsGuard = false; run(sim, 60)
    sim.startPunch(sim.b, 'hook', 1); run(sim, 6)
    sim.onGesture('P1', g('parry')); sim.step(0.016)
    expect(sim.b.state).toBe('stunned')
    run(sim, 80)
    sim.dodge(sim.b, 1)
    const hp2 = sim.b.hp
    sim.onGesture('P1', g('punch', { type: 'jab' }, 1))
    const evs = run(sim, 12)
    expect(evs.some((e) => e.kind === 'punch' && e.result === 'dodged') || sim.b.hp === hp2).toBe(true)
    sim.a.stamina = 2; sim.a.state = 'idle'
    const thrown = sim.a.thrown
    sim.onGesture('P1', g('punch', { type: 'hook' }))
    expect(sim.a.thrown).toBe(thrown)
    expect(sim.events.some((e) => e.kind === 'gassed')).toBe(true)
  })

  it('knockdown counts, KO ends the match, rounds resolve deterministically', () => {
    const play = (seed: number) => {
      const sim = new BoxingSim(); sim.setup(start(seed)); const outcomes: string[] = []
      while (sim.planTurn()) {
        for (const r of sim.decisionsBefore('input')) sim.applyDecision(r, r.default)
        let t = 0
        while (!sim.inputDone()) {
          if (Math.abs((t % 1.2)) < 0.02) sim.onGesture('P1', g('punch', { type: 'jab' }))
          sim.a.moveDir = Math.abs(sim.b.x - sim.a.x) > 0.3 ? 1 : 0
          sim.step(0.016); t += 0.016
        }
        outcomes.push(sim.resolve().outcome)
      }
      return { outcomes, w: sim.winner(), thrown: sim.b.thrown, landed: sim.a.landed + sim.b.landed, kd: sim.a.knockdowns + sim.b.knockdowns }
    }
    const x = play(7), y = play(7)
    expect(x).toEqual(y)
    expect(x.outcomes.length).toBeGreaterThanOrEqual(1); expect(x.thrown).toBeGreaterThan(5); expect(x.landed).toBeGreaterThan(3)
    expect(['human', 'house', 'tie']).toContain(x.w)
    const sim = new BoxingSim(); sim.setup(start(9)); sim.planTurn(); sim.b.ai = null; sim.a.x = -0.12; sim.b.x = 0.12; sim.b.hp = 51
    sim.onGesture('P1', g('punch', { type: 'hook' }, 1)); const evs = run(sim, 40)
    expect(evs.some((e) => e.kind === 'knockdown')).toBe(true); expect(sim.b.state).toBe('down')
    const counts = [...evs, ...run(sim, 200)].filter((e) => e.kind === 'count').length
    expect(counts).toBeGreaterThanOrEqual(9)
    expect(sim.b.state).toBe('idle')
    sim.a.x = -0.12; sim.b.x = 0.12; sim.a.state = 'idle'; sim.b.hp = 4; sim.onGesture('P1', g('punch', { type: 'hook' }, 1)); run(sim, 40)
    expect(sim.ko).toBe('human'); expect(sim.inputDone()).toBe(true); expect(sim.planTurn()).toBeNull()
  })

  it('two players and the card both work without the House AI on both sides', () => {
    const two = new BoxingSim(); two.setup(start(4, '2p')); two.planTurn()
    expect(two.a.ai).toBeNull(); expect(two.b.ai).toBeNull()
    two.onGesture('B', { ...g('punch', { type: 'jab' }), seat_id: 'B' })
    expect(two.b.state).toBe('windup')
    const card = new BoxingSim(); card.setup(start(11, 'card')); 
    let rounds = 0
    while (card.planTurn()) { rounds++; for (const r of card.decisionsBefore('input')) card.applyDecision(r, r.default); while (!card.inputDone()) card.step(0.016); card.resolve() }
    expect(rounds).toBeGreaterThanOrEqual(1); expect(card.a.thrown + card.b.thrown).toBeGreaterThan(10); expect(['a', 'b', 'tie']).toContain(card.winner())
  })

  it('the boss learns a metronome rhythm and guards on the beat', () => {
    const sim = new BoxingSim(); sim.setup(start(2, '1p', { rhythm_learner: true, reaction_ms: 9999, aggression: 0 })); sim.planTurn()
    sim.a.x = -0.12; sim.b.x = 0.12
    let blocked = 0
    for (let i = 0; i < 700; i++) {
      if (i % 56 === 0 && i > 0) sim.onGesture('P1', g('punch', { type: 'jab' }))
      sim.step(0.016); blocked += sim.events.filter((e) => e.kind === 'rhythm').length
      sim.b.moveDir = 0
    }
    expect(sim.learner!.hitsPredicted).toBeGreaterThanOrEqual(4); expect(blocked).toBeGreaterThanOrEqual(4)
  })
})
