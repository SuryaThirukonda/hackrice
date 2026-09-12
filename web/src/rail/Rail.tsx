import { useEffect, useMemo, useState } from 'react'
import { useArena } from '../lib/store'
import type { Market } from '../protocol'
import './rail.css'

const NICKS = ['Ace', 'Lucky', 'Whale', 'Rookie', 'Dice', 'Nova', 'Hawk', 'Slugger']
const STAKES = [10, 25, 50, 100, 200]

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
  const [nick, setNick] = useState<string | null>(() => { try { return localStorage.getItem('hap.nick') } catch { return null } })
  const [joined, setJoined] = useState(false)
  const [stake, setStake] = useState(25)
  const [tab, setTab] = useState<'bets' | 'board'>('bets')
  const [mine, setMine] = useState<Record<string, { outcome: string; stake: number }>>({})
  const [toast, setToast] = useState<string | null>(null)

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

  const open = useMemo(() => Object.values(markets).filter((m) => m.open).sort((a, b) => a.closes_ts - b.closes_ts), [markets])
  const recent = useMemo(() => Object.values(markets).filter((m) => !m.open).slice(-3).reverse(), [markets])

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
      <nav className="tabs"><button className={`pill ${tab === 'bets' ? 'on' : ''}`} onClick={() => setTab('bets')}>Bets</button><button className={`pill ${tab === 'board' ? 'on' : ''}`} onClick={() => setTab('board')}>Leaderboard</button></nav>
      {tab === 'bets' ? (
        <main className="markets">
          {match ? <div className="matchline">{match.sport} · {match.players ? Object.values(match.players).join(', ') : 'The room'} vs <b>{match.opponent.name}</b></div> : <div className="matchline">No match yet. Bets open when one starts.</div>}
          <div className="stakes">{STAKES.map((s) => <button key={s} className={`pill ${stake === s ? 'on' : ''}`} onClick={() => setStake(s)}>{s}</button>)}</div>
          {open.length === 0 && <div className="empty">No open markets. Next window opens before the next turn.</div>}
          {open.map((m) => <MarketCard key={m.market_id} m={m} stake={stake} mine={mine[m.market_id]} onBet={(o) => socket?.send('market.bet', { market_id: m.market_id, outcome_id: o, stake })} now={socket?.serverNow() ?? Date.now()} />)}
          {recent.map((m) => <MarketCard key={m.market_id} m={m} stake={stake} mine={mine[m.market_id]} now={socket?.serverNow() ?? Date.now()} />)}
        </main>
      ) : (
        <main className="board">
          {leaderboard.map((r, i) => <div key={r.device_id} className={`row ${r.device_id === socket?.device ? 'me' : ''}`}><span className="rank">{i + 1}</span><span className="name">{r.nickname} {r.titles.map((t) => <span key={t} className="chip">{t}</span>)}</span><span className="chips">{r.chips}</span></div>)}
          {leaderboard.length === 0 && <div className="empty">Nobody has bet yet.</div>}
        </main>
      )}
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
