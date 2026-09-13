/**
 * Energy and activity estimates from phone motion.
 *
 * The phone is held in the hand, so it behaves like a wrist-worn research accelerometer: movement
 * intensity per one-second epoch (mean acceleration magnitude with gravity and rest bias removed) maps
 * to a metabolic equivalent, and the standard formula turns that into calories per minute for a body
 * weight. Every number here is an estimate. Active seconds and swing counts are exact; calories are
 * indicative and are labelled that way wherever they are shown.
 */
export type HealthSport = 'boxing' | 'bowling' | 'golf'

/** One second of movement, as the phone summarises it. */
export interface Epoch {
  /** Milliseconds since the session began. */
  t: number
  /** Mean acceleration magnitude over the second, m/s², gravity and rest bias removed. */
  mean: number
  /** Peak acceleration magnitude in the second, m/s². */
  peak: number
  /** Swings the detector completed in the second. */
  swings: number
  /** Degrees of rotation integrated over the second (all axes, magnitude). */
  rotation: number
}

/** Metabolic equivalents per sport, low to high intensity. Kept below the compendium's full-body
 *  values for these sports, because a hand swinging a phone is not a whole body sparring. */
export const MET_BAND: Record<HealthSport, [number, number]> = { boxing: [3, 6], bowling: [2.5, 3.5], golf: [2.5, 3.5] }
export const REST_MET = 1
/** A second whose mean acceleration clears this is moving; below it the body is at rest for our purposes. */
export const ACTIVE_MEAN = 0.8
/** Mean acceleration that counts as the top of the band: sustained hard boxing lands around here. */
export const HARD_MEAN = 6
/** A minute counts as active when at least this many of its seconds were moving. */
export const ACTIVE_SECONDS_PER_MINUTE = 20
export const DEFAULT_WEIGHT_KG = 70
/** Every completed swing counts for one calorie on top of the time-based estimate, so the number
 *  visibly climbs with each punch, roll or drive. Bag work runs around a calorie a punch, which keeps
 *  this inside the honest range for an estimate. */
export const SWING_KCAL = 1
export const DEFAULT_GOAL_KCAL = 100

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** 0 at rest, 1 at sustained hard effort, linear in between. */
export const intensityIndex = (mean: number): number => clamp01((mean - ACTIVE_MEAN) / (HARD_MEAN - ACTIVE_MEAN))

/** The MET a second of movement earns in this sport. */
export function metFor(sport: HealthSport, mean: number): number {
  if (!(mean >= ACTIVE_MEAN)) return REST_MET
  const [lo, hi] = MET_BAND[sport]
  return lo + (hi - lo) * intensityIndex(mean)
}

/** Calories per minute at a MET for a body weight: the standard MET × 3.5 × kg / 200. */
export const kcalPerMinute = (met: number, weightKg: number): number => met * 3.5 * Math.max(20, weightKg) / 200

export interface ActivitySummary {
  durationSeconds: number
  activeSeconds: number
  /** Whole minutes that met the active-seconds rule. */
  activeMinutes: number
  /** Estimated calories above resting, i.e. what the session added over sitting still. */
  kcal: number
  meanIntensity: number
  peakAcceleration: number
  swings: number
  /** Mean and max rotation per swing, degrees. */
  romMean: number
  romMax: number
  /** Last third's moving intensity over the first third's. Below 1 means effort faded; 1 when unknown. */
  fatigue: number
}

/** Fold a session's epochs and per-swing rotations into the numbers the tab shows. */
export function summarize(sport: HealthSport, epochs: readonly Epoch[], swingRoms: readonly number[], weightKg = DEFAULT_WEIGHT_KG): ActivitySummary {
  let activeSeconds = 0, kcal = 0, peak = 0, swings = 0, intensitySum = 0
  for (const s of swingRoms) if (Number.isFinite(s)) kcal += SWING_KCAL
  const perMinute = new Map<number, number>()
  for (const e of epochs) {
    const moving = e.mean >= ACTIVE_MEAN
    if (moving) { activeSeconds += 1; intensitySum += e.mean; perMinute.set(Math.floor(e.t / 60_000), (perMinute.get(Math.floor(e.t / 60_000)) ?? 0) + 1) }
    kcal += (kcalPerMinute(metFor(sport, e.mean), weightKg) - kcalPerMinute(REST_MET, weightKg)) / 60
    peak = Math.max(peak, e.peak)
    swings += e.swings
  }
  let activeMinutes = 0
  for (const n of perMinute.values()) if (n >= ACTIVE_SECONDS_PER_MINUTE) activeMinutes += 1
  const moving = epochs.filter((e) => e.mean >= ACTIVE_MEAN)
  const third = Math.floor(moving.length / 3)
  const avg = (xs: readonly Epoch[]): number => xs.length ? xs.reduce((s, e) => s + e.mean, 0) / xs.length : 0
  const fatigue = third >= 5 ? avg(moving.slice(-third)) / Math.max(1e-6, avg(moving.slice(0, third))) : 1
  return {
    durationSeconds: epochs.length,
    activeSeconds,
    activeMinutes,
    kcal: Math.max(0, kcal + Math.max(0, swings - swingRoms.length) * SWING_KCAL),
    meanIntensity: activeSeconds ? intensitySum / activeSeconds : 0,
    peakAcceleration: peak,
    swings,
    romMean: swingRoms.length ? swingRoms.reduce((s, r) => s + r, 0) / swingRoms.length : 0,
    romMax: swingRoms.length ? Math.max(...swingRoms) : 0,
    fatigue,
  }
}

/** Active time as a clock, "m:ss", so a short session reads as twenty seconds rather than zero minutes. */
export function formatActive(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What to say about a stretch of play. Honest and specific: it names what was done, then the goal. */
export function praise(kcal: number, swings: number, activeSeconds: number, goalKcal: number): string {
  const left = Math.max(0, Math.ceil(goalKcal - kcal))
  if (swings === 0 && activeSeconds === 0) return `Nothing recorded yet. Today's goal is ${goalKcal} kcal: pick up the phone and swing.`
  const done = kcal >= goalKcal ? 'Goal hit. Great work today.' : swings >= 60 || activeSeconds >= 600 ? 'Great session.' : swings >= 20 || activeSeconds >= 120 ? 'Good job.' : 'Nice start.'
  const detail = `${swings} swing${swings === 1 ? '' : 's'}, ${formatActive(activeSeconds)} active, about ${Math.round(kcal)} kcal.`
  return kcal >= goalKcal ? `${done} ${detail}` : `${done} ${detail} ${left} kcal to today's goal.`
}
