import { useEffect, useMemo, useRef, useState } from 'react'
import { useArena } from '../lib/store'
import type { Market } from '../protocol'

function useNow(ms = 250) { const [n, setN] = useState(Date.now()); useEffect(() => { const id = setInterval(() => setN(Date.now()), ms); return () => clearInterval(id) }, [ms]); return n }

/** Flip-digit style value that animates when it changes. */
function Flip({ value }: { value: string }) {
  const [v, setV] = useState(value); const [flip, setFlip] = useState(false); const prev = useRef(value)
  useEffect(() => { if (value !== prev.current) { prev.current = value; setFlip(true); const id = setTimeout(() => { setV(value); setFlip(false) }, 160); return () => clearTimeout(id) } }, [value])
  return <span className={`flip ${flip ? 'flipping' : ''}`}>{v}</span>
}

export function OddsBoard() {
  const markets = useArena((s) => s.markets)
  const socket = useArena((s) => s.socket)
  const now = useNow()
  const serverNow = now + (socket?.offsetMs ?? 0)
  const list = useMemo(() => Object.values(markets).filter((m) => m.open || m.status === 'closed').sort((a, b) => a.closes_ts - b.closes_ts).slice(0, 2), [markets])
  const last = useMemo(() => Object.values(markets).filter((m) => m.status === 'settled').slice(-1)[0], [markets])
  return (
    <div className="tile odds">
      <div className="odds-head"><span>Odds board</span><span className="chip">parimutuel</span></div>
      {list.length === 0 && !last && <div className="odds-empty">Markets open before each turn</div>}
      {list.map((m) => <MarketRows key={m.market_id} m={m} secs={Math.max(0, Math.ceil((m.closes_ts - serverNow) / 1000))} />)}
      {list.length === 0 && last && <MarketRows m={last} secs={0} />}
    </div>
  )
}

function MarketRows({ m, secs }: { m: Market; secs: number }) {
  const total = m.outcomes.reduce((a, o) => a + o.pool, 0)
  const winners: string[] = Array.isArray(m.winner) ? m.winner : m.winner ? String(m.winner).split(',') : []
  return (
    <div className={`market-block ${m.open ? 'open' : ''}`}>
      <div className="mlabel"><span>{m.label}</span><span className={`chip ${m.open ? 'live' : ''}`}>{m.open ? `closes ${secs}s` : m.status === 'settled' ? 'settled' : 'locked'}</span></div>
      {m.outcomes.map((o) => {
        const odds = o.pool ? (total / o.pool).toFixed(1) + 'x' : '—'
        const pct = total ? Math.round((o.pool / total) * 100) : 0
        return (
          <div key={o.id} className={`orow ${winners.includes(o.id) ? 'won' : ''}`}>
            <span className="oname">{o.label}</span>
            <span className="obar"><span className="ofill" style={{ width: `${pct}%` }} /></span>
            <span className="opool"><Flip value={String(o.pool)} /></span>
            <span className="oodds"><Flip value={odds} /></span>
          </div>
        )
      })}
    </div>
  )
}
