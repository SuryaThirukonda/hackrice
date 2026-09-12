import { describe, expect, it } from 'vitest'
import { KeyState } from '../../input/keys'
import { ACC_SWEEP_S, ACC_SWEET, GOLF_HELP, GOLF_KEYS, POWER_SWEEP_S, SwingMeter, golfInput } from './keymap'

/** Drive a KeyState through frames: each frame is a list of 'down:Code' / 'up:Code' strings applied before the input is read. */
function frames(script: string[][]): ReturnType<typeof golfInput>[] {
  const k = new KeyState()
  const out = []
  for (const f of script) {
    for (const ev of f) { const [t, code] = ev.split(':'); if (t === 'down') k.onDown(code); else k.onUp(code) }
    out.push(golfInput(k))
    k.endFrame()
  }
  return out
}

describe('golf keymap', () => {
  it('every binding produces exactly its field', () => {
    const one = (code: string) => frames([[`down:${code}`]])[0]
    expect(one('KeyW').club).toBe(1); expect(one('KeyS').club).toBe(-1)
    expect(one('KeyA').aim).toBe(-1); expect(one('ArrowLeft').aim).toBe(-1)
    expect(one('KeyD').aim).toBe(1); expect(one('ArrowRight').aim).toBe(1)
    expect(one('Space').swing).toBe(true)
    expect(one('Tab').view).toBe(true)
    expect(one('KeyZ')).toEqual({ club: 0, aim: 0, swing: false, view: false })
  })
  it('club, swing and view are press edges; aim stays while held', () => {
    const out = frames([['down:KeyW', 'down:Space', 'down:Tab', 'down:KeyD'], [], ['up:KeyW'], ['down:KeyW'], ['up:KeyD']])
    expect(out.map((c) => c.club)).toEqual([1, 0, 0, 1, 0])
    expect(out.map((c) => c.swing)).toEqual([true, false, false, false, false])
    expect(out.map((c) => c.view)).toEqual([true, false, false, false, false])
    expect(out.map((c) => c.aim)).toEqual([1, 1, 1, 1, 0])
  })
  it('opposite aim keys cancel; opposite club keys cancel', () => {
    const out = frames([['down:KeyA', 'down:KeyD'], ['up:KeyD'], ['down:KeyW', 'down:KeyS'], ['up:KeyA']])
    expect(out.map((c) => c.aim)).toEqual([0, -1, -1, 0])
    expect(out[2].club).toBe(0)
  })
  it('rebinding moves the action to the new key', () => {
    const k = new KeyState(); k.onDown('KeyF')
    expect(golfInput(k, { ...GOLF_KEYS, swing: ['KeyF'] }).swing).toBe(true)
    expect(golfInput(k).swing).toBe(false)
  })
  it('the help table covers every binding exactly once', () => {
    const actions = Object.keys(GOLF_KEYS).sort()
    expect(GOLF_HELP.map((h) => h.action).sort()).toEqual(actions)
    for (const h of GOLF_HELP) { expect(h.label.length).toBeGreaterThan(0); expect(h.hint.length).toBeGreaterThan(0) }
  })
})

describe('SwingMeter', () => {
  const run = (m: SwingMeter, seconds: number, step = 1 / 120) => { for (let t = 0; t < seconds - 1e-9; t += step) m.update(step) }

  it('three presses yield power then accuracy in order; a fourth press is ignored', () => {
    const m = new SwingMeter()
    expect(m.state).toBe('idle'); expect(m.result()).toBeNull()
    m.press(); expect(m.state).toBe('power')
    run(m, 0.4); m.press()
    expect(m.state).toBe('accuracy'); expect(m.power).toBeCloseTo(0.5, 1); expect(m.result()).toBeNull()
    run(m, 0.25); m.press()
    expect(m.state).toBe('done')
    const r = m.result()!
    expect(r.power).toBeCloseTo(0.5, 1); expect(r.accuracy).toBeCloseTo(0, 1)
    m.press(); run(m, 1)
    expect(m.state).toBe('done'); expect(m.result()).toEqual(r)
    m.reset(); expect(m.state).toBe('idle'); expect(m.result()).toBeNull(); expect(m.value).toBe(0)
  })
  it('power sweep is 1 at t = 0.8 s, 0 at 0 and 1.6 s, and stays within 0..1', () => {
    const m = new SwingMeter(); m.press()
    expect(m.value).toBe(0)
    run(m, 0.8); expect(m.value).toBeCloseTo(1, 5)
    run(m, 0.8); expect(m.value).toBeCloseTo(0, 5)
    expect(POWER_SWEEP_S).toBe(1.6)
    const m2 = new SwingMeter(); m2.press()
    for (let i = 0; i < 400; i++) { m2.update(0.0137); expect(m2.value).toBeGreaterThanOrEqual(0); expect(m2.value).toBeLessThanOrEqual(1) }
  })
  it('accuracy sweep goes -1 → 1 → -1 over 1.0 s and stays within -1..1', () => {
    const m = new SwingMeter(); m.press(); m.press()
    expect(m.value).toBe(-1)
    run(m, ACC_SWEEP_S / 2); expect(m.value).toBeCloseTo(1, 5)
    run(m, ACC_SWEEP_S / 2); expect(m.value).toBeCloseTo(-1, 5)
    for (let i = 0; i < 300; i++) { m.update(0.011); expect(Math.abs(m.value)).toBeLessThanOrEqual(1) }
  })
  it('a stop inside the green window is forgiven to a perfect shot; outside it keeps the raw value', () => {
    expect(ACC_SWEET).toBeGreaterThanOrEqual(0.05); expect(ACC_SWEET).toBeLessThanOrEqual(0.1)
    const inside = new SwingMeter(); inside.press(); inside.press()
    run(inside, ACC_SWEEP_S / 4 + (ACC_SWEET * 0.6) * ACC_SWEEP_S / 4) // value ≈ +0.6 * ACC_SWEET
    expect(Math.abs(inside.value)).toBeLessThan(ACC_SWEET); inside.press()
    expect(inside.result()!.accuracy).toBe(0)
    const outside = new SwingMeter(); outside.press(); outside.press()
    run(outside, ACC_SWEEP_S / 4 + 0.3 * ACC_SWEEP_S / 4) // value ≈ 0.3
    expect(outside.value).toBeCloseTo(0.3, 1); outside.press()
    expect(outside.result()!.accuracy).toBeCloseTo(0.3, 1)
  })
  it('does not advance while idle or done', () => {
    const m = new SwingMeter(); run(m, 1); expect(m.value).toBe(0)
    m.press(); m.press(); m.press(); const v = m.value; run(m, 1); expect(m.value).toBe(v)
  })
})
