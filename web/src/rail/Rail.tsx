import { useEffect, useMemo, useState } from 'react'
import { useArena } from '../lib/store'
import type { Market } from '../protocol'
import './rail.css'

const NICKS = ['Ace', 'Lucky', 'Whale', 'Rookie', 'Dice', 'Nova', 'Hawk', 'Slugger']
const STAKES = [10, 25, 50, 100, 200]

interface Move { id: string; label: string; target: 'house' | 'human'; sport: string | null; base_price: number; cap_per_match: number; cooldown_s: number }
interface Pairing { id: string; a: string; b: string; label: string }
interface CardVote { pairings: Pairing[]; tally: Record<string, number>; closes_ts?: number; done?: boolean; winner?: Pairing }
interface Crate { move: Move; closes_ts: number; n_bids: number }
interface PairingState { kind: 'pair.prompt' | 'pair.result'; text?: string; until_ts?: number; ok?: boolean; reason?: string; amount?: number; a?: string; b?: string; seat_id?: string }

/** Re-render on a timer while `active` so countdowns tick. */
function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!active) return; setNow(Date.now()); const id = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(id) }, [active, ms])
  return now
}

export default function Rail() {
  const connect = useArena((s) => s.connect)
  const socket = useArena((s) => s.socket)
  const connected = useArena((s) => s.connected)
  const balance = useArena((s) => s.balance)
  const markets = useArena((s) => s.markets)
  const match = useArena((s) => s.match)
  const leaderboard = useArena((s) => s.leaderboard)
  const betAck = useArena((s) => s.betAck)
  const settle = useArena((s) => s.settle)
  const moves = useArena((s) => s.moves) as unknown as Move[]
  const sponsorAck = useArena((s) => s.sponsorAck) as { ok: boolean; reason?: string; move_id?: string; price?: number; crate?: boolean; amount?: number; n: number } | null
  const crate = useArena((s) => s.crate) as unknown as Crate | null
  const crateResult = useArena((s) => s.crateResult) as { winner: string | null; amount?: number; move?: Move; reason?: string; n: number } | null
  const card = useArena((s) => s.card) as unknown as CardVote | null
  const pairing = useArena((s) => s.pairing) as unknown as PairingState | null
  const welcome = useArena((s) => s.welcome)
  const [nick, setNick] = useState<string | null>(() => { try { return localStorage.getItem('hap.nick') } catch { return null } })
  const [joined, setJoined] = useState(false)
  const [stake, setStake] = useState(25)
  const [tab, setTab] = useState<'bets' | 'moves' | 'board'>('bets')
  const [mine, setMine] = useState<Record<string, { outcome: string; stake: number }>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [bid, setBid] = useState(50)
  const [myVote, setMyVote] = useState<string | null>(null)
  const [passOpen, setPassOpen] = useState(false)
  const [passAmount, setPassAmount] = useState(50)

  useEffect(() => { if (joined && nick) connect({ role: 'rail', nickname: nick }) }, [joined, nick, connect])
  useEffect(() => {
    if (!betAck) return
    if (betAck.ok) { const a = betAck as { market_id: string; outcome_id: string; stake: number }; setMine((m) => ({ ...m, [a.market_id]: { outcome: a.outcome_id, stake: a.stake + (m[a.market_id]?.outcome === a.outcome_id ? m[a.market_id].stake : 0) } })) }
    else setToast(String(betAck.reason))
    const id = window.setTimeout(() => setToast(null), 1800); return () => window.clearTimeout(id)
  }, [betAck])
  useEffect(() => {
    if (!settle || !socket) return
    const s = settle as { payouts?: { device_id: string; amount: number }[]; void?: boolean; winner?: string[] }
    const me = s.payouts?.find((p) => p.device_id === socket.device)
    if (me) setToast(`You won ${me.amount} chips!`)
    else if (s.void) setToast('Market voided, stakes refunded')
    const id = window.setTimeout(() => setToast(null), 2500); return () => window.clearTimeout(id)
  }, [settle, socket])
  // sponsor.ack: a move purchase or a sealed crate bid
  useEffect(() => {
    if (!sponsorAck) return
    if (!sponsorAck.ok) setToast(`Not bought: ${sponsorAck.reason ?? 'rejected'}`)
    else if (sponsorAck.crate) setToast(`Sealed bid of ${sponsorAck.amount} chips placed`)
    else setToast(`Bought ${moves.find((m) => m.id === sponsorAck.move_id)?.label ?? sponsorAck.move_id} for ${sponsorAck.price} chips`)
    const id = window.setTimeout(() => setToast(null), 2500); return () => window.clearTimeout(id)
  }, [sponsorAck]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!crateResult) return
    setToast(crateResult.winner ? `${crateResult.winner} wins the crate (${crateResult.move?.label ?? 'move'}) for ${crateResult.amount} chips` : `Crate closed: ${crateResult.reason ?? 'no bids'}`)
    const id = window.setTimeout(() => setToast(null), 3000); return () => window.clearTimeout(id)
  }, [crateResult])
  useEffect(() => {
    if (!pairing || pairing.kind !== 'pair.result') return
    setPassOpen(false)
    setToast(pairing.ok ? (typeof pairing.amount === 'number' ? `${pairing.a} passed ${pairing.amount} chips to ${pairing.b}` : `Paired: ${pairing.a} and ${pairing.b}`) : `Bump failed: ${pairing.reason ?? 'no bump'}`)
    const id = window.setTimeout(() => setToast(null), 3000); return () => window.clearTimeout(id)
  }, [pairing])
  useEffect(() => { if (!card || card.done) setMyVote(null) }, [card])
  useEffect(() => {
    if (!card?.done || !card.winner) return
    setToast(`Fight Night: ${card.winner.label}`)
    const id = window.setTimeout(() => setToast(null), 3000); return () => window.clearTimeout(id)
  }, [card])

  const open = useMemo(() => Object.values(markets).filter((m) => m.open).sort((a, b) => a.closes_ts - b.closes_ts), [markets])
  const recent = useMemo(() => Object.values(markets).filter((m) => !m.open).slice(-3).reverse(), [markets])
  const live = match && match.phase !== 'ended' ? match : null
  const pairPrompt = pairing?.kind === 'pair.prompt' && (pairing.until_ts ?? 0) > (socket?.serverNow() ?? Date.now()) ? pairing : null
  const now = useNow(Boolean(crate || pairPrompt || (card && !card.done)))
  const serverNow = now + (socket?.offsetMs ?? 0)

  if (!joined) return (
    <div className="rail-join">
      <div className="title">Join the rail</div>
      <div className="sub">Pick a name. You get 500 chips. Chips have no cash value.</div>
      <div className="nicks">{NICKS.map((n) => <button key={n} className={`pill ${nick === n ? 'on' : ''}`} onClick={() => setNick(n)}>{n}</button>)}</div>
      <input placeholder="or type a name" maxLength={16} onChange={(e) => setNick(e.target.value)} />
      <button className="pill blue big" disabled={!nick} onClick={() => { try { localStorage.setItem('hap.nick', nick!) } catch { /* ignore */ } setJoined(true) }}>Take a seat at the rail</button>
    </div>
  )
  return (
    <div className="rail">
      <header className="rail-top">
        <div><b>{nick}</b> <span className="chip">{connected ? 'live' : 'reconnecting'}</span></div>
        <div className="balance">{balance} <small>chips</small></div>
      </header>
      {toast && <div className="toast">{toast}</div>}
      {pairPrompt && (
        <div className="sheet pair">
          <div className="sheet-title">Bump phones now</div>
          <div className="sheet-sub">{pairPrompt.text && pairPrompt.text !== 'Bump phones now' ? pairPrompt.text : 'Tap your phone against the other phone'}</div>
          <div className="countdown">{Math.max(0, Math.ceil(((pairPrompt.until_ts ?? 0) - serverNow) / 1000))}s</div>
          {welcome?.dev && <button className="pill" onClick={() => socket?.send('input.action', { kind: 'bump', params: { power: 0.9 } })}>Fake bump (dev)</button>}
        </div>
      )}
      {crate && (
        <div className="sheet crate">
          <div className="sheet-title">Sponsor crate: {crate.move.label}</div>
          <div className="sheet-sub">Helps {crate.move.target === 'house' ? (live?.opponent.name ?? 'the House') : 'the player'} · sealed bids · highest wins, others refunded</div>
          <div className="crate-row">
            <span className="countdown">{Math.max(0, Math.ceil((crate.closes_ts - serverNow) / 1000))}s</span>
            <span className="chip">{crate.n_bids} bid{crate.n_bids === 1 ? '' : 's'}</span>
            <input type="number" min={1} max={balance} value={bid} onChange={(e) => setBid(Math.max(1, Math.floor(Number(e.target.value) || 0)))} />
            <button className="pill blue" disabled={bid < 1 || bid > balance} onClick={() => socket?.send('crate.bid', { amount: bid })}>Bid {bid}</button>
          </div>
        </div>
      )}
      {card && !card.done && (
        <div className="sheet card">
          <div className="sheet-title">Fight Night: pick the card</div>
          <div className="sheet-sub">Two House boxers fight. Majority picks. Closes in {Math.max(0, Math.ceil(((card.closes_ts ?? 0) - serverNow) / 1000))}s</div>
          <div className="pairings">
            {card.pairings.map((p) => {
              const votes = card.tally?.[p.id] ?? 0
              const total = Object.values(card.tally ?? {}).reduce((a, b) => a + b, 0)
              return (
                <button key={p.id} className={`outcome ${myVote === p.id ? 'mine' : ''}`} onClick={() => { setMyVote(p.id); socket?.send('card.vote', { pairing_id: p.id }) }}>
                  <div className="olabel">{p.label}</div>
                  <div className="bar"><div className="fill" style={{ width: `${total ? Math.round((votes / total) * 100) : 0}%` }} /></div>
                  <div className="ometa"><span>{votes} vote{votes === 1 ? '' : 's'}</span><span>{myVote === p.id ? 'your pick' : 'tap to vote'}</span></div>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <nav className="tabs">
        <button className={`pill ${tab === 'bets' ? 'on' : ''}`} onClick={() => setTab('bets')}>Bets</button>
        <button className={`pill ${tab === 'moves' ? 'on' : ''}`} onClick={() => setTab('moves')}>Sponsor</button>
        <button className={`pill ${tab === 'board' ? 'on' : ''}`} onClick={() => setTab('board')}>Leaderboard</button>
      </nav>
      {tab === 'bets' && (
        <main className="markets">
          {match ? <div className="matchline">{match.sport} · {match.players ? Object.values(match.players).join(', ') : 'The room'} vs <b>{match.opponent.name}</b></div> : <div className="matchline">No match yet. Bets open when one starts.</div>}
          <div className="stakes">{STAKES.map((s) => <button key={s} className={`pill ${stake === s ? 'on' : ''}`} onClick={() => setStake(s)}>{s}</button>)}</div>
          {open.length === 0 && <div className="empty">No open markets. Next window opens before the next turn.</div>}
          {open.map((m) => <MarketCard key={m.market_id} m={m} stake={stake} mine={mine[m.market_id]} onBet={(o) => socket?.send('market.bet', { market_id: m.market_id, outcome_id: o, stake })} now={socket?.serverNow() ?? Date.now()} />)}
          {recent.map((m) => <MarketCard key={m.market_id} m={m} stake={stake} mine={mine[m.market_id]} now={socket?.serverNow() ?? Date.now()} />)}
        </main>
      )}
      {tab === 'moves' && (
        <main className="markets">
          <SponsorDrawer moves={moves} sport={live?.sport ?? null} houseName={live?.opponent.name ?? 'the House'} playerName={live?.players ? Object.values(live.players)[0] : 'the player'} balance={balance} onBuy={(id) => socket?.send('sponsor.buy', { move_id: id })} />
        </main>
      )}
      {tab === 'board' && (
        <main className="board">
          {leaderboard.map((r, i) => <div key={r.device_id} className={`row ${r.device_id === socket?.device ? 'me' : ''}`}><span className="rank">{i + 1}</span><span className="name">{r.nickname} {r.titles.map((t) => <span key={t} className="chip">{t}</span>)}</span><span className="chips">{r.chips}</span></div>)}
          {leaderboard.length === 0 && <div className="empty">Nobody has bet yet.</div>}
        </main>
      )}
      <section className="tile pass">
        {!passOpen ? (
          <button className="pill" disabled={Boolean(pairPrompt)} onClick={() => setPassOpen(true)}>Bump to pass chips</button>
        ) : (
          <div className="pass-body">
            <div className="sheet-sub">Pick an amount, then bump your phone against the other person's phone.</div>
            <div className="stakes">{STAKES.map((s) => <button key={s} className={`pill ${passAmount === s ? 'on' : ''}`} disabled={s > balance} onClick={() => setPassAmount(s)}>{s}</button>)}</div>
            <div className="pass-actions">
              <button className="pill" onClick={() => setPassOpen(false)}>Cancel</button>
              <button className="pill blue" disabled={passAmount > balance} onClick={() => socket?.send('pair.request', { kind: 'transfer', amount: passAmount })}>Request bump for {passAmount}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function SponsorDrawer({ moves, sport, houseName, playerName, balance, onBuy }: { moves: Move[]; sport: string | null; houseName: string; playerName: string; balance: number; onBuy: (id: string) => void }) {
  const list = moves.filter((m) => !sport || !m.sport || m.sport === sport)
  return (
    <div className="drawer">
      <div className="matchline">{sport ? `Sponsor moves for ${sport}` : 'Sponsor moves unlock when a match is live'}</div>
      <div className="hint">Chips buy a nudge to the live match. The room sees a warning 2 s before it lands. The final price follows the odds: backing the favorite costs more.</div>
      {list.length === 0 && <div className="empty">No moves for this sport.</div>}
      {list.map((m) => (
        <div key={m.id} className={`tile move ${m.target}`}>
          <div className="mhead"><span>{m.label}</span><span className="chip">{m.target === 'house' ? `for ${houseName}` : `for ${playerName}`}</span></div>
          <div className="ometa"><span>~{m.base_price} chips, final price depends on the odds</span><span>{m.cap_per_match}/match · {m.cooldown_s}s cooldown</span></div>
          <button className="pill blue" disabled={!sport || balance < Math.round(m.base_price * 0.5)} onClick={() => onBuy(m.id)}>Buy for the {m.target === 'house' ? 'House' : 'player'}</button>
        </div>
      ))}
    </div>
  )
}

function MarketCard({ m, stake, mine, onBet, now }: { m: Market; stake: number; mine?: { outcome: string; stake: number }; onBet?: (o: string) => void; now: number }) {
  const total = m.outcomes.reduce((a, o) => a + o.pool, 0)
  const secs = Math.max(0, Math.round((m.closes_ts - now) / 1000))
  const winners: string[] = Array.isArray(m.winner) ? m.winner : m.winner ? String(m.winner).split(',') : []
  return (
    <div className={`tile market ${m.open ? '' : 'closed'}`}>
      <div className="mhead"><span>{m.label}</span><span className="chip">{m.open ? `${secs}s` : m.status === 'settled' ? `won: ${winners.join(', ')}` : m.status}</span></div>
      <div className="outcomes">
        {m.outcomes.map((o) => {
          const ratio = total ? o.pool / total : 1 / m.outcomes.length
          const odds = o.pool ? (total / o.pool).toFixed(1) : '–'
          const won = !m.open && winners.includes(o.id)
          return (
            <button key={o.id} className={`outcome ${mine?.outcome === o.id ? 'mine' : ''} ${won ? 'won' : ''}`} disabled={!m.open || !onBet} onClick={() => onBet?.(o.id)}>
              <div className="olabel">{o.label}</div>
              <div className="bar"><div className="fill" style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
              <div className="ometa"><span>{o.pool} in pool</span><span>{odds}x</span></div>
              {mine?.outcome === o.id && <div className="mystake">you: {mine.stake}</div>}
            </button>
          )
        })}
      </div>
      {m.open && onBet && <div className="hint">Tap an outcome to bet {stake}</div>}
    </div>
  )
}
