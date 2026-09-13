/**
 * Consumer formatting for wellness metrics — keeps internal 0..1 / raw kcal separate from display.
 */
import type { HealthSport } from './energy'

export type IntensityBand = 'LOW' | 'MODERATE' | 'HIGH'

/** Same bands as Tempo Sense HUD (internal MotionLoad). */
export function movementIntensity(load: number): IntensityBand {
  if (load >= 0.55) return 'HIGH'
  if (load >= 0.28) return 'MODERATE'
  return 'LOW'
}

/** Visual bar for intensity (10 units). */
export function intensityBar(load: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(load * width)))
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

/**
 * Estimated active energy display rules:
 * null/undefined → NOT ESTIMATED
 * 0 < kcal < 1 → "<1"
 * 1 ≤ kcal < 10 → one decimal
 * ≥ 10 → whole number
 * Never "~0" for a positive estimate.
 */
export function formatEstimatedEnergy(kcal: number | null | undefined): { value: string; unit: string; estimated: boolean } {
  if (kcal === null || kcal === undefined || !Number.isFinite(kcal)) {
    return { value: 'NOT ESTIMATED', unit: '', estimated: false }
  }
  if (kcal <= 0) return { value: '0', unit: 'kcal', estimated: true }
  if (kcal < 1) return { value: '<1', unit: 'kcal', estimated: true }
  if (kcal < 10) return { value: (Math.round(kcal * 10) / 10).toFixed(1), unit: 'kcal', estimated: true }
  return { value: String(Math.round(kcal)), unit: 'kcal', estimated: true }
}

export function formatEstimatedEnergyLine(kcal: number | null | undefined): string {
  const f = formatEstimatedEnergy(kcal)
  if (!f.estimated) return 'NOT ESTIMATED'
  return `${f.value} ${f.unit} estimated`.trim()
}

/** Sport-specific ROM label + degrees when swings produced usable ROM. */
export function sessionRomLabel(sport: HealthSport, romMean: number, romMax: number, swings: number): { label: string; degrees: number } | null {
  if (swings <= 0 || (romMean <= 0 && romMax <= 0)) return null
  if (sport === 'boxing') return { label: 'Peak Punch Arc', degrees: Math.round(romMax || romMean) }
  if (sport === 'bowling') return { label: 'Average Swing ROM', degrees: Math.round(romMean || romMax) }
  return { label: 'Swing ROM', degrees: Math.round(romMean || romMax) }
}
