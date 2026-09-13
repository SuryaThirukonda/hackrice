export interface RecoveryInput { baselinePulse: number | null; postActivityPulse: number | null; currentPulse: number | null; sampleAt: number; now: number; valid: boolean }

/** Session-relative recovery. A rise smaller than 8 BPM is too small to interpret reliably. */
export function recoveryProgress(i: RecoveryInput): number | null {
  if (!i.valid || i.baselinePulse === null || i.postActivityPulse === null || i.currentPulse === null || i.now - i.sampleAt > 5_000) return null
  const startDelta = i.postActivityPulse - i.baselinePulse
  if (startDelta < 8 || i.currentPulse < 40 || i.currentPulse > 110) return null
  const currentDelta = Math.max(0, i.currentPulse - i.baselinePulse)
  return Math.max(0, Math.min(1, 1 - currentDelta / startDelta))
}

export function recoveryLabel(value: number | null): 'NOT MEASURED' | 'BUILDING' | 'GOOD' {
  return value === null ? 'NOT MEASURED' : value >= .65 ? 'GOOD' : 'BUILDING'
}

