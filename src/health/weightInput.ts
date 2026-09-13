/**
 * Body-weight helpers: direct numeric entry + kg/lb conversion.
 * Stored always as kg in settings; display converts.
 */
export const KG_PER_LB = 0.45359237
export const MIN_WEIGHT_KG = 30
export const MAX_WEIGHT_KG = 250

export function kgToDisplay(kg: number, unit: 'kg' | 'lb'): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB
}

export function displayToKg(value: number, unit: 'kg' | 'lb'): number {
  return unit === 'kg' ? value : value * KG_PER_LB
}

/** Parse typed weight. Returns null if empty/clear; throws-ish via { ok:false }. */
export function parseWeightInput(raw: string, unit: 'kg' | 'lb'): { ok: true; kg: number | null } | { ok: false; error: string } {
  const t = raw.trim()
  if (!t || /^n\/?a$/i.test(t) || /^clear$/i.test(t)) return { ok: true, kg: null }
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: 'Enter a number' }
  const n = Number(t)
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number' }
  const kg = displayToKg(n, unit)
  if (kg < MIN_WEIGHT_KG || kg > MAX_WEIGHT_KG) {
    return { ok: false, error: unit === 'kg' ? `Use ${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} kg` : `Use ${Math.round(MIN_WEIGHT_KG / KG_PER_LB)}–${Math.round(MAX_WEIGHT_KG / KG_PER_LB)} lb` }
  }
  return { ok: true, kg: Math.round(kg * 10) / 10 }
}

export function formatWeightLabel(kg: number | null, unit: 'kg' | 'lb'): string {
  if (kg === null) return 'NOT SET'
  const v = kgToDisplay(kg, unit)
  const shown = unit === 'kg' ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v))
  return `${shown} ${unit}`
}
