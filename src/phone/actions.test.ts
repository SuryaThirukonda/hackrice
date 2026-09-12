import { describe, expect, it } from 'vitest'
import { applyEmergencyPower } from './actions'
import type { DetectedGesture } from './motionProcessor'

function gesture(power: number): DetectedGesture {
  return {
    gesture: 'punch',
    t: 1,
    power,
    direction: [1, 0, 0],
    dominantAxis: 'x',
    directionLabel: 'right',
    peakAcceleration: 20,
    peakRotation: 100,
    duration: 90,
  }
}

describe('applyEmergencyPower', () => {
  it('boosts the next score by ten percent', () => {
    expect(applyEmergencyPower(gesture(50))).toMatchObject({
      power: 55,
      emergencyBoostApplied: true,
    })
    expect(applyEmergencyPower(gesture(73)).power).toBe(80)
  })

  it('caps boosted scores at 100 without changing direction data', () => {
    const original = gesture(96)
    const boosted = applyEmergencyPower(original)
    expect(boosted.power).toBe(100)
    expect(boosted.direction).toEqual(original.direction)
    expect(boosted.directionLabel).toBe(original.directionLabel)
  })
})
