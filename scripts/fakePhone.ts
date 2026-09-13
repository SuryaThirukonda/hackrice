/**
 * A phone, without the phone.
 *
 * Runs the real `MotionProcessor` over synthesised accelerometer traces and puts the resulting
 * packets on the real relay socket, so the motion lab, the connect screen and a live match can all be
 * exercised from a laptop. Nothing here is a stub of the detector: the same code that runs on the
 * handset decides whether a swing counts and how hard it was.
 *
 *   npm run fake-phone -- --slot 2 --sport golf --peak 22 --every 2500
 */
import { WebSocket } from 'ws'
import { CONTROLLER_CONFIG, type Sport } from '../src/phone/config'
import { MotionProcessor, type DetectedGesture, type Vector3 } from '../src/phone/motionProcessor'
import type { Sample } from '../src/phone/sample'
import { ActivityTracker } from '../src/health/activity'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const slot = arg('slot', '1') === '2' ? 'controller_2' : 'controller_1'
const sport = arg('sport', 'boxing') as Sport
const peak = Number(arg('peak', '16'))
const every = Number(arg('every', '2200'))
const url = arg('url', 'ws://127.0.0.1:8790/controller-ws')

const DT = 1000 / 60
const sample = (t: number, a: Vector3 = [0, 0, 0], r: Vector3 = [0, 0, 0]): Sample =>
  [t, a[0], a[1], a[2], a[0], a[1] + 9.81, a[2], r[0], r[1], r[2], 0, 90, 0]

const processor = new MotionProcessor(sport)
const activity = new ActivityTracker()
const socket = new WebSocket(url)
let seq = 0
let clock = 0
let events = 0
const next = (): number => (seq += 1)
const send = (packet: Record<string, unknown>): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, controllerId: slot, ...packet }))
}
const metrics = (): Record<string, number> => ({ sensorHz: 60, rttNow: 12, rttMedian: 12, rttP95: 18 })

processor.setGestureHandler((gesture: DetectedGesture) => {
  events += 1
  activity.noteSwing(gesture.t, gesture.duration)
  send({
    type: 'gesture', seq: next(), eventId: `fake-${events}`, t: gesture.t, gesture: gesture.gesture,
    power: gesture.power, direction: gesture.direction, axis: gesture.dominantAxis,
    directionLabel: gesture.directionLabel, peakAcceleration: gesture.peakAcceleration,
    peakRotation: gesture.peakRotation, duration: gesture.duration, sport, metrics: metrics(),
  })
  process.stdout.write(`swing ${events}: power ${gesture.power}  peak ${gesture.peakAcceleration.toFixed(1)} m/s²  rot ${gesture.peakRotation.toFixed(0)} deg/s\n`)
})

/** Push one reading through the detector and mirror it onto the wire, as the phone does. */
const push = (a: Vector3, r: Vector3): void => {
  const motion = processor.push(sample(clock, a, r))
  activity.push(motion.t, motion.accelerationMagnitude, motion.rotationMagnitude, motion.intervalMs)
  send({ type: 'motion', seq: next(), t: clock, a: motion.acceleration, r: motion.rotation, interval: DT, sport, metrics: metrics() })
  clock += DT
}

socket.on('open', () => {
  send({ type: 'hello', seq: next() })
  processor.startCalibration()
  // Calibration needs the phone held still, exactly as a player is asked to do.
  const until = CONTROLLER_CONFIG.calibration.durationMs + DT
  while (clock <= until) push([0, 0, 0], [0, 0, 0])
  process.stdout.write(`fake phone on ${slot}, sport ${sport}, calibrated. Swinging every ${every} ms at peak ${peak} m/s².\n`)

  let idle = 0
  setInterval(() => {
    // Hand tremor between swings: real, and deliberately well under the trigger.
    idle += 1
    push([0.5 * Math.sin(idle * 0.22), 0.3 * Math.cos(idle * 0.15), 0.4 * Math.sin(idle * 0.1)], [6 * Math.sin(idle * 0.19), 4, 3])
  }, DT)

  // the health record: one-second movement summaries every five seconds, as the handset sends them
  setInterval(() => { const { epochs, roms } = activity.drain(); if (epochs.length || roms.length) send({ type: 'activity', seq: next(), epochs, roms }) }, 5000)

  let round = 0
  setInterval(() => {
    round += 1
    // Alternate a straight arm extension with a wrist-turned one, so jabs and crosses both appear.
    const spin = round % 2 === 0 ? 340 : 70
    const strength = peak * (0.6 + 0.4 * ((round % 3) / 2))
    for (const [i, k] of [0, 0.15, 0.42, 0.72, 1, 0.84, 0.5, 0.22, 0.08].entries()) {
      push([0, 0, -strength * k], [0, 0, i >= 2 && i <= 6 ? spin : spin * 0.08])
    }
    send({ type: 'stick', seq: next(), t: clock, stick: [round % 4 === 0 ? -1 : 0, 0], calibrated: true, sport, metrics: metrics() })
    // A is a hold on the phone: guard up on press, guard down on release about 700 ms later.
    if (round % 3 === 0) {
      send({ type: 'action', seq: next(), eventId: `fake-a-${round}-down`, action: 'block_start', sport })
      setTimeout(() => send({ type: 'action', seq: next(), eventId: `fake-a-${round}-up`, action: 'block_end', sport }), 700)
    }
    if (round % 3 === 1) send({ type: 'action', seq: next(), eventId: `fake-b-${round}`, action: 'emergency_power', sport })
  }, every)
})

socket.on('message', (raw) => {
  const packet = JSON.parse(String(raw)) as { type?: string; ok?: boolean; code?: string }
  if (packet.type === 'error') { console.error(`relay refused this phone: ${packet.code}`); process.exit(1) }
  if (packet.type === 'hello' && packet.ok) process.stdout.write('relay accepted the claim\n')
})
socket.on('error', (error) => { console.error(`cannot reach the relay at ${url}: ${error.message}`); process.exit(1) })
socket.on('close', () => { process.stdout.write('relay closed the socket\n'); process.exit(0) })
