import { describe, expect, it } from 'vitest'
import { CONTROLLER_CONFIG } from '../src/phone/config'
import { MotionProcessor, type DetectedGesture, type Vector3 } from '../src/phone/motionProcessor'
import type { Sample } from '../src/phone/sample'
import { ControllerInput } from '../src/input/controller'
import { boxingControllerState, controllerBoxingCommand } from '../src/games/boxing/keymap'
import { BoxingMatch } from '../src/games/boxing/sim/match'
import type { SimEvent } from '../src/games/boxing/sim/types'

/**
 * The whole phone path, end to end, with no stubs between the accelerometer and the punch:
 *
 *   accelerometer samples → MotionProcessor → wire packet → ControllerInput
 *     → controllerBoxingCommand → BoxingMatch → a punch event with damage
 *
 * Every existing test covers one link of that chain. This one asks the question a player asks: swing
 * the phone, does anything happen in the fight, and does swinging harder hurt more.
 */
const DT = 1000 / 60

/** A DeviceMotion reading in the flat tuple the phone streams. Gravity rides on the second triple. */
const sample = (t: number, a: Vector3 = [0, 0, 0], r: Vector3 = [0, 0, 0]): Sample =>
  [t, a[0], a[1], a[2], a[0], a[1] + 9.81, a[2], r[0], r[1], r[2], 0, 90, 0]

/** A phone that has been held still and calibrated, as the controller page requires before play. */
function calibratedPhone(): { processor: MotionProcessor; swings: DetectedGesture[]; t: number } {
  const processor = new MotionProcessor('boxing')
  const swings: DetectedGesture[] = []
  processor.setGestureHandler((g) => swings.push(g))
  processor.startCalibration()
  let t = 0
  while (t <= CONTROLLER_CONFIG.calibration.durationMs + DT) { processor.push(sample(t)); t += DT }
  expect(processor.getSnapshot().calibration).toBe('calibrated')
  return { processor, swings, t: t + DT }
}

/**
 * One arm extension: a rise to `peak` m/s² over about 80 ms and a decay, with the wrist rotation a
 * real punch carries. `spin` is the peak rotation, which is what separates a jab from a cross.
 */
function swing(processor: MotionProcessor, start: number, peak: number, spin: number): number {
  const profile = [0, 0.15, 0.42, 0.72, 1, 0.84, 0.5, 0.22, 0.08]
  let t = start
  for (const [i, k] of profile.entries()) {
    processor.push(sample(t, [0, 0, -peak * k], [0, 0, i >= 2 && i <= 6 ? spin : spin * 0.08]))
    t += DT
  }
  for (let i = 0; i < 24; i++) { processor.push(sample(t)); t += DT }
  return t
}

/** The packet the phone puts on the wire for a detected gesture. */
const wire = (gesture: DetectedGesture, seq: number): Record<string, unknown> => ({
  v: 1, type: 'gesture', controllerId: 'controller_1', sport: 'boxing', seq,
  eventId: `swing-${seq}`, gesture: gesture.gesture, power: gesture.power,
  direction: gesture.direction, peakAcceleration: gesture.peakAcceleration,
  peakRotation: gesture.peakRotation, duration: gesture.duration,
})

type PunchEvent = Extract<SimEvent, { kind: 'punch' }>

/** Feed one detected swing into a fresh match and run it until the punch resolves. */
function throwAt(gesture: DetectedGesture, hp = 100): { events: SimEvent[]; landed: PunchEvent | undefined } {
  const input = new ControllerInput()
  input.setSport('boxing')
  input.ingest({ type: 'controller_status', controllerId: 'controller_1', connected: true })
  input.ingest(wire(gesture, 1))

  const match = new BoxingMatch({ seed: 7, botA: null, botB: null })
  match.b.hp = hp
  // Skip the opening countdown so the command is accepted the moment it is issued.
  while (match.phase !== 'fighting') match.step(null, null)
  // Close to inside reach; the fighters start further apart than a jab can cover.
  match.a.pos.z = match.b.pos.z - 0.9

  const events: SimEvent[] = []
  const command = controllerBoxingCommand(input.stick('controller_1'), input.drain('controller_1', 'boxing'), boxingControllerState()).command
  match.step(command, null)
  events.push(...match.events)
  for (let tick = 0; tick < 90; tick++) {
    match.step(null, null)
    events.push(...match.events)
  }
  return { events, landed: events.find((e): e is PunchEvent => e.kind === 'punch') }
}

describe('a phone swing becomes a punch', () => {
  it('turns a hard arm extension into a punch the fighter actually throws', () => {
    const phone = calibratedPhone()
    swing(phone.processor, phone.t, 18, 90)
    expect(phone.swings).toHaveLength(1)
    expect(phone.swings[0].gesture).toBe('punch')

    const { landed } = throwAt(phone.swings[0])
    expect(landed).toBeDefined()
    expect(landed?.who).toBe('a')
    expect(landed?.dmg).toBeGreaterThan(0)
  })

  it('sends a wrist-turned swing as the heavier cross, and a straight one as a jab', () => {
    const jab = calibratedPhone()
    swing(jab.processor, jab.t, 18, 60)
    const cross = calibratedPhone()
    swing(cross.processor, cross.t, 18, 340)

    expect(jab.swings[0].peakRotation).toBeLessThan(200)
    expect(cross.swings[0].peakRotation).toBeGreaterThanOrEqual(200)
    expect(throwAt(jab.swings[0]).landed?.punch).toBe('jab')
    expect(throwAt(cross.swings[0]).landed?.punch).toBe('cross')
  })

  it('makes a faster swing hurt more, all the way from the accelerometer', () => {
    const soft = calibratedPhone()
    swing(soft.processor, soft.t, 6, 90)
    const hard = calibratedPhone()
    swing(hard.processor, hard.t, 19, 90)

    // Both cross the detector's trigger, so both are real punches, not a fired/not-fired comparison.
    expect(soft.swings).toHaveLength(1)
    expect(hard.swings).toHaveLength(1)
    expect(hard.swings[0].power).toBeGreaterThan(soft.swings[0].power)

    const softHit = throwAt(soft.swings[0]).landed
    const hardHit = throwAt(hard.swings[0]).landed
    expect(softHit?.punch).toBe(hardHit?.punch) // same punch, so only swing speed can explain the gap
    expect(hardHit!.dmg).toBeGreaterThan(softHit!.dmg)
  })

  it('ignores a phone that is only being carried around', () => {
    const phone = calibratedPhone()
    let t = phone.t
    // Walking-pace hand movement: well under the 3.8 m/s² trigger.
    for (let i = 0; i < 600; i++) {
      phone.processor.push(sample(t, [0.9 * Math.sin(i * 0.21), 0.5 * Math.cos(i * 0.13), 1.2 * Math.sin(i * 0.09)], [12 * Math.sin(i * 0.17), 8, 5]))
      t += DT
    }
    expect(phone.swings).toEqual([])
  })

  it('never lets a swing meant for another sport punch someone', () => {
    const phone = calibratedPhone()
    swing(phone.processor, phone.t, 18, 90)
    const input = new ControllerInput()
    // The relay stamps each packet with the sport that was live when it was sent, so a swing thrown
    // on the golf course arrives stamped golf and must not be waiting in the queue at the next bell.
    input.ingest({ ...wire(phone.swings[0], 1), sport: 'golf', gesture: 'golf_swing' })
    expect(controllerBoxingCommand(input.stick('controller_1'), input.drain('controller_1', 'boxing'), boxingControllerState()).command.punch).toBeNull()
    // Draining for boxing left it alone rather than discarding it, so golf still receives it.
    expect(input.drain('controller_1', 'golf')).toHaveLength(1)
  })
})
