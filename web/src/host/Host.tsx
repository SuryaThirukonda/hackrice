import { useEffect, useState } from 'react'
import { useArena } from '../lib/store'
import { PlankMenu } from '../ui/ChannelGrid'
import type { GameDef } from '../ui/games'
import { Params, QUICK, getPath } from './Params'
import './host.css'

type Json = Record<string, unknown>
const SPORTS = ['bowling', 'baseball', 'boxing'] as const

function Stat({ k, v, bad, good }: { k: string; v: unknown; bad?: boolean; good?: boolean }) {
  return <div className={`stat ${bad ? 'bad' : ''} ${good ? 'good' : ''}`}><div className="k">{k}</div><div className="v">{v === null || v === undefined ? '–' : String(v)}</div></div>
}

export default function Host() {
  const connect = useArena((s) => s.connect)
  const socket = useArena((s) => s.socket)
  const connected = useArena((s) => s.connected)
  const seats = useArena((s) => s.seats)
  const publicUrl = useArena((s) => s.publicUrl)
  const railUrl = useArena((s) => s.railUrl)
  const diag = useArena((s) => s.diagnostics)
  const arenaDiag = useArena((s) => s.arenaDiag)
  const sockets = useArena((s) => s.sockets)
  const telemetry = useArena((s) => s.telemetry)
  const hostConfig = useArena((s) => s.hostConfig)
  const hostAck = useArena((s) => s.hostAck)
  const toggles = useArena((s) => s.toggles)
  const match = useArena((s) => s.match)
  const phase = useArena((s) => s.phase)
  const log = useArena((s) => s.log)
  const [url, setUrl] = useState('')
  const [tier, setTier] = useState<Record<string, string>>({ bowling: 'rookie', baseball: 'rookie', boxing: 'rookie' })
  const [scenario, setScenario] = useState<Record<string, string>>({ bowling: 'demo', baseball: 'demo', boxing: 'demo' })
  const [seed, setSeed] = useState('')
  const [worker, setWorker] = useState({ worker_url: '', admin_key: '', url: '' })
  const [audioReminded, setAudioReminded] = useState(false)
  useEffect(() => { connect({ role: 'host' }) }, [connect])
  const send = (t: Parameters<NonNullable<typeof socket>['send']>[0], d: Record<string, unknown> = {}) => socket?.send(t, d)
  const startArgs = (sport: string) => ({ sport, tier: tier[sport], ...(seed.trim() ? { seed: Number(seed) } : {}) })
  const pick = (g: GameDef) => send(g.card ? 'host.card' : 'host.start', g.card ? {} : startArgs(g.sport))
  const config = (hostConfig?.config as Json | undefined) ?? null
  const tiers = (hostConfig?.tiers as Record<string, { id: string; name: string }[]> | undefined) ?? {}
  const scenarios = (hostConfig?.scenarios as Record<string, string[]> | undefined) ?? {}
  const setParam = (path: string, value: number | boolean) => send('host.set_param', { path, value })
  const live = match && match.phase !== 'ended'
  const a = (arenaDiag ?? {}) as Json
  const tel = (telemetry ?? {}) as Json
  const telAge = a.telemetry_age_s as number | null | undefined
  const frameP95 = typeof tel.frame_ms_p95 === 'number' ? tel.frame_ms_p95 : null
  const tickP95 = typeof a.tick_p95_ms === 'number' ? a.tick_p95_ms : null
  const dropped = typeof a.dropped_total === 'number' ? a.dropped_total : 0
  const ackBad = hostAck && hostAck.ok === false
  return (
    <div className="host">
      <header className="host-top">
        <div><b>Host</b> <span className="meta">{String(hostConfig?.mode ?? '')}{hostConfig?.fast_timers ? ' · fast timers' : ''}{hostConfig?.dev ? ' · dev' : ''}</span></div>
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'connected' : 'reconnecting'}</span>
      </header>

      {!audioReminded && <div className="banner warn">
        <span>Audio: click <b>Unlock audio</b> on the projector page once per browser session, or voice lines stay silent (Safari and Chrome block autoplay).</span>
        <span className="row" style={{ margin: 0 }}><button className="pill" onClick={() => send('host.unlock_audio')}>Ping projector</button><button className="pill" onClick={() => setAudioReminded(true)}>Done</button></span>
      </div>}
      {hostAck && <div className={`banner ${ackBad ? 'bad' : 'ok'}`}><span>host.ack <code>{String(hostAck.cmd)}</code> {ackBad ? `failed: ${String(hostAck.reason ?? hostAck.body ?? '')}` : 'ok'}{hostAck.path ? ` · ${String(hostAck.path)} = ${String(hostAck.value)}${hostAck.persisted ? ' (saved to YAML)' : ''}` : ''}{hostAck.status ? ` · HTTP ${String(hostAck.status)}` : ''}</span></div>}

      <section className="tile sec">
        <h3>Start a game <span className="hint">Enter on the projector claims the open seat for keyboard play</span></h3>
        <div className="grid2">
          <div style={{ height: 440 }}><PlankMenu onPick={pick} title="Start a game" /></div>
          <div>
            <table><thead><tr><th>sport</th><th>tier</th><th>scenario</th><th /></tr></thead><tbody>
              {SPORTS.map((sp) => <tr key={sp}>
                <td><b>{sp}</b></td>
                <td><select value={tier[sp]} onChange={(e) => setTier({ ...tier, [sp]: e.target.value })}>{(tiers[sp] ?? [{ id: 'rookie', name: 'rookie' }]).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}</select></td>
                <td><select value={scenario[sp]} onChange={(e) => setScenario({ ...scenario, [sp]: e.target.value })}>{(scenarios[sp] ?? ['demo']).map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
                <td className="row" style={{ margin: 0 }}>
                  <button className="pill blue" onClick={() => send('host.start', startArgs(sp))}>Start</button>
                  <button className="pill" onClick={() => send('host.force_scenario', { kind: scenario[sp], sport: sp, tier: tier[sp] })}>Force scenario</button>
                </td>
              </tr>)}
            </tbody></table>
            <div className="row" style={{ marginTop: 10 }}>
              <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="seed (optional, integer)" style={{ minWidth: 160, flex: 0 }} />
              <button className="pill" onClick={() => send('host.card', {})}>Fight Night (card)</button>
              <button className="pill" onClick={() => send('host.pause')}>Pause</button>
              <button className="pill" onClick={() => send('host.resume')}>Resume</button>
              <button className="pill" onClick={() => send('host.next')}>Next / end match</button>
            </div>
            <div className="sub">{live ? `Current: ${match.sport} vs ${match.opponent?.name} · phase ${phase?.phase ?? match.phase ?? '–'} · turn ${phase?.turn_no ?? match.turn_no ?? 0}${match.paused ? ' · PAUSED' : ''}` : 'No match running'}</div>
            <div className="sub" style={{ marginTop: 8 }}>Keys on the projector: bowling <span className="kbd">←</span><span className="kbd">→</span> aim, <span className="kbd">A</span>/<span className="kbd">D</span> spin, hold <span className="kbd">Space</span> to charge and release · baseball <span className="kbd">Space</span> swing, <span className="kbd">↑</span>/<span className="kbd">↓</span> height · boxing <span className="kbd">J</span> jab <span className="kbd">K</span> hook <span className="kbd">Space</span> block <span className="kbd">P</span> parry <span className="kbd">A</span>/<span className="kbd">D</span> dodge</div>
          </div>
        </div>
      </section>

      <section className="tile sec">
        <h3>Parameters <span className="hint">changes apply live (motion detectors rebuild; tiers apply at the next match) and are written to backend/config/*.yaml</span></h3>
        <div className="quick">
          {QUICK.map((q) => { const v = getPath(config, q.path); const num = typeof v === 'number' ? v : q.min
            return <label key={q.path}><span>{q.label}: <b>{String(v ?? '–')}</b></span>
              <input type="range" min={q.min} max={q.max} step={q.step} value={num} onChange={(e) => setParam(q.path, Number(e.target.value))} /></label> })}
        </div>
        <Params config={config} onSet={setParam} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="pill" onClick={() => send('host.reload_config')}>Reload config from disk</button>
          <span className="sub">{String(hostConfig?.config_dir ?? '')}</span>
        </div>
        {Array.isArray(hostConfig?.changes) && (hostConfig!.changes as Json[]).length > 0 && <div className="ack">recent: {(hostConfig!.changes as Json[]).slice(-6).map((c, i) => <span key={i}>{String(c.path)}={String(c.value)}{c.persisted ? '' : ' (memory)'}{i < 5 ? ' · ' : ''}</span>)}</div>}
      </section>

      <div className="grid2">
        <section className="tile sec">
          <h3>Public URL <span className="hint">paste the tunnel or Worker URL; QR codes re-render</span></h3>
          <div className="row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={publicUrl} /><button className="pill blue" onClick={() => send('host.set_public_url', { url })}>Set</button></div>
          <div className="sub">Rail: <code>{railUrl}</code></div>
        </section>
        <section className="tile sec">
          <h3>Edge Worker backend <span className="hint">cf/README.md · POST /backend/set with x-admin-key</span></h3>
          <div className="row"><input value={worker.worker_url} onChange={(e) => setWorker({ ...worker, worker_url: e.target.value })} placeholder="https://hap.<account>.workers.dev" /></div>
          <div className="row"><input value={worker.admin_key} onChange={(e) => setWorker({ ...worker, admin_key: e.target.value })} placeholder="ADMIN_KEY" type="password" /></div>
          <div className="row"><input value={worker.url} onChange={(e) => setWorker({ ...worker, url: e.target.value })} placeholder="https://<tunnel>.trycloudflare.com (this laptop)" /><button className="pill blue" onClick={() => send('host.set_backend_url', worker)}>Point Worker here</button></div>
        </section>
      </div>

      <section className="tile sec">
        <h3>Seats</h3>
        <div className="row">
          {(['single', 'two_glove', 'head_to_head', 'tag_team', 'none'] as const).map((m) => <button key={m} className="pill" onClick={() => send('host.set_seats', { mode: m })}>{m.replace('_', ' ')}</button>)}
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
        <h3>Diagnostics <span className="hint">arena every 1 s · projector telemetry every 5 s</span></h3>
        <div className="stats">
          <Stat k="tick jitter p95" v={tickP95 === null ? null : `${tickP95} ms`} bad={tickP95 !== null && tickP95 > 10} good={tickP95 !== null && tickP95 <= 10} />
          <Stat k="tick jitter max" v={typeof a.tick_max_ms === 'number' ? `${a.tick_max_ms} ms` : null} />
          <Stat k="projector frame p95" v={frameP95 === null ? null : `${frameP95} ms`} bad={frameP95 !== null && frameP95 > 20} good={frameP95 !== null && frameP95 <= 20} />
          <Stat k="projector fps" v={tel.fps ?? null} />
          <Stat k="telemetry age" v={telAge === null || telAge === undefined ? 'none' : `${telAge} s`} bad={typeof telAge === 'number' && telAge > 15} />
          <Stat k="socket drops" v={dropped} bad={dropped > 0} />
          <Stat k="connections" v={a.connections ?? null} />
          <Stat k="seq" v={a.seq ?? null} />
          <Stat k="markets" v={a.markets ? `${String((a.markets as Json).open ?? 0)} open / ${String((a.markets as Json).settled ?? 0)} settled / ${String((a.markets as Json).total ?? 0)}` : null} />
          <Stat k="chips in play" v={a.balances_total ?? null} />
          <Stat k="db rows written" v={a.store_written ?? 'no store'} />
          <Stat k="match" v={a.match ? `${String((a.match as Json).sport)} · ${String((a.match as Json).phase)} · turn ${String((a.match as Json).turn_no)}${(a.match as Json).paused ? ' · paused' : ''}` : 'idle'} />
        </div>
        <table><thead><tr><th>device</th><th>role</th><th>seat</th><th>hz</th><th>offset</th><th>calib</th><th>a_thr</th><th>last gesture</th><th>frames</th><th /></tr></thead><tbody>
          {diag.map((r) => <tr key={String(r.device_id)}><td>{String(r.nickname ?? r.device_id).slice(0, 14)}</td><td>remote</td><td>{String(r.seat_id ?? '–')}</td><td>{String(r.hz)}</td><td>{String(r.offset_ms)} ms</td>
            <td>{r.calibrated ? 'yes' : `${String(r.calib_phase)} ${Math.round(Number(r.calib_progress) * 100)}%`}</td><td>{String((r.calib as { a_thr?: number })?.a_thr ?? '–')}</td><td>{String(r.last_gesture ?? '–')}</td><td>{String(r.frames)}</td>
            <td><button className="pill" onClick={() => send('host.kick', { device_id: r.device_id })}>Kick</button></td></tr>)}
          {!diag.length && <tr><td colSpan={10} className="sub">no motion pipelines yet (a phone or keyboard remote has not joined)</td></tr>}
        </tbody></table>
        <table style={{ marginTop: 12 }}><thead><tr><th>socket</th><th>role</th><th>device</th><th>queued</th><th>dropped</th><th>seq</th></tr></thead><tbody>
          {sockets.map((s) => <tr key={String(s.conn_id)}><td><code>{String(s.conn_id)}</code></td><td>{String(s.role)}</td><td>{String(s.nickname ?? s.device_id ?? '–').slice(0, 18)}</td><td>{String(s.queued)}</td><td style={{ color: Number(s.dropped) > 0 ? 'var(--red)' : undefined }}>{String(s.dropped)}</td><td>{String(s.seq)}</td></tr>)}
        </tbody></table>
      </section>

      <section className="tile sec">
        <h3>Event log</h3>
        <div className="log">{log.slice(-40).reverse().map((e, i) => <div key={`${e.seq}-${i}`}><span className="seq">{e.seq}</span> {e.t} <span className="d">{JSON.stringify(e.d).slice(0, 140)}</span></div>)}</div>
      </section>
    </div>
  )
}
