import { describe, expect, it } from 'vitest'
import type { Sample } from '../protocol'
import { CONTROLLER_CONFIG } from './config'
import { screenTilt, TiltStickProcessor } from './tiltStick'

const DT = 1_000 / 60

function sample(t: number, beta = 90, gamma = 0): Sample {
  return [t, 0, 0, 0, 0, 9.81, 0, 0, 0, 0, 0, beta, gamma]
}

function calibrated(): { stick: TiltStickProcessor; t: number } {
  const stick = new TiltStickProcessor()
  stick.startCalibration()
  let t = 0
  while (t <= CONTROLLER_CONFIG.calibration.durationMs + DT) {
    stick.push(sample(t), 0)
    t += DT
  }
  expect(stick.getSnapshot().calibration).toBe('calibrated')
  return { stick, t }
}

describe('TiltStickProcessor', () => {
  it('maps tilt into screen coordinates in each orientation', () => {
    expect(screenTilt(20, 10, 0)).toEqual([10, -20])
    expect(screenTilt(20, 10, 90)).toEqual([20, 10])
    expect(screenTilt(20, 10, 180)).toEqual([-10, 20])
    expect(screenTilt(20, 10, 270)).toEqual([-20, -10])
  })

  it('calibrates neutral and applies a deadzone', () => {
    const { stick, t } = calibrated()
    const centered = stick.push(sample(t, 90.5, 0.5), 0)
    expect(Math.hypot(...centered.vector)).toBeLessThan(0.01)
  })

  it('produces bounded, smoothed stick input', () => {
    const { stick, t } = calibrated()
    let snapshot = stick.push(sample(t, 55, 35), 0)
    expect(snapshot.vector[0]).toBeGreaterThan(0)
    expect(snapshot.vector[1]).toBeGreaterThan(0)
    for (let index = 1; index < 30; index += 1) {
      snapshot = stick.push(sample(t + index * DT, 55, 35), 0)
    }
    expect(Math.hypot(...snapshot.vector)).toBeLessThanOrEqual(1.001)
    expect(snapshot.vector[0]).toBeGreaterThan(0.65)
    expect(snapshot.vector[1]).toBeGreaterThan(0.65)
  })
})
