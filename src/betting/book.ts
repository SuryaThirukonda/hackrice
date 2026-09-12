/** Play-chip betting for Fight Night. Pure: no DOM, no storage. Fixed odds with a house margin; the ledger conserves chips. */
export type Corner = 'a' | 'b'
export type MarketKind = 'round' | 'match'
export interface Market { id: string; kind: MarketKind; round: number; odds: Record<Corner, number>; open: boolean; settled: boolean; winner?: Corner | 'draw' }
export interface Bet { marketId: string; corner: Corner; stake: number; paid?: number }
export interface LedgerEntry { t: number; reason: 'grant' | 'stake' | 'payout' | 'refund' | 'bailout'; amount: number; balance: number }

export const START_CHIPS = 500
export const BAILOUT_BELOW = 10
export const BAILOUT_TO = 100
export const MARGIN = 0.94
export const MIN_STAKE = 10

export interface Form { hpA: number; hpB: number; staA: number; staB: number; kdA: number; kdB: number; roundsWonA: number; roundsWonB: number }
/** Probability that corner a wins, from a small logistic model of the visible state. */
export function pA(f: Form): number {
  const x = (f.hpA - f.hpB) / 40 + (f.staA - f.staB) / 120 - (f.kdA - f.kdB) * 0.6 + (f.roundsWonA - f.roundsWonB) * 0.35
  return 1 / (1 + Math.exp(-x))
}
export function oddsFor(f: Form): Record<Corner, number> {
  const p = Math.min(0.92, Math.max(0.08, pA(f)))
  const r = (q: number) => Math.round((MARGIN / q) * 100) / 100
  return { a: r(p), b: r(1 - p) }
}

export class Book {
  balance: number
  ledger: LedgerEntry[] = []
  bets: Bet[] = []
  markets: Market[] = []
  private t = 0
  won = 0; lost = 0; net = 0
  constructor(balance = START_CHIPS) { this.balance = 0; this.log('grant', balance) }
  private log(reason: LedgerEntry['reason'], amount: number): void { this.balance += amount; this.ledger.push({ t: this.t++, reason, amount, balance: this.balance }) }
  openMarket(kind: MarketKind, round: number, form: Form): Market {
    const m: Market = { id: `${kind}${round}`, kind, round, odds: oddsFor(form), open: true, settled: false }
    this.markets = this.markets.filter((x) => x.id !== m.id).concat(m)
    return m
  }
  closeMarkets(): void { for (const m of this.markets) m.open = false }
  place(marketId: string, corner: Corner, stake: number): { ok: boolean; reason?: string } {
    const m = this.markets.find((x) => x.id === marketId)
    if (!m || !m.open) return { ok: false, reason: 'market closed' }
    if (stake < MIN_STAKE) return { ok: false, reason: `minimum ${MIN_STAKE}` }
    if (stake > this.balance) return { ok: false, reason: 'not enough chips' }
    this.log('stake', -stake)
    this.bets.push({ marketId, corner, stake })
    return { ok: true }
  }
  /** Settle a market. Draw refunds every stake. */
  settle(marketId: string, winner: Corner | 'draw'): { paid: number; bets: Bet[] } {
    const m = this.markets.find((x) => x.id === marketId)
    if (!m || m.settled) return { paid: 0, bets: [] }
    m.settled = true; m.open = false; m.winner = winner
    let paid = 0
    const mine = this.bets.filter((b) => b.marketId === marketId && b.paid === undefined)
    for (const b of mine) {
      if (winner === 'draw') { b.paid = b.stake; this.log('refund', b.stake) }
      else if (b.corner === winner) { b.paid = Math.floor(b.stake * m.odds[winner]); this.log('payout', b.paid); this.won++; this.net += b.paid - b.stake }
      else { b.paid = 0; this.lost++; this.net -= b.stake }
      paid += b.paid
    }
    if (this.balance < BAILOUT_BELOW && !this.markets.some((x) => x.open)) this.log('bailout', BAILOUT_TO - this.balance)
    return { paid, bets: mine }
  }
  /** Every ledger entry must reproduce the running balance. */
  conserved(): boolean { let b = 0; for (const e of this.ledger) { b += e.amount; if (Math.abs(b - e.balance) > 1e-9) return false } return Math.abs(b - this.balance) < 1e-9 }
}
