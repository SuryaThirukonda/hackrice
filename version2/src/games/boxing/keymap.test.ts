import { describe, expect, it } from 'vitest'
import { KeyState } from '../../input/keys'
import { ControllerInput } from '../../input/controller'
import { BOXING_HELP, BOXING_KEYS, boxingCommand, controllerBoxingCommand, heldOnly } from './keymap'

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

  it('maps normalized phone movement, block, and generic punch without replacing keyboard fallback', () => {
    const input = new ControllerInput()
    input.ingest({ type: 'stick', controllerId: 'controller_1', stick: [-1, -1] }, 100)
    input.ingest({ type: 'action', controllerId: 'controller_1', sport: 'boxing', action: 'block_start', eventId: 'block' })
    input.ingest({ type: 'gesture', controllerId: 'controller_1', sport: 'boxing', gesture: 'punch', eventId: 'punch', power: 72, peakRotation: 320, direction: [0, 1, 0] })
    const remote = controllerBoxingCommand(input.stick('controller_1', 120), input.drain('controller_1', 'boxing'), { blocking: false })
    expect(remote.blocking).toBe(true)
    expect(remote.command).toMatchObject({ strafe: -1, forward: 1, block: true, punch: 'cross', punchPower: 0.72 })

    const stale = controllerBoxingCommand(input.stick('controller_1', 351), [], remote)
    expect(stale.blocking).toBe(false)
    expect(stale.command).toMatchObject({ strafe: 0, forward: 0, block: false, punch: null })
  })
})
