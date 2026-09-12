import { describe, expect, it } from 'vitest'
import { KeyState } from '../../input/keys'
import { BOXING_HELP, BOXING_KEYS, boxingCommand, boxingControllerState, controllerBoxingCommand, heldOnly } from './keymap'

/** Drive a KeyState through frames: each frame is a list of 'down:Code' / 'up:Code' strings applied before the command is built. */
function frames(script: string[][]): ReturnType<typeof boxingCommand>[] {
  const k = new KeyState()
  const out = []
  for (const f of script) {
    for (const ev of f) { const [t, code] = ev.split(':'); if (t === 'down') k.onDown(code); else k.onUp(code) }
    out.push(boxingCommand(k))
    k.endFrame()
  }
  return out
}

describe('KeyState', () => {
  it('tracks held keys and press edges per frame', () => {
    const k = new KeyState()
    k.onDown('KeyJ')
    expect(k.isDown('KeyJ')).toBe(true); expect(k.justPressed('KeyJ')).toBe(true)
    k.endFrame()
    expect(k.isDown('KeyJ')).toBe(true); expect(k.justPressed('KeyJ')).toBe(false)
    k.onDown('KeyJ') // repeat while held: no new edge
    expect(k.justPressed('KeyJ')).toBe(false)
    k.onUp('KeyJ'); k.onDown('KeyJ')
    expect(k.justPressed('KeyJ')).toBe(true)
    k.clear(); expect(k.isDown('KeyJ')).toBe(false)
  })
})

describe('boxing keymap', () => {
  it('every binding produces exactly its action', () => {
    const one = (code: string) => frames([[`down:${code}`]])[0]
    expect(one('KeyJ').punch).toBe('jab'); expect(one('KeyK').punch).toBe('cross')
    expect(one('Space').block).toBe(true); expect(one('KeyS').block).toBe(true)
    expect(one('KeyA').strafe).toBe(-1); expect(one('ArrowLeft').strafe).toBe(-1)
    expect(one('KeyD').strafe).toBe(1); expect(one('ArrowRight').strafe).toBe(1)
    expect(one('KeyQ').dodge).toBe('swayL'); expect(one('KeyE').dodge).toBe('swayR'); expect(one('KeyW').dodge).toBe('duck')
    expect(one('ArrowUp').forward).toBe(1); expect(one('ArrowDown').forward).toBe(-1)
    const idle = one('KeyZ')
    expect(idle).toEqual({ punch: null, dodge: null, block: false, forward: 0, strafe: 0 })
  })
  it('punch and dodge keys fire once per press even when held; block stays true while held', () => {
    const out = frames([['down:KeyJ', 'down:Space'], [], [], ['up:KeyJ'], ['down:KeyJ'], ['up:Space']])
    expect(out.map((c) => c.punch)).toEqual(['jab', null, null, null, 'jab', null])
    expect(out.map((c) => c.block)).toEqual([true, true, true, true, true, false])
    const d = frames([['down:KeyQ'], [], ['up:KeyQ', 'down:KeyQ']])
    expect(d.map((c) => c.dodge)).toEqual(['swayL', null, 'swayL'])
  })
  it('opposite movement keys cancel; jab wins over cross when both are pressed in one frame', () => {
    const out = frames([['down:KeyA', 'down:KeyD'], ['up:KeyD'], ['down:ArrowUp', 'down:ArrowDown'], ['up:ArrowDown']])
    expect(out.map((c) => c.strafe)).toEqual([0, -1, -1, -1])
    expect(out.map((c) => c.forward)).toEqual([0, 0, 0, 1])
    expect(frames([['down:KeyJ', 'down:KeyK']])[0].punch).toBe('jab')
  })
  it('heldOnly strips one-shot actions for extra sim steps in the same frame', () => {
    const c = frames([['down:KeyK', 'down:KeyW', 'down:Space', 'down:KeyD']])[0]
    expect(heldOnly(c)).toEqual({ punch: null, dodge: null, block: true, forward: 0, strafe: 1 })
  })
  it('rebinding moves the action to the new key', () => {
    const k = new KeyState(); k.onDown('KeyF')
    const custom = { ...BOXING_KEYS, jab: ['KeyF'] }
    expect(boxingCommand(k, custom).punch).toBe('jab')
    expect(boxingCommand(k).punch).toBeNull()
  })
  it('the help table covers every binding exactly once', () => {
    const actions = Object.keys(BOXING_KEYS).sort()
    expect(BOXING_HELP.map((h) => h.action).sort()).toEqual(actions)
    for (const h of BOXING_HELP) { expect(h.label.length).toBeGreaterThan(0); expect(h.hint.length).toBeGreaterThan(0) }
  })
})

describe('phone controller mapping', () => {
  const stick = (x: number, y: number, fresh = true) => ({ x, y, fresh })
  const punch = (power: number, peakRotation: number) => ({
    kind: 'gesture' as const, controllerId: 'controller_1' as const, sport: 'boxing' as const,
    gesture: 'punch' as const, power, direction: [0, 0, -1] as const, peakAcceleration: 30,
    peakRotation, duration: 120, eventId: `p${power}_${peakRotation}`,
  })
  const action = (a: 'block_start' | 'block_end' | 'emergency_power') => ({
    kind: 'action' as const, controllerId: 'controller_1' as const, sport: 'boxing' as const, action: a, eventId: a,
  })

  it('A holds the guard and releases it', () => {
    let st = boxingControllerState()
    let r = controllerBoxingCommand(stick(0, 0), [action('block_start')], st)
    expect(r.command.block).toBe(true)
    st = { blocking: r.blocking, slipArmed: r.slipArmed }
    // the latch survives a frame with no events
    r = controllerBoxingCommand(stick(0, 0), [], st)
    expect(r.command.block).toBe(true)
    st = { blocking: r.blocking, slipArmed: r.slipArmed }
    r = controllerBoxingCommand(stick(0, 0), [action('block_end')], st)
    expect(r.command.block).toBe(false)
  })

  it('B ducks', () => {
    const r = controllerBoxingCommand(stick(0, 0), [action('emergency_power')], boxingControllerState())
    expect(r.command.dodge).toBe('duck')
  })

  it('the D-pad slips left and right, once per flick', () => {
    let st = boxingControllerState()
    let r = controllerBoxingCommand(stick(-1, 0), [], st)
    expect(r.command.dodge).toBe('swayL')
    // held: must NOT re-fire, or it would sit on the sim dodge cooldown forever
    st = { blocking: r.blocking, slipArmed: r.slipArmed }
    r = controllerBoxingCommand(stick(-1, 0), [], st)
    expect(r.command.dodge).toBe(null)
    // back to centre re-arms, then the other way slips right
    st = { blocking: r.blocking, slipArmed: r.slipArmed }
    r = controllerBoxingCommand(stick(0, 0), [], st)
    st = { blocking: r.blocking, slipArmed: r.slipArmed }
    r = controllerBoxingCommand(stick(1, 0), [], st)
    expect(r.command.dodge).toBe('swayR')
  })

  it('the D-pad steps in and out, with up as forward', () => {
    expect(controllerBoxingCommand(stick(0, -1), [], boxingControllerState()).command.forward).toBe(1)
    expect(controllerBoxingCommand(stick(0, 1), [], boxingControllerState()).command.forward).toBe(-1)
    expect(controllerBoxingCommand(stick(0, 0.2), [], boxingControllerState()).command.forward).toBe(0)
  })

  it('a harder swing carries more punch power, and rotation picks the cross', () => {
    const soft = controllerBoxingCommand(stick(0, 0), [punch(30, 50)], boxingControllerState()).command
    const hard = controllerBoxingCommand(stick(0, 0), [punch(95, 320)], boxingControllerState()).command
    expect(soft.punch).toBe('jab'); expect(soft.punchPower).toBeCloseTo(0.3, 5)
    expect(hard.punch).toBe('cross'); expect(hard.punchPower).toBeCloseTo(0.95, 5)
    expect(hard.punchPower!).toBeGreaterThan(soft.punchPower!)
  })

  it('the guard survives an idle D-pad but drops when the phone disconnects', () => {
    // idle stick, still connected: the guard stays up
    const held = controllerBoxingCommand(stick(0, 0, false), [], { blocking: true, slipArmed: true }, true)
    expect(held.command.block).toBe(true)
    // phone gone: the guard must not stay stuck on
    const gone = controllerBoxingCommand(stick(0, 0, false), [], { blocking: true, slipArmed: true }, false)
    expect(gone.command.block).toBe(false)
    expect(gone.blocking).toBe(false)
  })
})
