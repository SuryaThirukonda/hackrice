import type { DetectedGesture } from './motionProcessor'

export const EMERGENCY_POWER_MULTIPLIER = 1.1

/** Multiply the next motion score by 10%. Direction and other fields stay unchanged. */
export function applyEmergencyPower(gesture: DetectedGesture): DetectedGesture {
  return {
    ...gesture,
    power: Math.min(100, Math.round(gesture.power * EMERGENCY_POWER_MULTIPLIER)),
    emergencyBoostApplied: true,
  }
}
