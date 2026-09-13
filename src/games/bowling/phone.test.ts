import { describe, expect, it } from 'vitest'
import { applyAim, bowlingControllerState, controllerBowlingCommand, defaultAim, HOOK_STEP } from './keymap'

const stick = (x: number, y = 0, fresh = true) => ({ x, y, fresh })
const swing = (power: number) => ({
  kind: 'gesture' as const, controllerId: 'controller_1' as const, sport: 'bowling' as const, gesture: 'bowling_swing' as const,
  power, direction: [0, 1, 0] as const, peakAcceleration: 20, peakRotation: 300, duration: 200, eventId: `s${power}`,
})
const action = (a: 'block_start' | 'emergency_power' | 'placeholder_primary' | 'placeholder_secondary') => ({ kind: 'action' as const, controllerId: 'controller_1' as const, sport: 'bowling' as const, action: a, eventId: a })
const idle = { moveLane: 0 as const, aim: 0 as const, meterPress: false, meterDown: false, meterRelease: false, confirm: false, sheet: false }

describe('bowling on the phone', () => {
  it('adds one step of hook per flick of the pad and re-arms at centre', () => {
    let st = bowlingControllerState()
    let r = controllerBowlingCommand(stick(-1), [], st); expect(r.command.hook).toBe(-1)
    st = { hookArmed: r.hookArmed, armed: r.armed }
    r = controllerBowlingCommand(stick(-1), [], st); expect(r.command.hook).toBe(0) // held: no repeat
    st = { hookArmed: r.hookArmed, armed: r.armed }
    r = controllerBowlingCommand(stick(0), [], st); st = { hookArmed: r.hookArmed, armed: r.armed }
    r = controllerBowlingCommand(stick(1), [], st); expect(r.command.hook).toBe(1)
    // and that step is exactly what the keyboard's hook tap applies
    expect(applyAim(defaultAim(), { ...idle, hook: -1 }, 1 / 60).hook).toBeCloseTo(-HOOK_STEP, 5)
  })
  it('A locks the line, and a swing only rolls once B has armed the throw', () => {
    let st = bowlingControllerState()
    expect(controllerBowlingCommand(stick(0), [action('block_start')], st).command.lock).toBe(true)
    expect(controllerBowlingCommand(stick(0), [action('placeholder_primary')], st).command.lock).toBe(true)
    // and B on the phone arrives as placeholder_secondary
    expect(controllerBowlingCommand(stick(0), [action('placeholder_secondary')], st).armed).toBe(true)
    // swinging before B: the phone is just being moved about
    let r = controllerBowlingCommand(stick(0), [swing(80)], st)
    expect(r.command.swingPower).toBeNull()
    r = controllerBowlingCommand(stick(0), [action('emergency_power')], st)
    expect(r.command.arm).toBe(true); expect(r.armed).toBe(true)
    st = { hookArmed: r.hookArmed, armed: r.armed }
    r = controllerBowlingCommand(stick(0), [swing(80)], st)
    expect(r.command.swingPower).toBeCloseTo(0.8, 5)
    expect(r.armed).toBe(false) // one throw per arm
  })
  it('a phone that drops mid-arm is disarmed', () => {
    const r = controllerBowlingCommand(stick(0), [swing(80)], { hookArmed: true, armed: true }, false)
    expect(r.armed).toBe(false); expect(r.command.swingPower).toBeNull()
  })
})
