import { describe, expect, it } from 'vitest'
import { HealthStore } from './health'
import type { Epoch } from '../src/health/energy'

const sec = (t: number, mean: number, swings = 0): Epoch => ({ t: t * 1000, mean, peak: mean * 3, swings, rotation: 0 })
const minute = (mean: number, from = 0): Epoch[] => Array.from({ length: 60 }, (_, i) => sec(from + i, mean))

describe('HealthStore', () => {
  it('records a session, recomputes its summary on finish, and rolls it into the day and sport totals', () => {
    const db = new HealthStore(':memory:')
    const t0 = Date.parse('2026-09-12T18:00:00')
    const id = db.start({ sport: 'boxing', controller: 'controller_1', startedAt: t0, weightKg: 70, source: 'phone' })
    db.add(id, minute(4), [90, 110])
    db.add(id, minute(0.2, 60), [])
    const row = db.finish(id, t0 + 120_000)
    expect(row).toMatchObject({ id, sport: 'boxing', durationMs: 120_000, activeSeconds: 60, activeMinutes: 1, swings: 0, romMean: 100, romMax: 110 })
    expect(row!.kcal).toBeGreaterThan(0)
    const s = db.summary(t0 + 3_600_000, 7)
    expect(s.today.sessions).toBe(1); expect(s.today.activeSeconds).toBe(60)
    expect(s.bySport.boxing.sessions).toBe(1); expect(s.bySport.golf.sessions).toBe(0)
    expect(s.days).toHaveLength(7); expect(s.streakDays).toBe(1)
    expect(s.lastSession?.epochs).toHaveLength(120)
    db.close()
  })
  it('ignores a duplicate epoch delivered twice, so a retried post cannot double the calories', () => {
    const db = new HealthStore(':memory:')
    const id = db.start({ sport: 'golf', controller: 'controller_1', startedAt: 0, weightKg: 70, source: 'phone' })
    db.add(id, minute(3), [])
    db.add(id, minute(3), []) // same seconds again
    expect(db.finish(id, 60_000)!.activeSeconds).toBe(60)
    db.close()
  })
  it('a keyboard session stores as such, with no movement and no calories', () => {
    const db = new HealthStore(':memory:')
    const id = db.start({ sport: 'bowling', controller: 'keyboard', startedAt: 0, weightKg: 70, source: 'keyboard' })
    const row = db.finish(id, 300_000)!
    expect(row.source).toBe('keyboard'); expect(row.kcal).toBe(0); expect(row.activeSeconds).toBe(0)
    db.close()
  })
  it('clear wipes everything', () => {
    const db = new HealthStore(':memory:')
    const id = db.start({ sport: 'boxing', controller: 'controller_1', startedAt: 0, weightKg: 70, source: 'phone' })
    db.add(id, minute(4), [50]); db.finish(id, 60_000)
    db.clear()
    expect(db.sessions()).toEqual([]); expect(db.summary(0).today.sessions).toBe(0)
    db.close()
  })
})

describe('chips', () => {
  it('keeps every fight, bet and chip movement, and the balance is the last ledger row', () => {
    const db = new HealthStore(':memory:')
    expect(db.chipBalance(500)).toBe(500)
    const id = db.startFight({ startedAt: 1000, seed: 7, nameA: 'Blue', nameB: 'Red', chipsBefore: 500 })
    db.recordBet(id, { at: 1100, market: 'match1', kind: 'match', round: 1, corner: 'a', stake: 50, odds: 1.8 })
    db.settleMarket(id, 'match1', 'a', [{ corner: 'a', stake: 50, paid: 90 }], [{ at: 1200, reason: 'stake', amount: -50, balance: 450 }, { at: 1300, reason: 'payout', amount: 90, balance: 540 }])
    db.finishFight(id, { endedAt: 1400, winner: 'a', by: 'ko', round: 2, chipsAfter: 540, betsWon: 1, betsLost: 0, net: 40 })
    expect(db.chipBalance(500)).toBe(540)
    const s = db.chipSummary(500, 1400)
    expect(s).toMatchObject({ balance: 540, fights: 1, betsWon: 1, betsLost: 0, staked: 50, returned: 90, net: 40, best: 540, worst: 450, todayNet: 40 })
    expect(s.recentBets[0]).toMatchObject({ market: 'match1', corner: 'a', stake: 50, result: 'won', paid: 90 })
    expect(s.recentFights[0]).toMatchObject({ nameA: 'Blue', winner: 'a', by: 'ko', chipsBefore: 500, chipsAfter: 540 })
    expect(db.chipLedger().map((e) => e.reason)).toEqual(['stake', 'payout'])
    db.close()
  })
  it('a lost bet and a draw refund are recorded as such, and a reset grants back to the start without erasing history', () => {
    const db = new HealthStore(':memory:')
    const id = db.startFight({ startedAt: 0, seed: 1, nameA: 'A', nameB: 'B', chipsBefore: 500 })
    db.recordBet(id, { at: 1, market: 'round1', kind: 'round', round: 1, corner: 'b', stake: 30, odds: 2.1 })
    db.recordBet(id, { at: 2, market: 'round2', kind: 'round', round: 2, corner: 'a', stake: 20, odds: 1.5 })
    db.settleMarket(id, 'round1', 'a', [{ corner: 'b', stake: 30, paid: 0 }], [{ at: 3, reason: 'stake', amount: -30, balance: 470 }])
    db.settleMarket(id, 'round2', 'draw', [{ corner: 'a', stake: 20, paid: 20 }], [{ at: 4, reason: 'stake', amount: -20, balance: 450 }, { at: 5, reason: 'refund', amount: 20, balance: 470 }])
    db.finishFight(id, { endedAt: 6, winner: 'a', by: 'decision', round: 3, chipsAfter: 470, betsWon: 0, betsLost: 1, net: -30 })
    const s = db.chipSummary(500, 6)
    expect(s.betsLost).toBe(1); expect(s.recentBets.map((b) => b.result).sort()).toEqual(['draw', 'lost'])
    expect(db.resetChips(500, 7)).toBe(500)
    expect(db.chipBalance(500)).toBe(500)
    expect(db.chipSummary(500, 7).fights).toBe(1) // history kept
    db.close()
  })
})
