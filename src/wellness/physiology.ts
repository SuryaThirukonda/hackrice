export type PhysiologyPhase = 'off' | 'connecting' | 'warming' | 'measuring' | 'usable' | 'invalid' | 'unavailable'
export interface PhysiologyMetric { value: number | null; confidence: number; stable: boolean; usable: boolean }
export interface PhysiologyState {
  connected: boolean
  phase: PhysiologyPhase
  validation: { valid: boolean; code: string | number | null; hint: string | null }
  pulse: PhysiologyMetric
  breathing: PhysiologyMetric
  hrv?: { rmssd: number | null; sdnn: number | null; baevsky: number | null; confidence: number; stable: boolean; usable: boolean }
  timestamp: number
}

export const PULSE_RANGE: readonly [number, number] = [40, 110]
export const BREATHING_RANGE: readonly [number, number] = [5, 40]
export const PHYSIOLOGY_STALE_MS = 5_000
const invalidValidation = new Set(['NoFaceFound', 'MultipleFacesFound', 'FaceNotCentered', 'FaceSizeOutOfRange', 'TooDark', 'TooBright', 'ChestNotVisible', 'FrameRateTooLow', 'ExcessiveMotion', 'FaceTooClose', 'FaceTooFar', 'FaceTooHigh', 'FaceTooLow', 'FaceNotForward'])

export function metricUsable(value: number | null, confidence: number, stable: boolean, range: readonly [number, number], validation: string | number | null, at: number, now: number): boolean {
  return value !== null && Number.isFinite(value) && value >= range[0] && value <= range[1]
    && stable && confidence >= 40 && now - at <= PHYSIOLOGY_STALE_MS
    && !invalidValidation.has(String(validation))
}

export function emptyPhysiology(now = 0): PhysiologyState {
  return { connected: false, phase: 'off', validation: { valid: false, code: null, hint: null }, pulse: { value: null, confidence: 0, stable: false, usable: false }, breathing: { value: null, confidence: 0, stable: false, usable: false }, timestamp: now }
}

