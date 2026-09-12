import { useEffect, useState } from 'react'
import { audio } from './audio'
import { useArena } from '../lib/store'
import { QR } from '../ui/QR'
import { PhaserStage } from './stage/PhaserStage'
import { OddsBoard } from './OddsBoard'
import { CardVoteSplash, LeaderboardStrip, MarketBanners, StudyingMeter, Subtitle } from './Overlays'
import './projector.css'

export default function Projector() {
  const connect = useArena((s) => s.connect)
  const seats = useArena((s) => s.seats)
  const railUrl = useArena((s) => s.railUrl)
  const connected = useArena((s) => s.connected)
  const match = useArena((s) => s.match)
  const statuses = useArena((s) => s.statuses)
  const voice = useArena((s) => s.voice)
  const sfxEv = useArena((s) => s.sfx)
  const [unlocked, setUnlocked] = useState(false)
  useEffect(() => { connect({ role: 'projector' }) }, [connect])
  useEffect(() => { if (voice) audio.enqueue({ ...voice, ts: Date.now() } as never) }, [voice])
  useEffect(() => { if (sfxEv) audio.sfx(sfxEv.name, sfxEv.gain) }, [sfxEv])
  const live = match && match.phase !== 'ended'
  return (
    <div className="proj dark">
      <header className="proj-top">
        <div className="brand">The House Always Plays</div>
        <div className="clock">{live ? `${match.sport} · ${match.opponent.name}` : 'Lobby'}</div>
        <div className="top-right">
          {!unlocked && <button className="pill blue" onClick={async () => setUnlocked(await audio.unlock())}>Unlock voice</button>}
          <div className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'connected' : 'reconnecting'}</div>
        </div>
      </header>
      <main className="proj-stage">
        <div className="tile stage-card">
          <PhaserStage />
          <StudyingMeter />
          <MarketBanners />
          <CardVoteSplash />
        </div>
      </main>
      <aside className="proj-side">
        {seats.map((s) => {
          const st = s.device_id ? (statuses[s.device_id] as { connected?: boolean } | undefined) : undefined
          return (
            <div key={s.seat_id} className={`tile nameplate ${s.status}`}>
              <div className="seat-label">{s.label}{st && st.connected === false ? <span className="chip warn">reconnecting</span> : null}</div>
              {s.status === 'open' && s.join_url ? <QR value={s.join_url} size={200} label="Scan to play" /> : null}
              {s.status === 'claimed' ? <div className="claimed"><div className="avatar">{(s.nickname ?? 'P').slice(0, 1)}</div><div className="nick">{s.nickname ?? 'Player'}</div></div> : null}
              {s.status === 'locked' ? <div className="claimed"><div className="nick">Locked</div></div> : null}
            </div>
          )
        })}
        <OddsBoard />
      </aside>
      <footer className="proj-rail">
        <div className="tile rail-qr">{railUrl ? <QR value={railUrl} size={130} label="Scan to bet" /> : null}</div>
        <div className="foot-mid"><Subtitle /><LeaderboardStrip /></div>
      </footer>
    </div>
  )
}
