import { motionLoad } from '../wellness/motionLoad'

export type HealthSport = 'boxing' | 'bowling' | 'golf'
export type MetricSource = 'motion-measured' | 'game-derived' | 'energy-estimate' | 'presage' | 'wellness-derived'
export type EnergyConfidence = 'LOW' | 'MODERATE' | 'HIGH'

/** One second of normalized phone motion. The first five fields remain wire-compatible with stored traces. */
export interface Epoch {
  t: number; mean: number; peak: number; swings: number; rotation: number
  accelRms?: number; gyroRms?: number; activeFraction?: number; actionPower?: number; motionLoad?: number
}

/** Adult Compendium 2024 exergame anchors. Tempo boxing is not assigned competitive-boxing METs. */
export const MET_BAND: Record<HealthSport, readonly [number, number]> = {
  boxing: [2.3, 7.5], bowling: [2.3, 4.0], golf: [2.3, 4.0],
}
export const REST_MET = 1
export const ACTIVE_LOAD = .16
export const ACTIVE_MEAN = .8 // legacy export used by the motion lab
export const HARD_MEAN = 6
export const ACTIVE_SECONDS_PER_MINUTE = 20
export const DEFAULT_WEIGHT_KG = 70 // legacy only; new profiles do not assume it
export const DEFAULT_GOAL_MINUTES = 30
export const DEFAULT_GOAL_KCAL = 100 // legacy settings migration
const c01 = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))

export const intensityIndex = (mean: number): number => c01((mean - ACTIVE_MEAN) / (HARD_MEAN - ACTIVE_MEAN))
export function metForLoad(sport: HealthSport, load: number): number {
  if (load < ACTIVE_LOAD) return REST_MET
  const [lo, hi] = MET_BAND[sport]
  return lo + (hi - lo) * c01((load - ACTIVE_LOAD) / (1 - ACTIVE_LOAD))
}
/** Backwards-compatible helper for old traces. */
export function metFor(sport: HealthSport, mean: number): number { return metForLoad(sport, motionLoad(sport, { t: 0, mean, peak: mean, swings: 0, rotation: 0 })) }
/** Standard ACSM/Compendium conversion. Active energy subtracts the 1-MET resting component. */
export const kcalPerMinute = (met: number, weightKg: number): number => met * 3.5 * Math.max(20, weightKg) / 200

export interface ActivitySummary {
  durationSeconds: number; activeSeconds: number; activeMinutes: number; kcal: number | null
  energyConfidence: EnergyConfidence; motionLoad: number; meanIntensity: number; peakAcceleration: number
  swings: number; romMean: number; romMax: number; fatigue: number
}

export function energyConfidence(weightKg: number | null, epochs: readonly Epoch[], knownSport = true, calibrated = true): EnergyConfidence {
  if (weightKg === null || weightKg < 20) return 'LOW'
  let score = 0
  score += 2
  if (knownSport) score++
  if (epochs.length >= 30) score++
  if (epochs.length >= 120) score++
  if (calibrated) score++
  return score >= 5 ? 'HIGH' : score >= 3 ? 'MODERATE' : 'LOW'
}

export function summarize(sport: HealthSport, epochs: readonly Epoch[], swingRoms: readonly number[], weightKg: number | null = null): ActivitySummary {
  let activeSeconds = 0, kcal = 0, peak = 0, swings = 0, intensitySum = 0, loadSum = 0
  const perMinute = new Map<number, number>(), loads: number[] = []
  for (const e of epochs) {
    const load = e.motionLoad ?? motionLoad(sport, e)
    loads.push(load); loadSum += load
    const moving = load >= ACTIVE_LOAD || e.swings > 0
    if (moving) { activeSeconds++; intensitySum += e.mean; const m = Math.floor(e.t / 60_000); perMinute.set(m, (perMinute.get(m) ?? 0) + 1) }
    if (weightKg !== null) kcal += Math.max(0, metForLoad(sport, load) - REST_MET) * 3.5 * Math.max(20, weightKg) / 200 / 60
    peak = Math.max(peak, e.peak); swings += e.swings
  }
  let activeMinutes = 0
  for (const n of perMinute.values()) if (n >= ACTIVE_SECONDS_PER_MINUTE) activeMinutes++
  const activeLoads = loads.filter((x) => x >= ACTIVE_LOAD), third = Math.floor(activeLoads.length / 3)
  const avg = (xs: readonly number[]): number => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
  const fatigue = third >= 5 ? avg(activeLoads.slice(-third)) / Math.max(.001, avg(activeLoads.slice(0, third))) : 1
  return { durationSeconds: epochs.length, activeSeconds, activeMinutes, kcal: weightKg === null ? null : Math.max(0, kcal), energyConfidence: energyConfidence(weightKg, epochs),
    motionLoad: epochs.length ? loadSum / epochs.length : 0, meanIntensity: activeSeconds ? intensitySum / activeSeconds : 0, peakAcceleration: peak, swings,
    romMean: swingRoms.length ? swingRoms.reduce((a, b) => a + b, 0) / swingRoms.length : 0, romMax: swingRoms.length ? Math.max(...swingRoms) : 0, fatigue }
}

export function formatActive(seconds: number): string { const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** Consumer "active minutes" toward the daily goal: moving seconds / 60. Not the ≥20s clock-minute qualifier. */
export const activeMinutesFromSeconds = (activeSeconds: number): number => Math.max(0, activeSeconds) / 60

/** Home / Health goal label, e.g. 90s → "1.5 / 30". */
export function formatGoalProgress(activeSeconds: number, goalMinutes = DEFAULT_GOAL_MINUTES): string {
  const minutes = activeMinutesFromSeconds(activeSeconds)
  const shown = minutes >= 10 ? String(Math.round(minutes)) : (Math.round(minutes * 10) / 10).toFixed(1).replace(/\.0$/, '')
  return `${shown} / ${goalMinutes}`
}

export function praise(_kcal: number | null, swings: number, activeSeconds: number, goalMinutes = DEFAULT_GOAL_MINUTES, todayActiveSeconds = activeSeconds): string {
  if (!swings && !activeSeconds) return `No movement recorded yet. Start a Tempo Session to work toward ${goalMinutes} active minutes.`
  const todayMin = activeMinutesFromSeconds(todayActiveSeconds)
  const left = Math.max(0, Math.ceil(goalMinutes - todayMin))
  const lead = todayMin >= goalMinutes ? 'Active-minute goal hit.' : activeSeconds >= 600 ? 'Strong session.' : activeSeconds >= 120 || swings >= 20 ? 'Good movement.' : 'Nice start.'
  return left ? `${lead} ${formatActive(activeSeconds)} active · ${swings} actions · ${left} min to today's goal.` : `${lead} ${formatActive(activeSeconds)} active · ${swings} actions.`
}
