import { describe, expect, it } from 'vitest'
import { BoxingMatch, resolveBackSteps } from './match'
import { DODGE_REWARD, DODGE_STAMINA, HZ, REGEN_IDLE, STAMINA_MAX } from './constants'
import { cmd } from './types'

/** A fighting-phase match with the two fighters inside jab reach, no bots. */
function inReach(): BoxingMatch {
  const m = new BoxingMatch({ seed: 3, botA: null, botB: null })
  while (m.phase !== 'fighting') m.step(null, null)
  m.a.pos.z = m.b.pos.z - 0.9
  return m
}

describe('pace: stamina rules that keep a fight moving', () => {
  it('moving costs nothing: a fighter walking refills as fast as one standing still', () => {
    const walker = inReach(), stander = inReach()
    walker.a.stamina = 40; stander.a.stamina = 40
    for (let i = 0; i < HZ; i++) { walker.step(cmd({ forward: 1 }), null); stander.step(null, null) }
    expect(walker.a.stamina - 40).toBeCloseTo(REGEN_IDLE, 0)
    expect(walker.a.stamina).toBeCloseTo(stander.a.stamina, 0)
  })
  it('a dodge that evades a punch pays back more than it cost; a dodge into nothing only costs', () => {
    const m = inReach()
    m.b.stamina = 50
    // b dodges as a's jab goes active: the jab whiffs and b is paid
    m.step(cmd({ punch: 'jab' }), null)
    const startedAt = m.b.stamina
    for (let i = 0; i < 10; i++) m.step(null, i === 0 ? cmd({ dodge: 'swayL' }) : null)
    for (let i = 0; i < 20; i++) m.step(null, null)
    expect(m.a.landed).toBe(0) // the jab whiffed
    // net effect of the evading dodge: paid the cost, got the reward, plus a little regen once idle again
    expect(m.b.stamina).toBeGreaterThan(startedAt - DODGE_STAMINA + DODGE_REWARD - 1)
    // a dodge with nobody punching is just the cost, plus the refill that never stops outside a punch
    const n = inReach(); n.b.stamina = 50
    n.step(null, cmd({ dodge: 'swayR' }))
    expect(n.b.stamina).toBeCloseTo(50 - DODGE_STAMINA + REGEN_IDLE / HZ, 1)
    expect(Math.min(STAMINA_MAX, 50 + DODGE_REWARD)).toBeGreaterThan(50)
  })
  it('two fighters cannot both back away in the same tick: the lower-stamina one keeps the step, ties go to A', () => {
    const back = cmd({ forward: -1 }), fwd = cmd({ forward: 1 })
    const [a1, b1] = resolveBackSteps(back, back, 80, 30)
    expect(a1.forward).toBe(0); expect(b1.forward).toBe(-1)
    const [a2, b2] = resolveBackSteps(back, back, 30, 80)
    expect(a2.forward).toBe(-1); expect(b2.forward).toBe(0)
    const [a3, b3] = resolveBackSteps(back, back, 50, 50)
    expect(a3.forward).toBe(-1); expect(b3.forward).toBe(0)
    const [a4, b4] = resolveBackSteps(back, fwd, 50, 50)
    expect(a4).toBe(back); expect(b4).toBe(fwd); expect(back.forward).toBe(-1)
  })
})
