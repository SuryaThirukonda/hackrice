import { useCallback, useEffect, useRef, useState } from 'react'
import { SyntheticMotionSource } from './fakeMotion'
import {
  DeviceMotionSource,
  hasDeviceMotion,
  type AccelerationMode,
  type MotionSource,
} from './motion'
import {
  CONTROLLER_CONFIG,
  DEFAULT_DIRECTION_MODE,
  type DirectionMode,
  type Sport,
} from './config'
import {
  ControllerSocket,
  type ControllerAction,
  type ControllerConnectionState,
  type ControllerId,
  type RttMetrics,
} from './ControllerSocket'
import {
  MotionProcessor,
  type DetectedGesture,
  type MotionSnapshot,
  type Vector3,
} from './motionProcessor'
import { TiltStickProcessor, type StickSnapshot } from './tiltStick'
import { Arrow, Busy, Duck, Pip, Power, Shield, Stop, Timer } from './Glyphs'
import { ActivityTracker } from '../health/activity'
import './controller.css'
import './play.css'

type Player = 1 | 2
type MotionState = 'off' | 'requesting' | 'enabled' | 'denied' | 'unavailable'
type AttemptPhase = 'idle' | 'countdown' | 'capturing' | 'result'


interface GestureFlash {
  gesture: DetectedGesture
  sent: boolean
}

const SPORTS: { value: Sport; label: string; icon: string }[] = [
  { value: 'golf', label: 'Golf', icon: '⛳' },
  { value: 'boxing', label: 'Boxing', icon: '🥊' },
  { value: 'bowling', label: 'Bowling', icon: '🎳' },
]

const DIRECTIONS: { value: DirectionMode; label: string; hint: string }[] = [
  { value: 'up_down', label: 'Up / down', hint: 'Screen vertical' },
  { value: 'left_right', label: 'Left / right', hint: 'Screen horizontal' },
  { value: 'swing', label: 'Swing', hint: 'Rotation-led arc' },
  { value: 'mixed_3d', label: 'Mixed 3D', hint: 'Any outward direction' },
]

const PLAYER_STORAGE_KEY = 'hap.controller.player'

function initialPlayer(): Player {
  const requested = new URLSearchParams(location.search).get('player')
  if (requested === '1' || requested === '2') return Number(requested) as Player
  try {
    return localStorage.getItem(PLAYER_STORAGE_KEY) === '2' ? 2 : 1
  } catch {
    return 1
  }
}

function metric(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toFixed(1)}${suffix}`
}

function vectorComponent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function connectionLabel(state: ControllerConnectionState): string {
  if (state === 'awaiting-ack') return 'verifying hello'
  return state
}

function gestureLabel(gesture: DetectedGesture['gesture']): string {
  if (gesture === 'golf_swing') return 'Golf swing'
  if (gesture === 'bowling_swing') return 'Bowling swing'
  return 'Punch'
}

function controllerId(player: Player): ControllerId {
  return `controller_${player}`
}

export default function Controller() {
  const params = new URLSearchParams(location.search)
  const fakeMode = params.get('fake') === '1'
  const debugMode = params.get('debug') === '1'
  const [player, setPlayer] = useState<Player>(initialPlayer)
  const [sport, setSport] = useState<Sport>('golf')
  const [directionMode, setDirectionMode] = useState<DirectionMode>(
    DEFAULT_DIRECTION_MODE.golf,
  )
  const [motionState, setMotionState] = useState<MotionState>('off')
  const [accelerationMode, setAccelerationMode] = useState<AccelerationMode>('waiting')
  const [motionError, setMotionError] = useState('')
  const [connectionState, setConnectionState] = useState<ControllerConnectionState>('disconnected')
  const [connectionDetail, setConnectionDetail] = useState('Tap Connect to claim this controller')
  const [rtt, setRtt] = useState<RttMetrics>({
    now: null,
    median: null,
    p95: null,
    sampleCount: 0,
  })
  const [telemetryEnabled, setTelemetryEnabled] = useState(debugMode)
  const [flash, setFlash] = useState<GestureFlash | null>(null)
  const [lastGesture, setLastGesture] = useState<GestureFlash | null>(null)
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>('idle')
  const [countdown, setCountdown] = useState<number>(
    CONTROLLER_CONFIG.ui.attemptCountdownSeconds,
  )
  const [blocking, setBlocking] = useState(false)
  const [punchId, setPunchId] = useState(0)
  const [lastAction, setLastAction] = useState('')
  const socketRef = useRef<ControllerSocket | null>(null)
  const movementRef = useRef<[number, number]>([0, 0])
  const [heldDirection, setHeldDirection] = useState('')
  const move = (direction: string, x: number, y: number) => {
    movementRef.current = [x, y]
    setHeldDirection(direction)
  }
  useEffect(() => {
    const stop = () => { movementRef.current = [0, 0]; setHeldDirection('') }
    const timer = window.setInterval(() => socketRef.current?.sendStick({
      vector: movementRef.current, raw: movementRef.current,
      calibration: 'calibrated', calibrationProgress: 1,
    }), 40)
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', stop)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', stop)
    }
  }, [])
  const sourceRef = useRef<MotionSource | null>(null)
  const telemetryRef = useRef(debugMode)
  const flashTimerRef = useRef<number | null>(null)
  const activityRef = useRef(new ActivityTracker())
  const activityTimerRef = useRef<number | null>(null)
  const attemptIntervalRef = useRef<number | null>(null)
  const attemptTimeoutRef = useRef<number | null>(null)
  const attemptPhaseRef = useRef<AttemptPhase>('idle')
  const bestGestureRef = useRef<DetectedGesture | null>(null)
  const sportRef = useRef<Sport>(sport)
  const blockingRef = useRef(false)
  const [processor] = useState(() => {
    const next = new MotionProcessor(sport, directionMode)
    next.setDetectionEnabled(false)
    return next
  })
  const [tiltStick] = useState(() => new TiltStickProcessor())
  const [snapshot, setSnapshot] = useState<MotionSnapshot>(
    () => processor.getSnapshot(),
  )
  const [stickSnapshot, setStickSnapshot] = useState<StickSnapshot>(
    () => tiltStick.getSnapshot(),
  )

  useEffect(() => {
    try {
      localStorage.setItem(PLAYER_STORAGE_KEY, String(player))
    } catch {
      // Query state remains authoritative when storage is unavailable.
    }
  }, [player])

  const publishGesture = useCallback((gesture: DetectedGesture) => {
    const sent = socketRef.current?.sendGesture(gesture) ?? false
    const nextFlash = { gesture, sent }
    setFlash(nextFlash)
    setLastGesture(nextFlash)
    // A new id per delivered swing restarts the green pulse on the pad even mid-animation.
    if (sent) setPunchId((n) => n + 1)
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(
      () => setFlash(null),
      CONTROLLER_CONFIG.ui.gestureFlashMs,
    )
  }, [])

  useEffect(() => {
    processor.setGestureHandler((gesture) => {
      // every detected swing contributes its range of motion, published or not
      activityRef.current.noteSwing(gesture.t, gesture.duration)
      if (sportRef.current === 'boxing') {
        publishGesture(gesture)
      } else if (
        attemptPhaseRef.current === 'capturing'
        && (bestGestureRef.current === null || gesture.power > bestGestureRef.current.power)
      ) {
        bestGestureRef.current = gesture
      }
    })
    return () => processor.setGestureHandler(null)
  }, [processor, publishGesture])

  useEffect(() => {
    const refresh = () => {
      setSnapshot(processor.getSnapshot())
      setStickSnapshot(tiltStick.getSnapshot())
      setAccelerationMode(sourceRef.current?.accelerationMode ?? 'waiting')
    }
    refresh()
    const timer = window.setInterval(refresh, CONTROLLER_CONFIG.ui.refreshMs)
    return () => window.clearInterval(timer)
  }, [processor, tiltStick])

  useEffect(() => () => {
    sourceRef.current?.stop()
    if (blockingRef.current) {
      socketRef.current?.sendAction('block_end', 'boxing')
      blockingRef.current = false
    }
    if (activityTimerRef.current !== null) { window.clearInterval(activityTimerRef.current); activityTimerRef.current = null }
    const tail = activityRef.current.flush()
    socketRef.current?.sendActivity(tail.epochs, tail.roms)
    socketRef.current?.disconnect()
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    if (attemptIntervalRef.current !== null) window.clearInterval(attemptIntervalRef.current)
    if (attemptTimeoutRef.current !== null) window.clearTimeout(attemptTimeoutRef.current)
  }, [])

  const enableMotion = async (): Promise<boolean> => {
    if (motionState === 'requesting') return false
    if (motionState === 'enabled') {
      processor.startCalibration()
      tiltStick.startCalibration()
      setSnapshot(processor.getSnapshot())
      return true
    }
    if (!fakeMode && !hasDeviceMotion()) {
      setMotionState('unavailable')
      const isHttp = typeof window !== 'undefined' && !window.isSecureContext
      setMotionError(
        isHttp
          ? 'Motion sensors require HTTPS. Open the secure tunnel link or play using the D-pad and buttons.'
          : 'Motion sensors are not available on this browser/device. You can still use the buttons below.',
      )
      return false
    }

    sourceRef.current?.stop()
    processor.reset()
    tiltStick.reset()
    setAccelerationMode('waiting')
    setSnapshot(processor.getSnapshot())
    setMotionState('requesting')
    setMotionError('')
    const source: MotionSource = fakeMode
      ? new SyntheticMotionSource()
      : new DeviceMotionSource()
    sourceRef.current = source
    try {
      await source.start((sample) => {
        const processed = processor.push(sample)
        tiltStick.push(sample)
        // the health record: one-second movement summaries, folded here at full rate
        activityRef.current.push(processed.t, processed.accelerationMagnitude, processed.rotationMagnitude, processed.intervalMs)
        const socket = socketRef.current
        socket?.setSensorHz(processed.sensorHz)
        if (telemetryRef.current) socket?.sendMotion(processed)
      })
      setAccelerationMode(source.accelerationMode)
      setMotionState('enabled')
      processor.startCalibration()
      tiltStick.startCalibration()
      setSnapshot(processor.getSnapshot())
      return true
    } catch (error) {
      source.stop()
      if (sourceRef.current === source) sourceRef.current = null
      setAccelerationMode('waiting')
      setMotionState('denied')
      setMotionError(
        error instanceof Error
          ? error.message
          : 'Motion permission was denied. Enable Motion & Orientation Access and retry.',
      )
      return false
    }
  }

  const connect = () => {
    socketRef.current?.disconnect()
    setRtt({ now: null, median: null, p95: null, sampleCount: 0 })
    setConnectionDetail('Opening same-origin controller socket')
    const socket = new ControllerSocket({
      controllerId: controllerId(player),
      onState: (state, detail) => {
        setConnectionState(state)
        if (state !== 'connected') {
          blockingRef.current = false
          setBlocking(false)
        }
        if (detail) {
          setConnectionDetail(detail)
        } else if (state === 'connected') {
          setConnectionDetail('Hello acknowledged by the game')
        } else if (state === 'awaiting-ack') {
          setConnectionDetail('Waiting for the game to accept this player')
        }
      },
      onMetrics: setRtt,
      onSport: nextSport => { if (sportRef.current !== nextSport) selectSport(nextSport) },
      onBlocking: active => { blockingRef.current = active; setBlocking(active) },
      // The motion test page asks every phone to stream, so nobody has to find the toggle below.
      onTelemetry: enabled => { if (telemetryRef.current !== enabled) setTelemetry(enabled) },
    })
    socket.setSensorHz(processor.getSnapshot().sensorHz)
    socketRef.current = socket
    socket.connect()
    if (activityTimerRef.current !== null) window.clearInterval(activityTimerRef.current)
    activityTimerRef.current = window.setInterval(() => {
      const { epochs, roms } = activityRef.current.drain()
      socketRef.current?.sendActivity(epochs, roms)
    }, CONTROLLER_CONFIG.ui.activityReportMs)
  }

  const turnOnController = async () => {
    if (motionState === 'requesting') return
    const motionReady = await enableMotion()
    if (connectionState !== 'connected') connect()
    if (motionReady) {
      setLastAction('Controller on · hold still while it calibrates')
    } else {
      setLastAction('Connected in button/D-pad mode')
    }
  }

  const disconnect = () => {
    if (blockingRef.current) {
      socketRef.current?.sendAction('block_end', 'boxing')
      blockingRef.current = false
      setBlocking(false)
    }
    socketRef.current?.disconnect()
    socketRef.current = null
    setConnectionState('disconnected')
    setConnectionDetail('Disconnected manually; gestures stay local')
  }

  const sendControllerAction = (
    action: ControllerAction,
    label: string,
    actionSport: Sport = sportRef.current,
  ) => {
    const sent = socketRef.current?.sendAction(action, actionSport) ?? false
    setLastAction(`${label} · ${sent ? 'sent' : 'not connected'}`)
    return sent
  }

  /** A is a hold: the guard is up exactly as long as the thumb is down. The sim already charges stamina
   *  for a held guard, so the phone imposes no timer and no cooldown of its own. */
  /** Keep the pointer on the button it started on, so sliding a thumb off still ends the hold. A
   *  keyboard or synthetic press has no active pointer and must not throw here. */
  const capture = (e: React.PointerEvent<HTMLElement>) => { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not a live pointer */ } }

  const beginBlock = () => {
    if (sportRef.current !== 'boxing' || blockingRef.current) return
    if (!sendControllerAction('block_start', 'Guard up', 'boxing')) return
    blockingRef.current = true
    setBlocking(true)
  }
  const endBlock = () => {
    if (!blockingRef.current) return
    blockingRef.current = false
    setBlocking(false)
    sendControllerAction('block_end', 'Guard down', 'boxing')
  }

  /** B ducks. On the wire it is still `emergency_power`, the name the relay and the game map to a duck. */
  const duck = () => {
    if (sportRef.current !== 'boxing') return
    sendControllerAction('emergency_power', 'Duck', 'boxing')
  }

  const clearAttemptTimers = () => {
    if (attemptIntervalRef.current !== null) {
      window.clearInterval(attemptIntervalRef.current)
      attemptIntervalRef.current = null
    }
    if (attemptTimeoutRef.current !== null) {
      window.clearTimeout(attemptTimeoutRef.current)
      attemptTimeoutRef.current = null
    }
  }

  const cancelAttempt = () => {
    clearAttemptTimers()
    bestGestureRef.current = null
    attemptPhaseRef.current = 'idle'
    setAttemptPhase('idle')
    setCountdown(CONTROLLER_CONFIG.ui.attemptCountdownSeconds)
    processor.setDetectionEnabled(sportRef.current === 'boxing')
  }

  const completeAttempt = () => {
    if (attemptPhaseRef.current !== 'capturing') return
    clearAttemptTimers()
    processor.setDetectionEnabled(false)
    attemptPhaseRef.current = 'result'
    setAttemptPhase('result')
    const best = bestGestureRef.current
    bestGestureRef.current = null
    if (best) publishGesture(best)
  }

  const startAttempt = () => {
    if (sportRef.current === 'boxing') return
    cancelAttempt()
    sendControllerAction('placeholder_secondary', 'Armed · Timer started')
    setLastGesture(null)
    setFlash(null)
    attemptPhaseRef.current = 'countdown'
    setAttemptPhase('countdown')
    let remaining = CONTROLLER_CONFIG.ui.attemptCountdownSeconds
    setCountdown(remaining)
    attemptIntervalRef.current = window.setInterval(() => {
      remaining -= 1
      setCountdown(Math.max(0, remaining))
      if (remaining > 0) return
      if (attemptIntervalRef.current !== null) {
        window.clearInterval(attemptIntervalRef.current)
        attemptIntervalRef.current = null
      }
      bestGestureRef.current = null
      processor.setDetectionEnabled(true)
      processor.resetDetector()
      attemptPhaseRef.current = 'capturing'
      setAttemptPhase('capturing')
      attemptTimeoutRef.current = window.setTimeout(
        completeAttempt,
        CONTROLLER_CONFIG.ui.attemptCaptureMs,
      )
    }, 1_000)
  }

  const stopOscillation = () => {
    sendControllerAction('placeholder_primary', 'Oscillation stopped')
  }

  const selectPlayer = (nextPlayer: Player) => {
    if (nextPlayer === player) return
    cancelAttempt()
    disconnect()
    processor.reset()
    setSnapshot(processor.getSnapshot())
    setLastGesture(null)
    setPlayer(nextPlayer)
    const url = new URL(location.href)
    url.searchParams.set('player', String(nextPlayer))
    history.replaceState(null, '', url)
  }

  const selectSport = (nextSport: Sport) => {
    if (blockingRef.current) {
      blockingRef.current = false
      setBlocking(false)
      sendControllerAction('block_end', 'Block off', 'boxing')
    }
    cancelAttempt()
    const nextDirectionMode = DEFAULT_DIRECTION_MODE[nextSport]
    sportRef.current = nextSport
    setSport(nextSport)
    processor.setSport(nextSport)
    setDirectionMode(nextDirectionMode)
    processor.setDirectionMode(nextDirectionMode)
    processor.setDetectionEnabled(nextSport === 'boxing')
    setSnapshot(processor.getSnapshot())
    setLastGesture(null)
    setLastAction('')
    setFlash(null)
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
  }

  const selectDirectionMode = (nextMode: DirectionMode) => {
    cancelAttempt()
    setDirectionMode(nextMode)
    processor.setDirectionMode(nextMode)
    setSnapshot(processor.getSnapshot())
    setLastGesture(null)
    setFlash(null)
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
  }

  const calibrate = () => {
    cancelAttempt()
    processor.startCalibration()
    tiltStick.startCalibration()
    setSnapshot(processor.getSnapshot())
    setLastGesture(null)
    setFlash(null)
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
  }

  const setTelemetry = (enabled: boolean) => {
    telemetryRef.current = enabled
    setTelemetryEnabled(enabled)
  }

  const triggerSynthetic = (gesture: 'jab' | 'hook' | 'swing') => {
    const source = sourceRef.current
    if (source?.kind === 'synthetic') {
      (source as SyntheticMotionSource).trigger(gesture)
    }
  }

  const motionButtonLabel = motionState === 'requesting'
    ? 'REQUESTING…'
    : motionState === 'enabled'
      ? 'MOTION ENABLED'
      : motionState === 'denied'
        ? 'RETRY MOTION'
        : 'ENABLE MOTION'
  const connectDisabled = connectionState === 'connecting'
    || connectionState === 'awaiting-ack'
    || connectionState === 'connected'
    || connectionState === 'reconnecting'
  const oneShotSport = sport === 'golf' || sport === 'bowling'
  const attemptActive = attemptPhase === 'countdown' || attemptPhase === 'capturing'
  const attemptReady = motionState === 'enabled'
    && snapshot.calibration === 'calibrated'
    && !attemptActive
  const scoreValue = attemptPhase === 'countdown'
    ? String(countdown)
    : attemptPhase === 'capturing'
      ? 'GO'
      : lastGesture
        ? String(lastGesture.gesture.power)
        : '—'
  const scoreMessage = sport === 'boxing'
    ? 'Punch upright or forward with your grip. Only the outward stroke adds power.'
    : attemptPhase === 'countdown'
      ? 'Get ready…'
      : attemptPhase === 'capturing'
        ? 'Move now — the best motion in this window will score.'
        : attemptPhase === 'result'
          ? lastGesture
            ? 'Attempt complete.'
            : 'No complete motion detected. Try again.'
          : 'Press A when you are ready.'


  if (!debugMode) return (
    <main className={`play-remote sport-${sport}`}>
      <header className="remote-top"><a href="/">‹ Sports club</a><span className={connectionState === 'connected' ? 'live' : ''}>● {connectionState === 'connected' ? 'Connected' : 'Not connected'}</span></header>
      <div className="remote-title"><span className="remote-badge">{SPORTS.find(s => s.value === sport)?.icon}</span><h1>Controller {player}</h1><p>Your move. Your power.</p></div>
      <p className="sport-status">{connectionState === 'connected' ? `${sport === 'golf' ? 'Mini golf' : sport === 'boxing' ? 'Boxing' : 'Bowling'} · set by the big screen` : 'Connect to sync with the big screen'}</p>
      <section className="remote-setup" aria-label="Controller status">
        <p>{sport === 'boxing'
          ? 'Calibration: hold your phone in your punching grip at chest height, elbow bent and wrist straight. Hold still, then punch forward.'
          : sport === 'golf'
            ? 'Calibration: hold the phone with both hands like a short club handle in front of your waist. Hold still; press A and swing on GO.'
            : 'Calibration: hold the phone in your bowling hand beside your hip. Hold still; press A and swing underarm on GO. Keep hold of the phone.'}</p>
        <p role="status">{motionError || (snapshot.calibration !== 'calibrated' ? snapshot.calibrationMessage : 'Ready! Hold your phone securely and give yourself space.')}</p>
      </section>
      <section className={`remote-score${flash?.sent ? ' punched' : ''}`} aria-live="polite"><small>{attemptActive ? 'Get ready' : 'Your power'}</small><strong>{scoreValue}</strong><p>{scoreMessage}</p></section>
      <details className="remote-options"><summary>Live motion readings</summary>
        <p>{fakeMode ? 'SIMULATED INPUT' : 'Phone sensors'} · {accelerationMode} · {Math.round(snapshot.sensorHz)} Hz</p>
        <p>Acceleration {snapshot.accelerationMagnitude.toFixed(2)} m/s² · Gyroscope {snapshot.rotationMagnitude.toFixed(1)} °/s</p>
        <p>X {snapshot.acceleration[0].toFixed(2)} · Y {snapshot.acceleration[1].toFixed(2)} · Z {snapshot.acceleration[2].toFixed(2)}</p>
        {lastGesture && <p>Last punch peak: {lastGesture.gesture.peakAcceleration.toFixed(2)} m/s² · {lastGesture.gesture.peakRotation.toFixed(1)} °/s · {lastGesture.sent ? 'Sent to game' : 'Not sent — disconnected'}</p>}
      </details>
      <section className="console-shell" aria-label="Gamepad" onContextMenu={e => e.preventDefault()}>
        {punchId > 0 && <div key={punchId} className="punch-ring" aria-hidden="true" />}
        <div className="console-mark">MOTION CLUB <span>● ● ●</span></div>
        <div className="console-controls">
          <div className="dpad" aria-label="Move character">
            {([{label:'Up',x:0,y:-1},{label:'Left',x:-1,y:0},{label:'Right',x:1,y:0},{label:'Down',x:0,y:1}] as const).map(d => <button key={d.label} className={`dpad-${d.label.toLowerCase()}`} aria-label={d.label} aria-pressed={heldDirection === d.label}
              onPointerDown={e => { capture(e); move(d.label,d.x,d.y) }}
              onPointerUp={() => move('',0,0)} onPointerCancel={() => move('',0,0)} onLostPointerCapture={() => move('',0,0)}
              onKeyDown={e => { if(e.key === ' ' || e.key === 'Enter') {e.preventDefault();move(d.label,d.x,d.y)} }}
              onKeyUp={() => move('',0,0)} onBlur={() => move('',0,0)}><Arrow dir={d.label} /></button>)}
            <span className="dpad-center"><Pip /></span>
          </div>
          <button className="console-start" onClick={turnOnController} disabled={motionState === 'requesting'} aria-label="Turn on controller">
            {motionState === 'requesting' || snapshot.calibration === 'calibrating' ? <Busy /> : <Power />}
          </button>
          <div className="face-buttons">
            <div>
              {sport === 'boxing' ? (
                <button
                  className="face-a"
                  aria-label="A Hold to block"
                  aria-pressed={blocking}
                  onPointerDown={e => { capture(e); beginBlock() }}
                  onPointerUp={endBlock} onPointerCancel={endBlock} onLostPointerCapture={endBlock}
                  onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); beginBlock() } }}
                  onKeyUp={endBlock} onBlur={endBlock}
                >
                  <Shield />
                </button>
              ) : (
                <button
                  className="face-a"
                  aria-label="A Stop oscillation"
                  onClick={stopOscillation}
                >
                  <Stop />
                </button>
              )}
              <small>{sport === 'boxing' ? (blocking ? 'GUARD UP' : 'HOLD') : 'STOP'}</small>
            </div>
            <div>
              <button
                className="face-b"
                aria-label={sport === 'boxing' ? 'B Duck' : 'B Arm & Start Timer'}
                onClick={
                  sport === 'boxing'
                    ? duck
                    : () => {
                        if (attemptActive) cancelAttempt()
                        else startAttempt()
                      }
                }
              >
                {sport === 'boxing' ? <Duck /> : <Timer />}
              </button>
              <small>{sport === 'boxing' ? 'DUCK' : (attemptActive ? `${countdown}s` : 'ARM / TIMER')}</small>
            </div>
          </div>
        </div>
        <div className="console-grille">▰ ▰ ▰ ▰ ▰</div>
      </section>
      <p className="remote-feedback" role="status">
        {lastAction || (sport === 'boxing'
          ? 'Punch toward your opponent. Recalibrate if you change your grip.'
          : 'Tap ARM / TIMER (B) to arm and start countdown. Tap STOP (A) to stop oscillation. D-Pad shifts spin & aim.')}
      </p>
      <details className="remote-options"><summary>Controller settings</summary><button onClick={calibrate} disabled={motionState !== 'enabled'}>Recalibrate</button><button onClick={disconnect}>Disconnect</button><button onClick={() => selectPlayer(player === 1 ? 2 : 1)}>Use Controller {player === 1 ? 2 : 1} (testing)</button><a href={`/controller?player=${player}&debug=1${fakeMode ? '&fake=1' : ''}`}>Motion diagnostics</a></details>
      {fakeMode && <section className="remote-options"><p>Desktop test input</p>{(['jab','hook','swing'] as const).map(g => <button key={g} onClick={() => triggerSynthetic(g)} disabled={motionState !== 'enabled'}>{g}</button>)}</section>}
    </main>
  )

  return (
    <main className={`controller-page player-${player}`}>
      <header className="controller-header">
        <div>
          <div className="controller-eyebrow">PHONE CONTROLLER</div>
          <h1>Controller {player}</h1>
        </div>
        <div className={`connection-pill state-${connectionState}`}>
          <span className="status-dot" />
          {connectionLabel(connectionState)}
        </div>
      </header>

      <section className="controller-panel selector-panel" aria-label="Controller setup">
        <div className="field-group">
          <div className="field-label">Player</div>
          <div className="segmented two">
            {([1, 2] as Player[]).map((value) => (
              <button
                key={value}
                type="button"
                className={player === value ? 'selected' : ''}
                aria-pressed={player === value}
                onClick={() => selectPlayer(value)}
              >
                Controller {value}
              </button>
            ))}
          </div>
        </div>
        <div className="field-group">
          <div className="field-label">Sport</div>
          <strong>{sport} · set by the big screen</strong>
        </div>
        {sport === 'boxing' ? (
          <div className="field-group direction-group direction-locked">
            <div className="field-label">Motion direction</div>
            <strong>Mixed 3D</strong>
            <small>Boxing accepts punches in any outward direction.</small>
          </div>
        ) : (
          <div className="field-group direction-group">
            <div>
              <div className="field-label">Motion direction</div>
              <div className="field-help">
                Choose the motion to score. The return movement does not add power.
              </div>
            </div>
            <div className="segmented directions">
              {DIRECTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={directionMode === option.value ? 'selected' : ''}
                  aria-pressed={directionMode === option.value}
                  onClick={() => selectDirectionMode(option.value)}
                >
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="state-strip" aria-label="Controller states">
        <StateCard label="Connection" value={connectionLabel(connectionState)} active={connectionState === 'connected'} />
        <StateCard label="Motion" value={motionState} active={motionState === 'enabled'} />
        <StateCard label="Calibration" value={snapshot.calibration} active={snapshot.calibration === 'calibrated'} />
        <StateCard
          label="Aim"
          value={stickSnapshot.calibration === 'calibrated'
            ? `${stickSnapshot.vector[0].toFixed(2)}, ${stickSnapshot.vector[1].toFixed(2)}`
            : stickSnapshot.calibration}
          active={stickSnapshot.calibration === 'calibrated'}
        />
      </section>

      <section className="controller-actions" aria-label="Controller actions">
        <button
          type="button"
          className="action primary"
          onClick={enableMotion}
          disabled={motionState === 'requesting' || motionState === 'enabled'}
        >
          <span>1</span>{motionButtonLabel}
        </button>
        <button
          type="button"
          className="action connect"
          onClick={connect}
          disabled={connectDisabled}
        >
          <span>2</span>Connect
        </button>
        <button
          type="button"
          className="action calibrate"
          onClick={calibrate}
          disabled={motionState !== 'enabled' || snapshot.calibration === 'calibrating'}
        >
          <span>3</span>{snapshot.calibration === 'calibrating' ? 'Hold Still…' : 'Calibrate'}
        </button>
        <button
          type="button"
          className="action disconnect"
          onClick={disconnect}
          disabled={connectionState === 'disconnected'}
        >
          Disconnect
        </button>
      </section>

      <div className="controller-notice" aria-live="polite">
        <div>{snapshot.calibrationMessage}</div>
        <div className="notice-detail">{motionError || connectionDetail}</div>
        {snapshot.calibration === 'calibrating' && (
          <div className="calibration-track" aria-label={`${Math.round(snapshot.calibrationProgress * 100)}% calibrated`}>
            <div style={{ width: `${snapshot.calibrationProgress * 100}%` }} />
          </div>
        )}
      </div>

      <section className={`score-panel phase-${attemptPhase}`} aria-live="polite">
        <div className="field-label">
          {oneShotSport ? 'Attempt score' : 'Punch score'}
        </div>
        <div className="score-value">{scoreValue}</div>
        {lastGesture && !attemptActive && (
          <div className="score-direction">
            Direction
            <strong>{lastGesture.gesture.directionLabel}</strong>
            <small>{lastGesture.gesture.dominantAxis.toUpperCase()} axis</small>
          </div>
        )}
        <div className="score-message">{scoreMessage}</div>
        {oneShotSport && (
          <button
            type="button"
            className="start-attempt"
            onClick={startAttempt}
            disabled={!attemptReady}
          >
            {attemptPhase === 'result' ? 'Try Again' : 'Start Motion'}
          </button>
        )}
      </section>

      <section className={`quick-actions ${sport === 'boxing' ? 'boxing-actions' : 'placeholder-actions'}`}>
        {sport === 'boxing' ? (
          <>
            <button
              type="button"
              className={`simple-action ${blocking ? 'active' : ''}`}
              onPointerDown={e => { capture(e); beginBlock() }}
              onPointerUp={endBlock} onPointerCancel={endBlock} onLostPointerCapture={endBlock}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); beginBlock() } }}
              onKeyUp={endBlock} onBlur={endBlock}
            >
              {blocking ? 'Guard up (holding)' : 'Hold to block'}
            </button>
            <button type="button" className="simple-action" onClick={duck}>Duck</button>
          </>
        ) : (
          <>
            <button type="button" className="simple-action" onClick={stopOscillation}>Stop oscillation (A)</button>
            <button type="button" className="simple-action" onClick={startAttempt}>Arm & Start Timer (B)</button>
          </>
        )}
        {lastAction && <div className="action-status">{lastAction}</div>}
      </section>

      {debugMode && (
        <>
          <section className="telemetry-grid" aria-label="Live motion">
            <MotionCard
              title="Acceleration"
              unit="m/s²"
              magnitude={snapshot.accelerationMagnitude}
              vector={snapshot.acceleration}
              accent="cyan"
            />
            <MotionCard
              title="Rotation"
              unit="deg/s"
              magnitude={snapshot.rotationMagnitude}
              vector={snapshot.rotation}
              accent="violet"
            />
          </section>

          <section className="controller-panel diagnostics">
            <div className="diagnostics-title">
              <div>
                <div className="field-label">Detector</div>
                <strong>{snapshot.detector}</strong>
                <small className="source-mode">acceleration: {accelerationMode}</small>
              </div>
              <div className={`detector-orb detector-${snapshot.detector}`} aria-hidden="true" />
            </div>
            <div className="metric-grid">
              <Metric label="Sensor" value={metric(snapshot.sensorHz, ' Hz')} />
              <Metric label="RTT now" value={metric(rtt.now, ' ms')} />
              <Metric label="RTT median" value={metric(rtt.median, ' ms')} />
              <Metric label="RTT p95" value={metric(rtt.p95, ' ms')} />
            </div>
            <label className="telemetry-toggle">
              <span>
                <strong>Debug telemetry</strong>
                <small>Stream filtered motion packets; gestures always send when connected.</small>
              </span>
              <input
                type="checkbox"
                checked={telemetryEnabled}
                onChange={(event) => setTelemetry(event.currentTarget.checked)}
              />
              <span className="toggle-track" aria-hidden="true"><span /></span>
            </label>
          </section>
        </>
      )}

      {fakeMode && (
        <section className="controller-panel fake-panel">
          <div>
            <div className="field-label">Desktop synthetic input</div>
            <small>Enable motion and calibrate during the quiet lead-in. The big screen selects the sport automatically.</small>
          </div>
          <div className="fake-buttons">
            <button type="button" onClick={() => triggerSynthetic('jab')} disabled={motionState !== 'enabled'}>Jab</button>
            <button type="button" onClick={() => triggerSynthetic('hook')} disabled={motionState !== 'enabled'}>Hook</button>
            <button type="button" onClick={() => triggerSynthetic('swing')} disabled={motionState !== 'enabled'}>Swing</button>
          </div>
        </section>
      )}

      <footer className="controller-footer">
        <span>{controllerId(player)}</span>
        <a href="/">Back to lobby</a>
      </footer>

      {flash && (
        <div className={`gesture-flash ${flash.sent ? 'sent' : 'local'}`} role="status">
          <div className="gesture-name">{gestureLabel(flash.gesture.gesture)}</div>
          <div className="gesture-power">{flash.gesture.power}</div>
          <div className="gesture-power-label">POWER</div>
          <div className="gesture-delivery">
            {flash.sent ? `SENT TO CONTROLLER ${player}` : 'LOCAL ONLY · DISCONNECTED'}
          </div>
        </div>
      )}
    </main>
  )
}

function StateCard({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={`state-card ${active ? 'active' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function MotionCard({
  title,
  unit,
  magnitude,
  vector,
  accent,
}: {
  title: string
  unit: string
  magnitude: number
  vector: Vector3
  accent: 'cyan' | 'violet'
}) {
  return (
    <article className={`motion-card accent-${accent}`}>
      <div className="motion-card-title">
        <span>{title}</span>
        <small>{unit}</small>
      </div>
      <div className="motion-magnitude">{magnitude.toFixed(2)}</div>
      <div className="vector-row">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <div key={axis}><span>{axis}</span><strong>{vectorComponent(vector[index])}</strong></div>
        ))}
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
