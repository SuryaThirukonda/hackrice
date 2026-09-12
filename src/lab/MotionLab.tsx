import { useEffect, useMemo, useRef, useState } from 'react'
import { CONTROLLER_CONFIG, type Sport } from '../phone/config'
import { phonePunchKind, type ControllerGesture } from '../input/controller'
import { punchDamageMultiplier } from '../games/boxing/sim/punch'
import { Trace } from './Trace'
import './lab.css'

/**
 * Motion lab: what the phone is actually sending, on the big screen.
 *
 * You cannot read a phone screen while swinging the phone, so this listens on the game side of the
 * relay and shows every packet a controller sends: the live acceleration trace against the detector's
 * own trigger threshold, each gesture it fired, and the move that gesture becomes in the match. When
 * a swing does not register, the trace says whether it never crossed the threshold, and when it does
 * register, the verdict line says what the sim will do with it.
 */
type ControllerId = 'controller_1' | 'controller_2'
const IDS: ControllerId[] = ['controller_1', 'controller_2']
const SPORTS: Sport[] = ['boxing', 'golf', 'bowling']
const TRACE_SAMPLES = 260
const LOG_LIMIT = 40

interface Packet {
  type?: string
  controllerId?: string
  connected?: boolean
  a?: number[]
  r?: number[]
  stick?: number[]
  gesture?: string
  action?: string
  power?: number
  peakAcceleration?: number
  peakRotation?: number
  duration?: number
  directionLabel?: string
  axis?: string
  sport?: string
  metrics?: { sensorHz?: number; rttNow?: number; rttMedian?: number; rttP95?: number }
}

interface Live {
  a: [number, number, number]
  r: [number, number, number]
  stick: [number, number]
  sensorHz: number
  rtt: number
  trace: number[]
  rotTrace: number[]
}

const blank = (): Live => ({ a: [0, 0, 0], r: [0, 0, 0], stick: [0, 0], sensorHz: 0, rtt: 0, trace: [], rotTrace: [] })
const mag = (v: number[] | undefined): number => (v && v.length >= 3 ? Math.hypot(v[0], v[1], v[2]) : 0)
const vec3 = (v: number[] | undefined): [number, number, number] => [v?.[0] ?? 0, v?.[1] ?? 0, v?.[2] ?? 0]

interface Entry {
  id: string
  at: string
  controller: ControllerId
  kind: 'gesture' | 'action'
  title: string
  power: number
  peakA: number
  peakR: number
  duration: number
  direction: string
  verdict: string
}

/** What the game does with this gesture. The only place the lab reaches into game code. */
function verdictFor(sport: string, power: number, peakRotation: number): string {
  if (sport === 'boxing') {
    // The real rule, not a copy of it: phonePunchKind reads nothing but peakRotation.
    const kind = phonePunchKind({ peakRotation } as unknown as ControllerGesture)
    const multiplier = punchDamageMultiplier(power / 100)
    return `${kind.toUpperCase()} · damage ×${multiplier.toFixed(2)}`
  }
  if (sport === 'golf') return `shot power ${power}%`
  if (sport === 'bowling') return `roll power ${power}%`
  return `power ${power}%`
}

const ACTION_LABEL: Record<string, string> = {
  block_start: 'A held · guard up',
  block_end: 'A released · guard down',
  emergency_power: 'B · duck',
  placeholder_primary: 'A · secondary',
  placeholder_secondary: 'B · secondary',
}

export default function MotionLab(): React.ReactElement {
  const [status, setStatus] = useState('connecting')
  const [online, setOnline] = useState<ControllerId[]>([])
  const [sport, setSport] = useState<Sport>('boxing')
  const [watching, setWatching] = useState<ControllerId>('controller_1')
  const [log, setLog] = useState<Entry[]>([])
  const [live, setLive] = useState<Record<ControllerId, Live>>({ controller_1: blank(), controller_2: blank() })
  // Held state, straight off the wire: A down is block_start, A up is block_end.
  const [guard, setGuard] = useState<Record<ControllerId, boolean>>({ controller_1: false, controller_2: false })
  // Counts delivered swings; a change restarts the green flash and names the newest verdict.
  const [punch, setPunch] = useState<{ id: number; verdict: string; controller: ControllerId } | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const sportRef = useRef<Sport>('boxing')
  const seq = useRef(0)

  const detector = CONTROLLER_CONFIG.detectors[sport]

  // One socket for the page's whole life. It reconnects itself, because the relay restarts often
  // during tuning and a dead diagnostic page is worse than no diagnostic page.
  useEffect(() => {
    let closed = false
    let retry: number | undefined
    const open = (): void => {
      if (closed) return
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const socket = new WebSocket(`${protocol}://${location.host}/controller-game-ws`)
      socketRef.current = socket
      socket.onopen = () => {
        setStatus('listening')
        // Ask every phone to stream raw motion; without this the lab only sees gestures.
        socket.send(JSON.stringify({ type: 'game_state', sport: sportRef.current, telemetry: true }))
      }
      socket.onclose = () => {
        setStatus('relay offline')
        setOnline([])
        if (!closed) retry = window.setTimeout(open, 1000)
      }
      socket.onerror = () => setStatus('relay offline')
      socket.onmessage = (message) => {
        if (typeof message.data !== 'string') return
        let packet: Packet
        try { packet = JSON.parse(message.data) as Packet } catch { return }
        const id = IDS.includes(packet.controllerId as ControllerId) ? packet.controllerId as ControllerId : null

        if (packet.type === 'controller_status' && id) {
          setOnline((current) => packet.connected ? [...new Set([...current, id])] : current.filter((x) => x !== id))
          // A phone that drops mid-hold must not leave the guard shown as up.
          if (!packet.connected) setGuard((current) => ({ ...current, [id]: false }))
          return
        }
        if (!id) return

        if (packet.type === 'motion') {
          setLive((current) => {
            const previous = current[id]
            return {
              ...current,
              [id]: {
                ...previous,
                a: vec3(packet.a),
                r: vec3(packet.r),
                sensorHz: packet.metrics?.sensorHz ?? previous.sensorHz,
                rtt: packet.metrics?.rttMedian ?? previous.rtt,
                trace: [...previous.trace, mag(packet.a)].slice(-TRACE_SAMPLES),
                rotTrace: [...previous.rotTrace, mag(packet.r)].slice(-TRACE_SAMPLES),
              },
            }
          })
          return
        }
        if (packet.type === 'stick') {
          setLive((current) => ({ ...current, [id]: { ...current[id], stick: [packet.stick?.[0] ?? 0, packet.stick?.[1] ?? 0] } }))
          return
        }
        if (packet.type === 'gesture' || packet.type === 'action') {
          seq.current += 1
          const at = new Date().toLocaleTimeString(undefined, { hour12: false })
          const entry: Entry = packet.type === 'gesture'
            ? {
                id: `e${seq.current}`, at, controller: id, kind: 'gesture',
                title: packet.gesture ?? 'gesture',
                power: packet.power ?? 0,
                peakA: packet.peakAcceleration ?? 0,
                peakR: packet.peakRotation ?? 0,
                duration: packet.duration ?? 0,
                direction: `${packet.directionLabel ?? '—'}${packet.axis ? ` (${packet.axis})` : ''}`,
                verdict: verdictFor(packet.sport ?? '', packet.power ?? 0, packet.peakRotation ?? 0),
              }
            : {
                id: `e${seq.current}`, at, controller: id, kind: 'action',
                title: ACTION_LABEL[packet.action ?? ''] ?? packet.action ?? 'action',
                power: 0, peakA: 0, peakR: 0, duration: 0, direction: '—', verdict: 'button',
              }
          setLog((current) => [entry, ...current].slice(0, LOG_LIMIT))
          if (packet.type === 'gesture') setPunch((current) => ({ id: (current?.id ?? 0) + 1, verdict: entry.verdict, controller: id }))
          if (packet.action === 'block_start') setGuard((current) => ({ ...current, [id]: true }))
          if (packet.action === 'block_end') setGuard((current) => ({ ...current, [id]: false }))
        }
      }
    }
    open()
    return () => { closed = true; window.clearTimeout(retry); socketRef.current?.close() }
  }, [])

  // Switching sport here switches it on the phones too, so their detector thresholds change with it.
  const chooseSport = (next: Sport): void => {
    setSport(next)
    sportRef.current = next
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'game_state', sport: next, telemetry: true }))
  }

  const watched = live[watching]
  const gestures = useMemo(() => log.filter((e) => e.kind === 'gesture'), [log])
  const peak = watched.trace.length ? Math.max(...watched.trace) : 0
  const connected = online.includes(watching)

  return <main className="lab">
    <header>
      <div>
        <h1>Motion lab</h1>
        <p>What the phone is sending, and what the game will do with it.</p>
      </div>
      <div className="lab-state">
        <span className={`pill pill-${status === 'listening' ? 'ok' : 'bad'}`}>{status}</span>
        {IDS.map((id) => <button key={id} type="button" className={`pill ${watching === id ? 'pill-on' : ''} ${online.includes(id) ? 'pill-ok' : 'pill-idle'}`} onClick={() => setWatching(id)}>
          {id === 'controller_1' ? 'Controller 1' : 'Controller 2'} · {online.includes(id) ? 'connected' : 'free'}
        </button>)}
      </div>
    </header>

    <nav className="lab-sports" aria-label="Sport">
      {SPORTS.map((s) => <button key={s} type="button" className={s === sport ? 'on' : ''} onClick={() => chooseSport(s)}>{s}</button>)}
      <span>changes the detector on the phone too</span>
    </nav>

    {!connected && <p className="lab-empty">
      Nothing connected on this slot yet. Open <strong>CONNECT A PHONE</strong> in the game, scan the code,
      then tap Connect and Calibrate. This page turns the phone's raw stream on by itself.
    </p>}

    <section className="lab-grid">
      <article className="card card-wide">
        {punch && punch.controller === watching && <div key={punch.id} className="punch-flash" aria-hidden="true">
          <span>{punch.verdict}</span>
        </div>}
        <h2>Acceleration <small>m/s² · the dashed line is the swing trigger</small></h2>
        <Trace values={watched.trace} threshold={detector.startAcceleration} ceiling={detector.powerAccelerationMax} color="#48e0b0" />
        <dl className="readout">
          <div><dt>now</dt><dd>{mag(watched.a).toFixed(2)}</dd></div>
          <div><dt>peak shown</dt><dd>{peak.toFixed(2)}</dd></div>
          <div><dt>trigger</dt><dd>{detector.startAcceleration}</dd></div>
          <div><dt>full power at</dt><dd>{detector.powerAccelerationMax}</dd></div>
        </dl>
        <p className="hint">
          {peak < detector.startAcceleration
            ? 'No swing has crossed the trigger yet. Move faster, or recalibrate while holding the phone still.'
            : peak >= detector.powerAccelerationMax
              ? 'Swings are reaching full power. Anything harder scores the same.'
              : 'Swings are crossing the trigger. The higher above it they peak, the more power they carry.'}
        </p>
      </article>

      <article className="card">
        <h2>Rotation <small>deg/s</small></h2>
        <Trace values={watched.rotTrace} threshold={sport === 'boxing' ? 200 : detector.armRotation} ceiling={detector.powerRotationMax} color="#8ea2ff" />
        <dl className="readout">
          <div><dt>now</dt><dd>{mag(watched.r).toFixed(0)}</dd></div>
          <div><dt>x</dt><dd>{watched.r[0].toFixed(0)}</dd></div>
          <div><dt>y</dt><dd>{watched.r[1].toFixed(0)}</dd></div>
          <div><dt>z</dt><dd>{watched.r[2].toFixed(0)}</dd></div>
        </dl>
        <p className="hint">{sport === 'boxing'
          ? 'Above 200 deg/s a punch is sent as a cross instead of a jab.'
          : `Arming this swing needs ${detector.armRotation} deg/s of wind-up first.`}</p>
      </article>

      <article className="card">
        <h2>Buttons, D-pad and link</h2>
        <div className={`guard ${guard[watching] ? 'guard-up' : ''}`} role="status">
          {guard[watching] ? 'GUARD UP · A is held' : 'guard down · hold A to block'}
        </div>
        <div className="stick" role="img" aria-label={`stick at ${watched.stick[0].toFixed(2)}, ${watched.stick[1].toFixed(2)}`}>
          <span className="stick-dot" style={{ left: `${50 + watched.stick[0] * 42}%`, top: `${50 + watched.stick[1] * 42}%` }} />
        </div>
        <dl className="readout">
          <div><dt>x</dt><dd>{watched.stick[0].toFixed(2)}</dd></div>
          <div><dt>y</dt><dd>{watched.stick[1].toFixed(2)}</dd></div>
          <div><dt>sensor</dt><dd>{watched.sensorHz.toFixed(0)} Hz</dd></div>
          <div><dt>round trip</dt><dd>{watched.rtt ? `${watched.rtt.toFixed(0)} ms` : '—'}</dd></div>
        </dl>
        <p className="hint">In boxing, x past 0.6 slips left or right and y past 0.5 steps in or out.</p>
      </article>

      <article className="card card-wide">
        <h2>Events <small>newest first · {gestures.length} swings this session</small></h2>
        {log.length === 0
          ? <p className="hint">Swing the phone, or press A or B. Everything the relay delivers shows up here.</p>
          : <div className="log-scroll"><table className="log">
              <thead><tr><th>time</th><th>slot</th><th>event</th><th>power</th><th>peak a</th><th>peak rot</th><th>ms</th><th>toward</th><th>in game</th></tr></thead>
              <tbody>{log.map((e) => <tr key={e.id} className={e.kind === 'action' ? 'row-action' : ''}>
                <td>{e.at}</td>
                <td>{e.controller === 'controller_1' ? '1' : '2'}</td>
                <td>{e.title}</td>
                <td>{e.kind === 'gesture' ? `${e.power}%` : '—'}</td>
                <td>{e.kind === 'gesture' ? e.peakA.toFixed(1) : '—'}</td>
                <td>{e.kind === 'gesture' ? e.peakR.toFixed(0) : '—'}</td>
                <td>{e.kind === 'gesture' ? e.duration.toFixed(0) : '—'}</td>
                <td>{e.direction}</td>
                <td className="verdict">{e.verdict}</td>
              </tr>)}</tbody>
            </table></div>}
      </article>
    </section>

    <footer>
      <a href="/">Big screen</a>
      <a href="/join.html">Join page</a>
      <button type="button" onClick={() => setLog([])}>Clear events</button>
    </footer>
  </main>
}
