/**
 * Aggregate Presage expression probabilities over a session.
 * Only counts samples when face analysis is usable — missing frames are never treated as Neutral.
 *
 * LIVE HUD uses a shorter EMA + lower dominance margin (playful).
 * SESSION SUMMARY uses coverage gate + stronger dominance margin (conservative).
 */
export type Expression =
  | 'anger' | 'contempt' | 'disgust' | 'fear'
  | 'happiness' | 'sadness' | 'surprise' | 'neutral'

export interface ExpressionSummary {
  coverage: number
  validFaceSeconds: number
  totalSeconds: number
  distribution: Partial<Record<Expression, number>>
  /** Clear winner after dominance margin, else null → show MIXED. */
  dominant: Expression | null
  mixed: boolean
}

const KNOWN: Expression[] = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'sadness', 'surprise', 'neutral']

/** Map SDK short names (happy/angry) and long names onto our keys. */
export function normalizeExpressionKey(raw: string): Expression | null {
  const k = raw.trim().toLowerCase()
  const map: Record<string, Expression> = {
    anger: 'anger', angry: 'anger',
    contempt: 'contempt',
    disgust: 'disgust',
    fear: 'fear',
    happiness: 'happiness', happy: 'happiness',
    sadness: 'sadness', sad: 'sadness',
    surprise: 'surprise', surprised: 'surprise',
    neutral: 'neutral',
  }
  return map[k] ?? null
}

const SUMMARY_COVERAGE = 0.15
const SUMMARY_DOMINANCE_MARGIN = 0.12
const LIVE_EMA = 0.35
const LIVE_DOMINANCE_MARGIN = 0.05

export class ExpressionAggregator {
  private sums: Record<Expression, number> = Object.fromEntries(KNOWN.map((e) => [e, 0])) as Record<Expression, number>
  private valid = 0
  private total = 0
  /** Live HUD state (more sensitive). */
  private live: Record<Expression, number> = Object.fromEntries(KNOWN.map((e) => [e, 0])) as Record<Expression, number>
  private liveDominant: Expression | null = null

  /** dtSec of wall time; only add probs when usable. */
  sample(dtSec: number, usable: boolean, probs?: Partial<Record<string, number>> | null): void {
    const dt = Math.max(0, dtSec)
    this.total += dt
    if (!usable || !probs) return
    let any = false
    const mapped: Partial<Record<Expression, number>> = {}
    for (const [raw, v] of Object.entries(probs)) {
      const key = normalizeExpressionKey(raw)
      const n = Number(v)
      if (!key || !Number.isFinite(n) || n <= 0) continue
      mapped[key] = (mapped[key] ?? 0) + n
      any = true
    }
    if (!any) return
    this.valid += dt
    for (const key of KNOWN) {
      const v = mapped[key] ?? 0
      if (v > 0) this.sums[key] += v * dt
      // EMA toward current frame (or 0) for live HUD
      this.live[key] = this.live[key] * (1 - LIVE_EMA) + v * LIVE_EMA
    }
    this.liveDominant = pickDominant(this.live, LIVE_DOMINANCE_MARGIN)
  }

  summary(): ExpressionSummary {
    const coverage = this.total > 0 ? this.valid / this.total : 0
    const distribution: Partial<Record<Expression, number>> = {}
    let sum = 0
    for (const key of KNOWN) sum += this.sums[key]
    let dominant: Expression | null = null
    let mixed = false
    if (sum > 0 && coverage >= SUMMARY_COVERAGE) {
      for (const key of KNOWN) {
        const p = this.sums[key] / sum
        if (p > 0.005) distribution[key] = Math.round(p * 1000) / 1000
      }
      dominant = pickDominant(distribution as Record<Expression, number>, SUMMARY_DOMINANCE_MARGIN)
      mixed = dominant === null
    }
    return { coverage, validFaceSeconds: this.valid, totalSeconds: this.total, distribution, dominant, mixed }
  }

  /** Playful live label — lower bar than session summary. */
  liveExpression(): Expression | null { return this.liveDominant }

  reset(): void {
    for (const key of KNOWN) { this.sums[key] = 0; this.live[key] = 0 }
    this.valid = 0; this.total = 0; this.liveDominant = null
  }
}

function pickDominant(dist: Partial<Record<Expression, number>>, margin: number): Expression | null {
  let best: Expression | null = null
  let bestP = 0
  let second = 0
  for (const key of KNOWN) {
    const p = dist[key] ?? 0
    if (p > bestP) { second = bestP; bestP = p; best = key }
    else if (p > second) second = p
  }
  if (!best || bestP < 0.2) return null
  if (bestP - second < margin) return null
  return best
}

export const expressionLabel = (e: Expression | null): string => {
  if (!e) return 'Not measured'
  if (e === 'happiness') return 'Happy'
  if (e === 'sadness') return 'Sad'
  if (e === 'anger') return 'Angry'
  return e.charAt(0).toUpperCase() + e.slice(1)
}

export const EXPRESSION_EMOJI: Record<Expression, string> = {
  anger: '😠', contempt: '😒', disgust: '🤢', fear: '😨',
  happiness: '😊', sadness: '😢', surprise: '😮', neutral: '😐',
}
