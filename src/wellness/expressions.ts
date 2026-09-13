/**
 * Aggregate Presage expression probabilities over a session.
 * Only counts samples when face analysis is usable — missing frames are never treated as Neutral.
 */
export type Expression =
  | 'anger' | 'contempt' | 'disgust' | 'fear'
  | 'happiness' | 'sadness' | 'surprise' | 'neutral'

export interface ExpressionSummary {
  coverage: number
  validFaceSeconds: number
  totalSeconds: number
  distribution: Partial<Record<Expression, number>>
  dominant: Expression | null
}

const KNOWN: Expression[] = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'sadness', 'surprise', 'neutral']

export class ExpressionAggregator {
  private sums: Record<Expression, number> = Object.fromEntries(KNOWN.map((e) => [e, 0])) as Record<Expression, number>
  private valid = 0
  private total = 0

  /** dtSec of wall time; only add probs when usable. */
  sample(dtSec: number, usable: boolean, probs?: Partial<Record<string, number>> | null): void {
    const dt = Math.max(0, dtSec)
    this.total += dt
    if (!usable || !probs) return
    let any = false
    for (const key of KNOWN) {
      const v = Number(probs[key])
      if (Number.isFinite(v) && v > 0) { this.sums[key] += v * dt; any = true }
    }
    if (any) this.valid += dt
  }

  summary(): ExpressionSummary {
    const coverage = this.total > 0 ? this.valid / this.total : 0
    const distribution: Partial<Record<Expression, number>> = {}
    let sum = 0
    for (const key of KNOWN) sum += this.sums[key]
    let dominant: Expression | null = null
    let best = 0
    if (sum > 0 && coverage >= 0.15) {
      for (const key of KNOWN) {
        const p = this.sums[key] / sum
        if (p > 0.005) distribution[key] = Math.round(p * 1000) / 1000
        if (p > best) { best = p; dominant = key }
      }
    }
    return { coverage, validFaceSeconds: this.valid, totalSeconds: this.total, distribution, dominant }
  }
}

export const expressionLabel = (e: Expression | null): string => {
  if (!e) return 'Not measured'
  return e.charAt(0).toUpperCase() + e.slice(1)
}
