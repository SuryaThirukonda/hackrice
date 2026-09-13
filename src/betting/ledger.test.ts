import { describe, expect, it } from 'vitest'
import { Book, START_CHIPS } from './book'
import { ledgerSince, startingChips } from './ledger'

describe('chip ledger client', () => {
  it('starts from the server balance when it answers, the browser copy otherwise, the default last', () => {
    const server = { balance: 730 } as Parameters<typeof startingChips>[0]
    expect(startingChips(server, 120)).toBe(730)
    expect(startingChips(null, 120)).toBe(120)
    expect(startingChips(null, Number.NaN)).toBe(START_CHIPS)
    expect(startingChips({ balance: 0 } as Parameters<typeof startingChips>[0], 0)).toBe(START_CHIPS)
  })
  it('ships only the movements the book logged since the last shipment, never twice', () => {
    const book = new Book(500)
    const m = book.openMarket('match', 1, { hpA: 100, hpB: 100, staA: 100, staB: 100, kdA: 0, kdB: 0, roundsWonA: 0, roundsWonB: 0 })
    let synced = book.ledger.length // the opening grant is chipsBefore, not a movement
    book.place(m.id, 'a', 50)
    book.settle(m.id, 'a')
    const first = ledgerSince(book, synced, 1000); synced = first.next
    expect(first.entries.map((e) => e.reason)).toEqual(['stake', 'payout'])
    expect(first.entries.every((e) => e.at === 1000)).toBe(true)
    expect(first.entries[1].balance).toBe(book.balance)
    const again = ledgerSince(book, synced); expect(again.entries).toEqual([])
  })
})
