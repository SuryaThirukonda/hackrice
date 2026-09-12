import { describe, expect, it } from 'vitest'
import { KeyState } from '../../input/keys'
import { applyAim, BOWLING_HELP, BOWLING_KEYS, bowlingInput, defaultAim, METER_PERIOD_MS, MeterTracker, meterValue, type BowlingInput } from './keymap'

/** Drive a KeyState through frames: each frame is a list of 'down:Code' / 'up:Code' strings applied before the input is built. */
function frames(script: string[][], bindings = BOWLING_KEYS): BowlingInput[] {
  const k = new KeyState(), meter = new MeterTracker()
  const out: BowlingInput[] = []
  for (const f of script) {
    for (const ev of f) { const [t, code] = ev.split(':'); if (t === 'down') k.onDown(code); else k.onUp(code) }
    out.push(bowlingInput(k, bindings, meter))
    k.endFrame()
  }
  return out
}
const IDLE: BowlingInput = { moveLane: 0, aim: 0, hook: 0, meterPress: false, meterDown: false, meterRelease: false, confirm: false }

describe('bowling keymap', () => {
  it('every binding produces exactly its field', () => {
    const one = (code: string) => frames([[`down:${code}`]])[0]
    expect(one('KeyA')).toEqual({ ...IDLE, moveLane: -1 }); expect(one('KeyD')).toEqual({ ...IDLE, moveLane: 1 })
    expect(one('KeyQ')).toEqual({ ...IDLE, aim: -1 }); expect(one('KeyE')).toEqual({ ...IDLE, aim: 1 })
    expect(one('ArrowLeft')).toEqual({ ...IDLE, hook: -1 }); expect(one('ArrowRight')).toEqual({ ...IDLE, hook: 1 })
    expect(one('Space')).toEqual({ ...IDLE, meterPress: true, meterDown: true })
    expect(one('Enter')).toEqual({ ...IDLE, confirm: true })
    expect(one('KeyZ')).toEqual(IDLE)
  })
  it('held axes stay on while held; hook and confirm fire once per press', () => {
    const out = frames([['down:KeyA', 'down:ArrowLeft', 'down:Enter'], [], ['up:KeyA', 'up:ArrowLeft', 'up:Enter'], ['down:ArrowLeft'], []])
    expect(out.map((c) => c.moveLane)).toEqual([-1, -1, 0, 0, 0])
    expect(out.map((c) => c.hook)).toEqual([-1, 0, 0, -1, 0])
    expect(out.map((c) => c.confirm)).toEqual([true, false, false, false, false])
  })
  it('the meter release edge fires exactly once, on the frame Space goes up', () => {
    const out = frames([['down:Space'], [], [], ['up:Space'], [], ['down:Space'], ['up:Space', 'down:Space'], ['up:Space']])
    expect(out.map((c) => c.meterDown)).toEqual([true, true, true, false, false, true, true, false])
    expect(out.map((c) => c.meterRelease)).toEqual([false, false, false, true, false, false, false, true])
    expect(frames([['up:Space']])[0].meterRelease).toBe(false) // never held: no edge
  })
  it('opposite keys cancel', () => {
    const out = frames([['down:KeyA', 'down:KeyD'], ['up:KeyD'], ['down:KeyQ', 'down:KeyE'], ['up:KeyQ'], ['down:ArrowLeft', 'down:ArrowRight']])
    expect(out.map((c) => c.moveLane)).toEqual([0, -1, -1, -1, -1])
    expect(out.map((c) => c.aim)).toEqual([0, 0, 0, 1, 1])
    expect(out[4].hook).toBe(0)
  })
  it('rebinding moves the action to the new key', () => {
    const custom = { ...BOWLING_KEYS, roll: ['KeyF'], hookL: ['KeyZ'] }
    const c = frames([['down:KeyF', 'down:KeyZ']], custom)[0]
    expect(c.meterDown).toBe(true); expect(c.hook).toBe(-1)
    expect(frames([['down:KeyF', 'down:KeyZ']])[0]).toEqual(IDLE)
  })
  it('the help table covers every binding exactly once', () => {
    const actions = Object.keys(BOWLING_KEYS).sort()
    expect(BOWLING_HELP.map((h) => h.action).sort()).toEqual(actions)
    for (const h of BOWLING_HELP) { expect(h.label.length).toBeGreaterThan(0); expect(h.hint.length).toBeGreaterThan(0) }
  })
})

describe('meterValue', () => {
  it('ping-pongs 0 → 1 → 0 once per period', () => {
    expect(meterValue(0)).toBe(0)
    expect(meterValue(METER_PERIOD_MS / 2)).toBeCloseTo(1, 9)
    expect(meterValue(METER_PERIOD_MS)).toBeCloseTo(0, 9)
    expect(meterValue(METER_PERIOD_MS / 4)).toBeCloseTo(0.5, 9)
    expect(meterValue(METER_PERIOD_MS * 0.75)).toBeCloseTo(0.5, 9)
    expect(METER_PERIOD_MS).toBeCloseTo(1000 / 1.2, 6)
  })
  it('always stays within [0, 1], including negative and very large times', () => {
    for (let t = -3000; t <= 30_000; t += 7.3) { const v = meterValue(t); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
})

describe('applyAim', () => {
  const inp = (o: Partial<BowlingInput>): BowlingInput => ({ ...IDLE, ...o })
  it('moves the lane position at 0.5 m/s and clamps at ±0.45', () => {
    let s = defaultAim()
    s = applyAim(s, inp({ moveLane: 1 }), 0.5)
    expect(s.lanePos).toBeCloseTo(0.25, 9)
    s = applyAim(s, inp({ moveLane: 1 }), 5)
    expect(s.lanePos).toBe(0.45)
    s = applyAim(s, inp({ moveLane: -1 }), 5)
    expect(s.lanePos).toBe(-0.45)
  })
  it('turns the angle at 4°/s and clamps at ±4°', () => {
    let s = applyAim(defaultAim(), inp({ aim: 1 }), 0.25)
    expect(s.angleDeg).toBeCloseTo(1, 9)
    s = applyAim(s, inp({ aim: 1 }), 3)
    expect(s.angleDeg).toBe(4)
    s = applyAim(s, inp({ aim: -1 }), 3)
    expect(s.angleDeg).toBe(-4)
  })
  it('steps the hook by 0.2 per tap and clamps at ±1', () => {
    let s = defaultAim()
    for (let i = 0; i < 3; i++) s = applyAim(s, inp({ hook: 1 }), 1 / 60)
    expect(s.hook).toBeCloseTo(0.6, 9)
    for (let i = 0; i < 5; i++) s = applyAim(s, inp({ hook: 1 }), 1 / 60)
    expect(s.hook).toBe(1)
    for (let i = 0; i < 12; i++) s = applyAim(s, inp({ hook: -1 }), 1 / 60)
    expect(s.hook).toBe(-1)
  })
  it('is pure and leaves idle state untouched', () => {
    const s = { lanePos: 0.1, angleDeg: -2, hook: 0.4 }
    const n = applyAim(s, IDLE, 1)
    expect(n).toEqual(s); expect(n).not.toBe(s)
  })
})
