import { describe, expect, it } from 'vitest'
import { controllerGolfCommand, golfControllerState, SwingMeter } from './keymap'

const stick = (x: number, y: number, fresh = true) => ({ x, y, fresh })
const swing = (power: number) => ({
  kind: 'gesture' as const, controllerId: 'controller_1' as const, sport: 'golf' as const, gesture: 'golf_swing' as const,
  power, direction: [0, 1, 0] as const, peakAcceleration: 20, peakRotation: 300, duration: 200, eventId: `s${power}`,
})
const action = (a: 'block_start' | 'emergency_power' | 'placeholder_primary') => ({ kind: 'action' as const, controllerId: 'controller_1' as const, sport: 'golf' as const, action: a, eventId: a })

describe('golf on the phone', () => {
  it('turns the aim while left or right is held, and stops when the pad is released', () => {
    expect(controllerGolfCommand(stick(-1, 0), [], golfControllerState()).command.aim).toBe(-1)
    expect(controllerGolfCommand(stick(1, 0), [], golfControllerState()).command.aim).toBe(1)
    expect(controllerGolfCommand(stick(0.3, 0), [], golfControllerState()).command.aim).toBe(0)
    expect(controllerGolfCommand(stick(1, 0, false), [], golfControllerState()).command.aim).toBe(0)
  })
  it('steps the club once per flick, longer on up, and re-arms at centre', () => {
    let st = golfControllerState()
    let r = controllerGolfCommand(stick(0, -1), [], st); expect(r.command.club).toBe(1)
    st = { clubArmed: r.clubArmed }
    r = controllerGolfCommand(stick(0, -1), [], st); expect(r.command.club).toBe(0) // held: no repeat
    st = { clubArmed: r.clubArmed }
    r = controllerGolfCommand(stick(0, 0), [], st); st = { clubArmed: r.clubArmed }
    r = controllerGolfCommand(stick(0, 1), [], st); expect(r.command.club).toBe(-1)
  })
  it('A arms, B cancels, and a swing carries its power on a 0..1 scale', () => {
    const st = golfControllerState()
    expect(controllerGolfCommand(stick(0, 0), [action('block_start')], st).command.arm).toBe(true)
    // the phone's own A outside boxing sends this one, before its countdown and capture window
    expect(controllerGolfCommand(stick(0, 0), [action('placeholder_primary')], st).command.arm).toBe(true)
    expect(controllerGolfCommand(stick(0, 0), [action('emergency_power')], st).command.cancel).toBe(true)
    expect(controllerGolfCommand(stick(0, 0), [swing(70)], st).command.swingPower).toBeCloseTo(0.7, 5)
    expect(controllerGolfCommand(stick(0, 0), [], st).command.swingPower).toBeNull()
  })
  it('the meter only takes a swing once armed, and a swing is always a straight shot', () => {
    const m = new SwingMeter()
    expect(m.fromSwing(0.8)).toBe(false) // not armed: the swing is ignored
    m.arm(); expect(m.state).toBe('armed')
    m.cancel(); expect(m.state).toBe('idle')
    m.arm(); expect(m.fromSwing(0.8)).toBe(true)
    expect(m.result()).toEqual({ power: 0.8, accuracy: 0 })
    m.reset(); m.arm(); m.press(); expect(m.state).toBe('power') // the keyboard can still take over an armed meter
  })
})
