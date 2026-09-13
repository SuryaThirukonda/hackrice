import { controllerInput, type ControllerId } from '../input/controller'
import { loadSettings } from '../agent/sliders'
import { formatActive, praise, summarize, type ActivitySummary, type Epoch, type HealthSport } from './energy'

/**
 * One match's movement record, from the game's side. Begun when a sport scene is created, pumped once
 * a frame to forward what the phone reported, and ended when the match finishes or the scene goes
 * away. Everything goes to the local health service over the same origin; when that service is not
 * running every call is a quiet no-op and the game is unaffected.
 */
export interface SessionSummaryLine { activeMinutes: number; activeSeconds: number; kcal: number; swings: number; romMean: number; source: 'phone' | 'keyboard' }
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
  private sport: HealthSport
  /** Everything reported so far, kept for the live badge; the server holds the record of truth. */
  private all: { epochs: Epoch[]; roms: number[] } = { epochs: [], roms: [] }

  constructor(sport: HealthSport, controller: ControllerId = 'controller_1') {
    this.controller = controller; this.sport = sport
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
    if (epochs.length || roms.length) { this.sawMovement = true; this.pending.epochs.push(...epochs); this.pending.roms.push(...roms); this.all.epochs.push(...epochs); this.all.roms.push(...roms) }
    if (this.id !== null && (this.pending.epochs.length || this.pending.roms.length) && now - this.lastFlush >= FLUSH_MS) this.flush()
  }

  private flush(): void {
    if (this.id === null) return
    const batch = this.pending
    this.pending = { epochs: [], roms: [] }
    this.lastFlush = performance.now()
    void post(`/health/session/${this.id}/add`, batch)
  }

  /** Running totals for this match, for a badge on the HUD. */
  live(): { kcal: number; swings: number; activeSeconds: number; moving: boolean } {
    const s = summarize(this.sport, this.all.epochs, this.all.roms, loadSettings().weightKg)
    return { kcal: s.kcal, swings: s.swings, activeSeconds: s.activeSeconds, moving: this.sawMovement }
  }

  /** Close the record. Resolves with the line the results card can show, or null when nothing was stored. */
  async end(): Promise<SessionSummaryLine | null> {
    if (this.ended) return null
    this.ended = true
    await this.starting
    if (this.id === null) return null
    this.pump(Number.POSITIVE_INFINITY)
    if (this.pending.epochs.length || this.pending.roms.length) await post(`/health/session/${this.id}/add`, this.pending)
    const row = await post<{ activeSeconds: number; activeMinutes: number; kcal: number; swings: number; romMean: number; source: 'phone' | 'keyboard' }>(
      `/health/session/${this.id}/finish`, { endedAt: Date.now(), source: this.sawMovement ? 'phone' : 'keyboard' })
    return row ? { activeMinutes: row.activeMinutes, activeSeconds: row.activeSeconds, kcal: row.kcal, swings: row.swings, romMean: row.romMean, source: row.source } : null
  }
}

/** The one-line summary shown on a results card. */
export const summaryLine = (s: SessionSummaryLine | null): string => {
  if (!s) return ''
  if (s.source === 'keyboard') return 'keyboard match · no movement recorded'
  return praise(s.kcal, s.swings, s.activeSeconds, loadSettings().dailyGoalKcal)
}
export { formatActive }

export type { ActivitySummary }
