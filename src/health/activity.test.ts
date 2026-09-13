import { describe, expect, it } from 'vitest'
import { ActivityTracker } from './activity'

const DT = 1000 / 60

describe('ActivityTracker', () => {
  it('folds samples into one-second epochs with mean, peak and integrated rotation', () => {
    const tr = new ActivityTracker()
    let t = 5000
    for (let i = 0; i < 60; i++) { tr.push(t, 2, 90, DT); t += DT } // one second at 2 m/s², 90 deg/s
    for (let i = 0; i < 30; i++) { tr.push(t, 6, 0, DT); t += DT } // half a second, still in progress
    const { epochs } = tr.drain()
    expect(epochs).toHaveLength(1)
    expect(epochs[0].t).toBe(0)
    expect(epochs[0].mean).toBeCloseTo(2, 6)
    expect(epochs[0].peak).toBeCloseTo(2, 6)
    expect(epochs[0].rotation).toBeCloseTo(90, 0) // 90 deg/s for a second
    expect(tr.flush().epochs).toHaveLength(1) // the half second closes at the end of a session
  })
  it('measures a swing as the rotation over its own window, not the whole second', () => {
    const tr = new ActivityTracker()
    let t = 0
    for (let i = 0; i < 60; i++) { tr.push(t, 0.1, 10, DT); t += DT } // a slow second: 10 deg total
    for (let i = 0; i < 12; i++) { tr.push(t, 15, 600, DT); t += DT } // 200 ms swing at 600 deg/s: 120 deg
    const deg = tr.noteSwing(t, 200)
    expect(deg).toBeGreaterThan(100); expect(deg).toBeLessThan(130)
    const { roms, epochs } = tr.flush()
    expect(roms).toEqual([deg])
    expect(epochs.at(-1)?.swings).toBe(1)
  })
  it('ignores garbage samples and clamps the interval, so a stalled tab cannot inflate rotation', () => {
    const tr = new ActivityTracker()
    tr.push(0, Number.NaN, Number.POSITIVE_INFINITY, 5000)
    tr.push(1000, 1, 100, 5000) // claims five seconds passed; counted as at most 100 ms
    const { epochs } = tr.flush()
    expect(epochs[0].mean).toBe(0)
    expect(epochs[1].rotation).toBeCloseTo(100 * 0.1, 6)
  })
})
