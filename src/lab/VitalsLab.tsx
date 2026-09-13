import { useEffect, useRef, useState } from 'react'
import type { VitalsState } from '../../server/vitals'
import { Trace } from './Trace'
import './lab.css'

/**
 * Vitals lab: the camera reading on the big screen, with the phone's movement beside it.
 *
 * Nothing starts until the person in front of the camera says so. The page turns the reading on and
 * off in the local service, shows the SDK's own guidance while it settles, and then the numbers it
 * calls stable. Pulse and breathing are the headline readings; heart-rate variability is shown and
 * labelled as an uncleared metric. All of it is a wellness reading, none of it a diagnosis.
 */
type ControllerId = 'controller_1' | 'controller_2'
interface Movement { swingsPerMinute: number; intensity: number; trace: number[]; swings: number; activeSeconds: number }
const blankMovement = (): Movement => ({ swingsPerMinute: 0, intensity: 0, trace: [], swings: 0, activeSeconds: 0 })

export default function VitalsLab(): React.ReactElement {
  const [state, setState] = useState<VitalsState | null>(null)
  const [consented, setConsented] = useState(false)
  const [busy, setBusy] = useState(false)
  const [movement, setMovement] = useState<Movement>(blankMovement())
  const [linked, setLinked] = useState(false)
  const [devices, setDevices] = useState<{ checked: boolean; devices: string[] } | null>(null)
  const epochsRef = useRef<{ at: number; mean: number; swings: number }[]>([])

  // The reading itself: poll the service twice a second while it runs.
  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      try { const r = await fetch('/vitals', { cache: 'no-store' }); if (r.ok && alive) setState(await r.json() as VitalsState) } catch { if (alive) setState(null) }
    }
    void tick()
    fetch('/vitals/devices', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((d) => setDevices(d as { checked: boolean; devices: string[] } | null)).catch(() => setDevices(null))
    const timer = window.setInterval(() => void tick(), 500)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  // The phone's movement, from the same relay the game listens to.
  useEffect(() => {
    let closed = false; let retry: number | undefined; let socket: WebSocket | null = null
    const open = (): void => {
      if (closed) return
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/controller-game-ws`)
      socket.onopen = () => setLinked(true)
      socket.onclose = () => { setLinked(false); if (!closed) retry = window.setTimeout(open, 1000) }
      socket.onmessage = (message) => {
        if (typeof message.data !== 'string') return
        let p: { type?: string; controllerId?: string; epochs?: { t: number; mean: number; swings: number }[] }
        try { p = JSON.parse(message.data) } catch { return }
        if (p.type !== 'activity' || (p.controllerId as ControllerId) !== 'controller_1' || !Array.isArray(p.epochs)) return
        const now = Date.now()
        for (const e of p.epochs) epochsRef.current.push({ at: now, mean: e.mean, swings: e.swings })
        epochsRef.current = epochsRef.current.filter((e) => e.at >= now - 120_000)
        const last60 = epochsRef.current.slice(-60)
        setMovement((m) => ({
          swingsPerMinute: last60.reduce((s, e) => s + e.swings, 0),
          intensity: last60.length ? last60.reduce((s, e) => s + e.mean, 0) / last60.length : 0,
          trace: epochsRef.current.map((e) => e.mean).slice(-120),
          swings: m.swings + p.epochs!.reduce((s, e) => s + e.swings, 0),
          activeSeconds: m.activeSeconds + p.epochs!.filter((e) => e.mean >= 0.8).length,
        }))
      }
    }
    open()
    return () => { closed = true; window.clearTimeout(retry); socket?.close() }
  }, [])

  const start = async (demo: boolean): Promise<void> => {
    setBusy(true)
    try { const r = await fetch('/vitals/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo, cameraIndex: 0 }) }); if (r.ok) setState(await r.json() as VitalsState) } catch { /* service off */ }
    setBusy(false)
  }
  const stop = async (): Promise<void> => {
    setBusy(true)
    try { const r = await fetch('/vitals/stop', { method: 'POST' }); if (r.ok) setState(await r.json() as VitalsState) } catch { /* service off */ }
    setBusy(false)
  }

  const running = state?.status === 'running' || state?.status === 'starting'
  const offline = state === null
  const pulseValues = state?.pulseHistory.map((p) => p.bpm) ?? []
  const breathValues = state?.breathingTrace.map((p) => p.v) ?? []
  const settling = running && !state?.pulse

  return <main className="lab">
    <header>
      <div>
        <h1>Vitals lab</h1>
        <p>Camera pulse and breathing, with the phone's movement beside them. Wellness readings, not a diagnosis.</p>
      </div>
      <div className="lab-state">
        <span className={`pill pill-${offline ? 'bad' : running ? 'ok' : 'idle'}`}>{offline ? 'service offline' : state.status}{state?.source ? ` · ${state.source}` : ''}</span>
        {running && <span className="pill pill-live"><span className="dot" /> camera {state?.source === 'demo' ? 'simulated' : 'ON'}</span>}
        <span className={`pill ${linked ? 'pill-ok' : 'pill-idle'}`}>phone relay {linked ? 'linked' : 'off'}</span>
      </div>
    </header>

    {offline && <p className="lab-empty">The health service is not running. Start it with <strong>npm run agent</strong>; this page turns the camera on and off through it.</p>}

    {!offline && !running && <section className="consent">
      <h2>Before the camera starts</h2>
      <ul>
        <li><strong>What is measured:</strong> pulse rate and breathing rate from small colour and motion changes in the face and chest, plus heart-rate variability, which is an uncleared research metric.</li>
        <li><strong>What it needs:</strong> one person, still, face and upper chest visible, decent light, about a metre from the laptop camera. It cannot read while you are swinging the phone; use it between rounds.</li>
        <li><strong>Where it goes:</strong> frames stay on this laptop and are never stored. The SDK sends preprocessed signal data to Presage's physiology service to compute the readings. Stable readings are kept in the local health database.</li>
        <li><strong>What it is not:</strong> a medical device, a diagnosis, or advice. The vendor states these readings are for general wellness and information only.</li>
      </ul>
      <label className="consent-check"><input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} /> I understand, and I am the person in front of the camera.</label>
      {devices?.checked && devices.devices.length === 0 && <p className="hint error">No camera device is present on this machine. Plug in a USB webcam, or check the camera privacy key and BIOS setting. The demo below runs the whole pipeline without one.</p>}
      {devices?.checked && devices.devices.length > 0 && <p className="hint">Camera device{devices.devices.length === 1 ? '' : 's'} found: {devices.devices.join(', ')}</p>}
      <div className="consent-actions">
        <button type="button" className="primary" disabled={!consented || busy || (devices?.checked === true && devices.devices.length === 0)} onClick={() => void start(false)}>Start camera</button>
        <button type="button" disabled={busy} onClick={() => void start(true)}>Demo without a camera</button>
      </div>
      {state?.error && <p className="hint error">{state.error}</p>}
    </section>}

    {running && <section className="lab-grid">
      <article className="card card-wide">
        <div className="card-top">
          <h2>Pulse <small>beats per minute · stable readings only</small></h2>
          <button type="button" onClick={() => void stop()} disabled={busy}>Stop camera</button>
        </div>
        <div className="vital-row">
          <div className={`vital ${settling ? 'vital-dim' : ''}`}>
            <span className="vital-big">{state?.pulse ? Math.round(state.pulse.value) : '—'}</span>
            <span className="vital-label">bpm{state?.pulse ? ` · ${Math.round(state.pulse.confidence)}% confidence` : state?.rawPulse ? ` · settling (raw ${Math.round(state.rawPulse)})` : ''}</span>
          </div>
          <div className="vital"><span className="vital-big">{state?.baselinePulse ? Math.round(state.baselinePulse) : '—'}</span><span className="vital-label">resting baseline</span></div>
          <div className="vital"><span className="vital-big">{state?.exertion !== null && state?.exertion !== undefined ? Math.round(state.exertion * 100) : '—'}</span><span className="vital-label">exertion, % over rest</span></div>
          <div className="vital"><span className="vital-big">{state?.recovery !== null && state?.recovery !== undefined ? (state.recovery > 0 ? `−${state.recovery}` : `+${-state.recovery}`) : '—'}</span><span className="vital-label">change over the last minute</span></div>
        </div>
        <Trace values={pulseValues.length ? pulseValues : [0]} threshold={state?.baselinePulse ?? 0} ceiling={Math.max(100, ...pulseValues)} color="#ff6b7d" />
        <p className="hint">{state?.guidance}{settling ? ' · the first stable reading takes about twelve still seconds' : ''}</p>
      </article>

      <article className="card">
        <h2>Breathing <small>breaths per minute · live waveform</small></h2>
        <div className="vital-row">
          <div className="vital"><span className="vital-big">{state?.breathing ? state.breathing.value.toFixed(1) : '—'}</span><span className="vital-label">brpm{state?.rawBreathing && !state.breathing ? ` · settling (raw ${state.rawBreathing.toFixed(1)})` : ''}</span></div>
          <div className="vital"><span className="vital-big">{state?.baselineBreathing ? state.baselineBreathing.toFixed(1) : '—'}</span><span className="vital-label">resting baseline</span></div>
        </div>
        <Trace values={breathValues.length ? breathValues.map((v) => v + 1.2) : [0]} threshold={0} ceiling={2.4} color="#8ea2ff" />
        <p className="hint">Breathing needs a fixed camera; a handheld one is fine for pulse but not for this.</p>
      </article>

      <article className="card">
        <h2>Heart-rate variability <small>RMSSD, ms · not a cleared metric</small></h2>
        <div className="vital-row">
          <div className="vital"><span className="vital-big">{state?.hrv ? Math.round(state.hrv.rmssd) : '—'}</span><span className="vital-label">rmssd</span></div>
          <div className="vital"><span className="vital-big">{state?.hrv ? Math.round(state.hrv.sdnn) : '—'}</span><span className="vital-label">sdnn</span></div>
        </div>
        <p className="hint">Higher generally goes with being rested. Shown for interest; the vendor has not had this metric cleared and neither should you treat it as more than that.</p>
      </article>

      <article className="card card-wide">
        <h2>Movement <small>from the phone on controller 1 · what the health tab records</small></h2>
        <div className="vital-row">
          <div className="vital"><span className="vital-big">{movement.swingsPerMinute}</span><span className="vital-label">swings in the last minute</span></div>
          <div className="vital"><span className="vital-big">{movement.intensity.toFixed(1)}</span><span className="vital-label">intensity, m/s² mean</span></div>
          <div className="vital"><span className="vital-big">{movement.swings}</span><span className="vital-label">swings since open</span></div>
          <div className="vital"><span className="vital-big">{Math.floor(movement.activeSeconds / 60)}:{String(movement.activeSeconds % 60).padStart(2, '0')}</span><span className="vital-label">active since open</span></div>
        </div>
        <Trace values={movement.trace.length ? movement.trace : [0]} threshold={0.8} ceiling={6} color="#48e0b0" />
        <p className="hint">{linked ? 'Reads the one-second summaries the phone sends every five seconds. Swing to see it move.' : 'Relay offline: start it with npm run agent.'}</p>
      </article>
    </section>}

    <footer>
      <a href="/">Big screen</a>
      <a href="/motion.html">Motion lab</a>
      <span className="foot-note">Readings that pass the stability gate are stored locally in data/health.sqlite and nowhere else.</span>
    </footer>
  </main>
}
