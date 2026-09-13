import { describe, expect, it } from 'vitest'
import { BoxingMatch } from './match'
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
    // a dodge with nobody punching is just the cost; a dodging fighter is not idle, so no refill that tick
    const n = inReach(); n.b.stamina = 50
    n.step(null, cmd({ dodge: 'swayR' }))
    expect(n.b.stamina).toBeCloseTo(50 - DODGE_STAMINA, 5)
    expect(Math.min(STAMINA_MAX, 50 + DODGE_REWARD)).toBeGreaterThan(50)
  })
})
