import { controllerInput, type ControllerId } from '../input/controller'
import { loadSettings } from '../agent/sliders'
import type { ActivitySummary } from './energy'
import type { HealthSport } from './energy'

/**
 * One match's movement record, from the game's side. Begun when a sport scene is created, pumped once
 * a frame to forward what the phone reported, and ended when the match finishes or the scene goes
 * away. Everything goes to the local health service over the same origin; when that service is not
 * running every call is a quiet no-op and the game is unaffected.
 */
export interface SessionSummaryLine { activeMinutes: number; kcal: number; swings: number; romMean: number; source: 'phone' | 'keyboard' }
const FLUSH_MS = 2000

const post = async <T>(url: string, body: unknown): Promise<T | null> => {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return r.ok ? (await r.json()) as T : null
  } catch { return null }
}

export class HealthTracker {
  private id: number | null = null
  private pending: { epochs: { t: number; mean: number; peak: number; swings: number; rotation: number }[]; roms: number[] } = { epochs: [], roms: [] }
  private lastFlush = 0
  private sawMovement = false
  private ended = false
  private starting: Promise<void> | null = null
  private controller: ControllerId

  constructor(sport: HealthSport, controller: ControllerId = 'controller_1') {
    this.controller = controller
    // The phone may have been reporting for minutes before this match: drop that backlog so the record
    // starts at the bell, not in the lobby.
    controllerInput.drainActivity(controller)
    this.starting = post<{ id: number }>('/health/session', { sport, controller, startedAt: Date.now(), weightKg: loadSettings().weightKg, source: 'keyboard' })
      .then((r) => { if (r && !this.ended) this.id = r.id })
  }

  /** Forward whatever the phone reported since last frame, in small batches. */
  pump(now = performance.now()): void {
    if (this.ended) return
    const { epochs, roms } = controllerInput.drainActivity(this.controller)
    if (epochs.length || roms.length) { this.sawMovement = true; this.pending.epochs.push(...epochs); this.pending.roms.push(...roms) }
    if (this.id !== null && (this.pending.epochs.length || this.pending.roms.length) && now - this.lastFlush >= FLUSH_MS) this.flush()
  }

  private flush(): void {
    if (this.id === null) return
    const batch = this.pending
    this.pending = { epochs: [], roms: [] }
    this.lastFlush = performance.now()
    void post(`/health/session/${this.id}/add`, batch)
  }

  /** Close the record. Resolves with the line the results card can show, or null when nothing was stored. */
  async end(): Promise<SessionSummaryLine | null> {
    if (this.ended) return null
    this.ended = true
    await this.starting
    if (this.id === null) return null
    this.pump(Number.POSITIVE_INFINITY)
    if (this.pending.epochs.length || this.pending.roms.length) await post(`/health/session/${this.id}/add`, this.pending)
    const row = await post<{ activeMinutes: number; kcal: number; swings: number; romMean: number; source: 'phone' | 'keyboard' }>(
      `/health/session/${this.id}/finish`, { endedAt: Date.now(), source: this.sawMovement ? 'phone' : 'keyboard' })
    return row ? { activeMinutes: row.activeMinutes, kcal: row.kcal, swings: row.swings, romMean: row.romMean, source: row.source } : null
  }
}

/** The one-line summary shown on a results card. */
export const summaryLine = (s: SessionSummaryLine | null): string => {
  if (!s) return ''
  if (s.source === 'keyboard') return 'keyboard match · no movement recorded'
  return `${s.activeMinutes} min active · ~${Math.round(s.kcal)} kcal est. · ${s.swings} swings · ${Math.round(s.romMean)}° per swing`
}

export type { ActivitySummary }
