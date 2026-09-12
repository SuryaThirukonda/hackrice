import { useEffect } from 'react'
import { useArena } from '../lib/store'
import { QR } from '../ui/QR'
import { ChannelGrid } from '../ui/ChannelGrid'
import type { GameDef } from '../ui/games'
import './projector.css'

export default function Projector() {
  const connect = useArena((s) => s.connect)
  const socket = useArena((s) => s.socket)
  const seats = useArena((s) => s.seats)
  const railUrl = useArena((s) => s.railUrl)
  const connected = useArena((s) => s.connected)
  const match = useArena((s) => s.match)
  useEffect(() => { connect({ role: 'projector' }) }, [connect])
  const pick = (g: GameDef) => { socket?.send(g.card ? 'host.card' : 'host.start', g.card ? {} : { sport: g.sport }) }
  return (
    <div className="proj">
      <header className="proj-top">
        <div className="brand">The House Always Plays</div>
        <div className="clock">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        <div className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'connected' : 'reconnecting'}</div>
      </header>
      <main className="proj-stage">
        {match ? (
          <div className="tile stage-card"><div className="stage-placeholder">{match.sport} vs {match.opponent.name}</div></div>
        ) : (
          <div className="home">
            <div className="home-title">Pick a game</div>
            <ChannelGrid onPick={pick} />
          </div>
        )}
      </main>
      <aside className="proj-seats">
        {seats.map((s) => (
          <div key={s.seat_id} className={`tile nameplate ${s.status}`}>
            <div className="seat-label">{s.label}</div>
            {s.status === 'open' && s.join_url ? <QR value={s.join_url} size={240} label="Scan to play" /> : null}
            {s.status === 'claimed' ? <div className="claimed"><div className="avatar">{(s.nickname ?? 'P').slice(0, 1)}</div><div className="nick">{s.nickname ?? 'Player'}</div></div> : null}
            {s.status === 'locked' ? <div className="claimed"><div className="nick">Locked</div></div> : null}
          </div>
        ))}
      </aside>
      <footer className="proj-rail">
        <div className="tile rail-qr">{railUrl ? <QR value={railUrl} size={150} label="Scan to bet" /> : null}</div>
        <div className="tile strip">Leaderboard appears here</div>
      </footer>
    </div>
  )
}
