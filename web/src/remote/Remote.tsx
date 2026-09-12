import { useCallback, useEffect, useRef, useState } from 'react'
import { useArena } from '../lib/store'
import { DeviceMotionSource, MotionStreamer, enterPlayMode, hasDeviceMotion, type MotionSource } from '../lib/motion'
import { SyntheticMotionSource, type FakeGesture } from '../lib/fakeMotion'
import { CONTROLS, KeyboardController, type KbState } from '../lib/keyboard'
import './remote.css'

const NICKS = ['Ace', 'Lucky', 'Slugger', 'Champ', 'Rookie', 'Hawk', 'Dice', 'Nova']

export default function Remote() {
  const params = new URLSearchParams(location.search)
  const seat = params.get('seat'); const tok = params.get('tok'); const fake = params.get('fake') === '1'
  const connect = useArena((s) => s.connect)
  const socket = useArena((s) => s.socket)
  const welcome = useArena((s) => s.welcome)
  const connected = useArena((s) => s.connected)
  const calib = useArena((s) => s.calib)
  const phase = useArena((s) => s.phase)
  const match = useArena((s) => s.match)
  const lastGesture = useArena((s) => s.lastGesture)
  const gestureSeq = useArena((s) => s.gestureSeq)
  const [nick, setNick] = useState<string>(() => { try { return localStorage.getItem('hap.nick') ?? NICKS[Math.floor(Math.random() * NICKS.length)] } catch { return 'Ace' } })
  const [screen, setScreen] = useState<'pickup' | 'calibrate' | 'play' | 'taken' | 'denied'>('pickup')
  const [meter, setMeter] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [kb, setKb] = useState<KbState | null>(null)
  const streamer = useRef<MotionStreamer | null>(null)
  const source = useRef<MotionSource | null>(null)
  const useFake = fake || !hasDeviceMotion()

  useEffect(() => { connect({ role: 'remote', token: tok, nickname: nick }) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect, tok])
  useEffect(() => { if (welcome && welcome.role === 'remote' && !welcome.seat_id && welcome.reason) setScreen('taken') }, [welcome])
  useEffect(() => { if (calib?.phase === 'done' && screen === 'calibrate') setScreen('play') }, [calib, screen])
  useEffect(() => {
    if (!lastGesture || lastGesture.device_id !== socket?.device) return
    const label = lastGesture.kind === 'punch' ? String(lastGesture.extra?.type ?? 'punch') : lastGesture.kind
    setFlash(label); const id = window.setTimeout(() => setFlash(null), 350); return () => window.clearTimeout(id)
  }, [gestureSeq, lastGesture, socket])

  const pickUp = useCallback(async () => {
    if (!socket) return
    try { localStorage.setItem('hap.nick', nick) } catch { /* ignore */ }
    socket.send('session.nickname', { nickname: nick })
    const src: MotionSource = useFake ? new SyntheticMotionSource() : new DeviceMotionSource()
    source.current = src
    const st = new MotionStreamer(socket); streamer.current = st
    st.onMeter = (m) => setMeter(m)
    try {
      await st.start(src)          // permission prompt happens here, inside the tap
      if (!useFake) await enterPlayMode()
      setScreen('calibrate')
    } catch { setScreen('denied') }
  }, [socket, nick, useFake])

  useEffect(() => () => { streamer.current?.stop() }, [])

  const trigger = (g: FakeGesture) => (source.current as SyntheticMotionSource | null)?.trigger?.(g)
  useEffect(() => {
    if (!useFake || !socket || screen !== 'play') return
    const c = new KeyboardController(socket, () => (useArena.getState().match?.sport ?? null), setKb)
    c.attach(); return () => c.detach()
  }, [useFake, socket, screen])

  if (!seat || !tok) return <Full><div className="msg">Scan a seat QR on the projector to play.</div><a className="pill" href="/rail">Join the rail instead</a></Full>
  if (screen === 'taken') return <Full><div className="msg">That seat is taken.</div><div className="sub">Scan the rail QR to bet on the match instead.</div><a className="pill blue" href={welcome?.rail_url ?? '/rail'}>Go to the rail</a></Full>
  if (screen === 'denied') return <Full><div className="msg">Motion access was denied.</div><div className="sub">Open this link in Safari or Chrome (not an in-app browser), then Settings → Motion & Orientation Access.</div><a className="pill" href="/rail">Join the rail instead</a></Full>
  if (screen === 'pickup') return (
    <div className="pickup">
      <div className="nicks">{NICKS.map((n) => <button key={n} className={`pill ${nick === n ? 'on' : ''}`} onClick={() => setNick(n)}>{n}</button>)}</div>
      <button className="big-btn" onClick={pickUp} disabled={!connected}>{connected ? 'Pick up the remote' : 'Connecting…'}</button>
      {useFake && <div className="devnote">Desktop test mode: synthetic motion</div>}
    </div>
  )
  if (screen === 'calibrate') return (
    <Full>
      <div className="msg">{calib?.phase === 'raise' ? 'Now raise the phone' : 'Hold still'}</div>
      <div className="bar"><div className="fill" style={{ width: `${Math.round((calib?.progress ?? 0) * 100)}%` }} /></div>
      <div className="sub">{calib?.phase === 'raise' ? 'Lift it forward like you are about to swing' : 'Hold it the way you would hold the bat, ball, or glove'}</div>
    </Full>
  )
  const sport = match?.sport ?? 'idle'
  const prompt = !match ? 'Waiting for the host to start a game' : phase?.phase === 'input' ? (sport === 'bowling' ? 'ROLL!' : sport === 'baseball' ? 'SWING!' : 'FIGHT!') : phase?.phase === 'betting' ? 'Bets are open…' : phase?.phase === 'resolving' ? '…' : 'Get ready'
  const remaining = phase?.deadline_ts ? Math.max(0, Math.round((phase.deadline_ts - (socket?.serverNow() ?? Date.now())) / 1000)) : null
  return (
    <div className={`play ${flash ? 'flash' : ''} ${phase?.phase === 'input' ? 'input' : ''}`}>
      <div className="top"><span className="chip">{welcome?.seat_label ?? seat}</span><span className="nick">{nick}</span><span className="chip">{connected ? 'live' : 'reconnecting'}</span></div>
      <div className="prompt">{flash ? flash.toUpperCase() : prompt}</div>
      {remaining !== null && phase?.phase !== 'resolving' && <div className="countdown">{remaining}</div>}
      <div className="meter"><div className="fill" style={{ width: `${Math.min(100, meter / 30 * 100)}%` }} /></div>
      {useFake && (
        <div className="devbar">
          <div className="kb-keys">{(sport !== 'idle' ? CONTROLS[sport] ?? [] : []).map((c) => <span key={c.key}><kbd>{c.key}</kbd> {c.does}</span>)}{kb?.charge != null && <span>charge {Math.round(kb.charge * 100)}%</span>}{kb?.guard && <span>GUARD</span>}</div>
          <div className="devnote">Synthetic motion (runs the detectors):</div>
          {(['swing', 'jab', 'hook', 'block', 'unblock', 'dodge', 'shake', 'bump', 'flick'] as FakeGesture[]).map((g) => <button key={g} className="pill" onClick={() => trigger(g)}>{g}</button>)}
        </div>
      )}
    </div>
  )
}

function Full({ children }: { children: React.ReactNode }) { return <div className="full">{children}</div> }
