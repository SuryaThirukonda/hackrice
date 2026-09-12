import { describe, expect, it } from 'vitest'
import { Book, BAILOUT_TO, oddsFor, pA, START_CHIPS, type Form } from './book'

const even: Form = { hpA: 100, hpB: 100, staA: 100, staB: 100, kdA: 0, kdB: 0, roundsWonA: 0, roundsWonB: 0 }

describe('betting book', () => {
  it('odds favour the healthier corner and carry a house margin', () => {
    expect(pA(even)).toBeCloseTo(0.5, 6)
    const o = oddsFor(even)
    expect(o.a).toBeCloseTo(1.88, 2); expect(o.b).toBeCloseTo(1.88, 2)
    const hurtB = oddsFor({ ...even, hpB: 40, kdB: 1 })
    expect(hurtB.a).toBeLessThan(hurtB.b)
    expect(1 / hurtB.a + 1 / hurtB.b).toBeGreaterThan(1) // margin
  })
  it('places stakes, pays winners floor(stake * odds), refunds draws, conserves the ledger', () => {
    const b = new Book()
    const m = b.openMarket('round', 1, even)
    expect(b.place(m.id, 'a', 5).ok).toBe(false)
    expect(b.place(m.id, 'a', 10_000).ok).toBe(false)
    expect(b.place(m.id, 'a', 100).ok).toBe(true)
    expect(b.place(m.id, 'b', 50).ok).toBe(true)
    expect(b.balance).toBe(START_CHIPS - 150)
    b.closeMarkets()
    expect(b.place(m.id, 'a', 10).ok).toBe(false)
    const r = b.settle(m.id, 'a')
    expect(r.paid).toBe(Math.floor(100 * m.odds.a))
    expect(b.balance).toBe(START_CHIPS - 150 + Math.floor(100 * m.odds.a))
    expect(b.settle(m.id, 'a').paid).toBe(0) // idempotent
    const d = b.openMarket('round', 2, even); b.place(d.id, 'b', 40); b.settle(d.id, 'draw')
    expect(b.balance).toBe(START_CHIPS - 150 + Math.floor(100 * m.odds.a))
    expect(b.conserved()).toBe(true)
    expect(b.won).toBe(1); expect(b.lost).toBe(1)
  })
  it('bails out a bankrupt bettor once every market is settled', () => {
    const b = new Book(20)
    const m = b.openMarket('match', 1, even)
    b.place(m.id, 'a', 20)
    b.settle(m.id, 'b')
    expect(b.balance).toBe(BAILOUT_TO)
    expect(b.ledger.at(-1)?.reason).toBe('bailout')
    expect(b.conserved()).toBe(true)
  })
})
