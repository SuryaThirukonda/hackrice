/**
 * DISPLAYABLE vs TRUSTED quality tiers for Presage metrics.
 * DISPLAYABLE = responsive UI. TRUSTED = adaptation, recovery, persisted health.
 */
import { metricUsable, PULSE_RANGE, BREATHING_RANGE } from './physiology'

export const TRUSTED_CONFIDENCE = 40
export const DISPLAY_CONFIDENCE = 22
export const DISPLAY_STALE_MS = 8_000

export type PulseTier = 'none' | 'estimating' | 'trusted'

export function pulseTrusted(
  value: number | null,
  confidence: number,
  stable: boolean,
  validation: string | number | null,
  at: number,
  now: number,
): boolean {
  return metricUsable(value, confidence, stable, PULSE_RANGE, validation, at, now)
}

/** Fresh + in-range + soft confidence; may be unstable. For live HUD only. */
export function pulseDisplayable(
  value: number | null,
  confidence: number,
  validation: string | number | null,
  at: number,
  now: number,
): boolean {
  if (value === null || !Number.isFinite(value)) return false
  if (value < PULSE_RANGE[0] || value > PULSE_RANGE[1]) return false
  if (now - at > DISPLAY_STALE_MS) return false
  if (confidence < DISPLAY_CONFIDENCE) return false
  const code = String(validation).replace(/^k/, '')
  if (['NoFaceFound', 'MultipleFacesFound'].includes(code)) return false
  return true
}

export function pulseTier(
  value: number | null,
  confidence: number,
  stable: boolean,
  validation: string | number | null,
  at: number,
  now: number,
): PulseTier {
  if (pulseTrusted(value, confidence, stable, validation, at, now)) return 'trusted'
  if (pulseDisplayable(value, confidence, validation, at, now)) return 'estimating'
  return 'none'
}

export function breathingTrusted(
  value: number | null,
  confidence: number,
  stable: boolean,
  validation: string | number | null,
  at: number,
  now: number,
): boolean {
  return metricUsable(value, confidence, stable, BREATHING_RANGE, validation, at, now) && confidence >= 45
}
