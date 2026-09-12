import { useEffect, useState } from 'react'
import { useArena } from '../lib/store'
import { PlankMenu } from '../ui/ChannelGrid'
import type { GameDef } from '../ui/games'
import './host.css'

export default function Host() {
  const connect = useArena((s) => s.connect)
  const socket = useArena((s) => s.socket)
  const connected = useArena((s) => s.connected)
  const seats = useArena((s) => s.seats)
  const publicUrl = useArena((s) => s.publicUrl)
  const railUrl = useArena((s) => s.railUrl)
  const diag = useArena((s) => s.diagnostics)
  const toggles = useArena((s) => s.toggles)
  const match = useArena((s) => s.match)
  const log = useArena((s) => s.log)
  const [url, setUrl] = useState('')
  useEffect(() => { connect({ role: 'host' }) }, [connect])
  const send = (t: Parameters<NonNullable<typeof socket>['send']>[0], d: Record<string, unknown> = {}) => socket?.send(t, d)
  const pick = (g: GameDef) => send(g.card ? 'host.card' : 'host.start', g.card ? {} : { sport: g.sport })
  return (
    <div className="host">
      <header className="host-top"><b>Host</b><span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'connected' : 'reconnecting'}</span></header>
      <section className="tile sec">
        <h3>Start a game</h3>
        <div style={{ height: 480 }}><PlankMenu onPick={pick} title="Start a game" /></div>
        <div className="row">
          <button className="pill" onClick={() => send('host.pause')}>Pause</button>
          <button className="pill" onClick={() => send('host.resume')}>Resume</button>
          <button className="pill" onClick={() => send('host.next')}>Next</button>
          <button className="pill" onClick={() => send('host.force_scenario', { kind: 'demo' })}>Force demo scenario</button>
          <button className="pill" onClick={() => send('host.unlock_audio')}>Remind: unlock audio</button>
        </div>
        {match && <div className="sub">Current: {match.sport} vs {match.opponent?.name} · phase {match.phase ?? '–'} · turn {match.turn_no ?? 0}</div>}
      </section>
      <section className="tile sec">
        <h3>Public URL (paste the cloudflared URL)</h3>
        <div className="row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={publicUrl} /><button className="pill blue" onClick={() => send('host.set_public_url', { url })}>Set</button></div>
        <div className="sub">Rail: <code>{railUrl}</code></div>
      </section>
      <section className="tile sec">
        <h3>Seats</h3>
        <div className="row">
          {(['single', 'two_glove', 'head_to_head', 'tag_team'] as const).map((m) => <button key={m} className="pill" onClick={() => send('host.set_seats', { mode: m })}>{m.replace('_', ' ')}</button>)}
        </div>
        <table><thead><tr><th>seat</th><th>status</th><th>player</th><th>join URL</th><th /></tr></thead><tbody>
          {seats.map((s) => <tr key={s.seat_id}><td>{s.label}</td><td>{s.status}</td><td>{s.nickname ?? '–'}</td><td className="url">{s.join_url ? <a href={`${s.join_url}&fake=1`} target="_blank" rel="noreferrer">{s.join_url}</a> : '–'}</td>
            <td><button className="pill" onClick={() => send('host.release_seat', { seat_id: s.seat_id })}>Release</button> <button className="pill" onClick={() => send('host.lock_seat', { seat_id: s.seat_id, locked: s.status !== 'locked' })}>{s.status === 'locked' ? 'Unlock' : 'Lock'}</button></td></tr>)}
        </tbody></table>
      </section>
      <section className="tile sec">
        <h3>Toggles</h3>
        <div className="row">{Object.entries(toggles).map(([k, v]) => <button key={k} className={`pill ${v ? 'on' : ''}`} onClick={() => send('host.toggle', { [k]: !v })}>{k.replace('_', ' ')}: {v ? 'on' : 'off'}</button>)}</div>
      </section>
      <section className="tile sec">
        <h3>Diagnostics</h3>
        <table><thead><tr><th>device</th><th>role</th><th>seat</th><th>hz</th><th>offset</th><th>calib</th><th>a_thr</th><th>last gesture</th><th>frames</th><th /></tr></thead><tbody>
          {diag.map((r) => <tr key={String(r.device_id)}><td>{String(r.nickname ?? r.device_id).slice(0, 14)}</td><td>remote</td><td>{String(r.seat_id ?? '–')}</td><td>{String(r.hz)}</td><td>{String(r.offset_ms)} ms</td>
            <td>{r.calibrated ? 'yes' : `${String(r.calib_phase)} ${Math.round(Number(r.calib_progress) * 100)}%`}</td><td>{String((r.calib as { a_thr?: number })?.a_thr ?? '–')}</td><td>{String(r.last_gesture ?? '–')}</td><td>{String(r.frames)}</td>
            <td><button className="pill" onClick={() => send('host.kick', { device_id: r.device_id })}>Kick</button></td></tr>)}
        </tbody></table>
      </section>
      <section className="tile sec">
        <h3>Event log</h3>
        <div className="log">{log.slice(-30).reverse().map((e, i) => <div key={`${e.seq}-${i}`}><span className="seq">{e.seq}</span> {e.t} <span className="d">{JSON.stringify(e.d).slice(0, 140)}</span></div>)}</div>
      </section>
    </div>
  )
}
