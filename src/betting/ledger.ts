import { START_CHIPS, type Bet, type Book, type Corner, type LedgerEntry } from './book'

/**
 * Chip history on the server, beside the health record. The in-memory `Book` stays the authority for
 * a fight; this ships what it decided: the fight, each bet as it is placed, each market as it settles
 * with the chip movements the book logged, and the final line. The lobby reads the balance back so a
 * stack survives a reload and a different browser. Every call is a quiet no-op when the service is off.
 */
export interface ChipSummary {
  balance: number; startChips: number; fights: number; betsWon: number; betsLost: number; staked: number; returned: number; net: number
  best: number; worst: number; bailouts: number; todayNet: number
  recentFights: { id: number; endedAt: number; nameA: string; nameB: string; winner: string; by: string; round: number; chipsBefore: number; chipsAfter: number; net: number }[]
  recentBets: { at: number; market: string; corner: string; stake: number; odds: number; result: string; paid: number }[]
}

const post = async <T>(url: string, body: unknown): Promise<T | null> => {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return r.ok ? (await r.json()) as T : null
  } catch { return null }
}

export async function fetchChipSummary(): Promise<ChipSummary | null> {
  try { const r = await fetch('/chips/summary', { cache: 'no-store' }); return r.ok ? (await r.json()) as ChipSummary : null } catch { return null }
}

export async function resetChips(): Promise<number | null> {
  try { const r = await fetch('/chips', { method: 'DELETE' }); return r.ok ? ((await r.json()) as { balance: number }).balance : null } catch { return null }
}

/** Which stack a fight starts from: the server's when it answers, otherwise what this browser remembers. */
export const startingChips = (server: ChipSummary | null, local: number): number =>
  server && Number.isFinite(server.balance) && server.balance > 0 ? server.balance : Number.isFinite(local) && local > 0 ? local : START_CHIPS

/** Ledger entries the book logged since the last shipment, stamped with wall time. */
export function ledgerSince(book: Book, synced: number, now = Date.now()): { entries: { at: number; reason: LedgerEntry['reason']; amount: number; balance: number }[]; next: number } {
  const slice = book.ledger.slice(synced)
  return { entries: slice.map((e) => ({ at: now, reason: e.reason, amount: e.amount, balance: e.balance })), next: book.ledger.length }
}

export class ChipLedger {
  private id: number | null = null
  private starting: Promise<void> | null = null
  private synced = 0

  begin(book: Book, names: [string, string], seed: number): void {
    this.synced = book.ledger.length // the opening grant is not a movement; the balance it sets is chipsBefore
    this.starting = post<{ id: number }>('/chips/fight', { startedAt: Date.now(), seed, nameA: names[0], nameB: names[1], chipsBefore: book.balance })
      .then((r) => { if (r) this.id = r.id })
  }

  placed(book: Book, marketId: string, corner: Corner, stake: number): void {
    const m = book.markets.find((x) => x.id === marketId)
    void this.starting?.then(() => { if (this.id !== null) void post(`/chips/fight/${this.id}/bet`, { at: Date.now(), market: marketId, kind: m?.kind ?? 'match', round: m?.round ?? 0, corner, stake, odds: m?.odds[corner] ?? 1 }) })
  }

  settled(book: Book, marketId: string, winner: Corner | 'draw', bets: Bet[]): void {
    const { entries, next } = ledgerSince(book, this.synced); this.synced = next
    void this.starting?.then(() => { if (this.id !== null) void post(`/chips/fight/${this.id}/settle`, { market: marketId, winner, bets: bets.map((b) => ({ corner: b.corner, stake: b.stake, paid: b.paid ?? 0 })), ledger: entries }) })
  }

  finish(book: Book, result: { winner: Corner | 'draw'; by: string; round: number }): void {
    const { entries, next } = ledgerSince(book, this.synced); this.synced = next
    void this.starting?.then(() => { if (this.id !== null) void post(`/chips/fight/${this.id}/finish`, { endedAt: Date.now(), winner: result.winner, by: result.by, round: result.round, chipsAfter: book.balance, betsWon: book.won, betsLost: book.lost, net: book.net, ledger: entries }) })
  }
}
