import { DatabaseSync } from 'node:sqlite'
import { summarize, type ActivitySummary, type Epoch, type HealthSport } from '../src/health/energy'

/**
 * Local movement history, in SQLite on the machine running the big screen. Nothing leaves the laptop:
 * the phone sends per-second movement summaries, the game posts them here per session, and the health
 * tab reads back totals. Raw sensor samples are never stored, only the one-second epochs and the
 * rotation of each swing.
 */
export type SessionSource = 'phone' | 'keyboard'
export interface SessionStart { sport: HealthSport; controller: string; startedAt: number; weightKg: number; source: SessionSource }
export interface SessionRow extends SessionStart {
  id: number
  endedAt: number | null
  durationMs: number
  activeSeconds: number
  activeMinutes: number
  kcal: number
  meanIntensity: number
  peakAcceleration: number
  swings: number
  romMean: number
  romMax: number
  fatigue: number
}
export interface DaySummary { day: string; activeSeconds: number; kcal: number; swings: number; sessions: number }
export interface HealthSummary {
  today: DaySummary
  days: DaySummary[]
  bySport: Record<HealthSport, { sessions: number; activeSeconds: number; kcal: number; swings: number; romMean: number }>
  romTrend: { id: number; sport: HealthSport; endedAt: number; romMean: number; romMax: number }[]
  lastSession: (SessionRow & { epochs: Epoch[] }) | null
  streakDays: number
}

const SPORTS: HealthSport[] = ['boxing', 'bowling', 'golf']
const dayOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export class HealthStore {
  private db: DatabaseSync
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists sessions (
        id integer primary key autoincrement, sport text not null, controller text not null, source text not null,
        started_at integer not null, ended_at integer, duration_ms integer not null default 0, weight_kg real not null,
        active_seconds integer not null default 0, active_minutes integer not null default 0, kcal real not null default 0,
        mean_intensity real not null default 0, peak_accel real not null default 0, swings integer not null default 0,
        rom_mean real not null default 0, rom_max real not null default 0, fatigue real not null default 1
      );
      create table if not exists epochs (
        session_id integer not null references sessions(id) on delete cascade,
        t integer not null, mean real not null, peak real not null, swings integer not null, rotation real not null
      );
      create index if not exists epochs_session on epochs(session_id, t);
      create table if not exists swings (session_id integer not null references sessions(id) on delete cascade, rom real not null);
      create table if not exists vitals (at integer not null, pulse real, breathing real, hrv_rmssd real, confidence real not null);
      create index if not exists vitals_at on vitals(at);
    `)
  }

  start(s: SessionStart): number {
    const r = this.db.prepare('insert into sessions (sport, controller, source, started_at, weight_kg) values (?, ?, ?, ?, ?)')
      .run(s.sport, s.controller, s.source, s.startedAt, s.weightKg)
    return Number(r.lastInsertRowid)
  }

  /** Append movement to an open session. Epochs arriving out of order or twice are harmless: the
   *  summary is recomputed from whatever is stored, and duplicates by t are ignored. */
  add(id: number, epochs: readonly Epoch[], roms: readonly number[]): void {
    const seen = new Set(this.db.prepare('select t from epochs where session_id = ?').all(id).map((r) => Number((r as { t: number }).t)))
    const ins = this.db.prepare('insert into epochs (session_id, t, mean, peak, swings, rotation) values (?, ?, ?, ?, ?, ?)')
    for (const e of epochs) { if (seen.has(e.t)) continue; seen.add(e.t); ins.run(id, e.t, e.mean, e.peak, e.swings, e.rotation) }
    const sw = this.db.prepare('insert into swings (session_id, rom) values (?, ?)')
    for (const rom of roms) sw.run(id, rom)
  }

  /** Close the session and store its summary, computed from everything stored for it. */
  finish(id: number, endedAt: number, source?: SessionSource): SessionRow | null {
    const row = this.row(id)
    if (!row) return null
    const epochs = this.epochs(id)
    const roms = this.db.prepare('select rom from swings where session_id = ?').all(id).map((r) => Number((r as { rom: number }).rom))
    const s = summarize(row.sport, epochs, roms, row.weightKg)
    this.db.prepare(`update sessions set ended_at = ?, duration_ms = ?, source = ?, active_seconds = ?, active_minutes = ?, kcal = ?, mean_intensity = ?,
      peak_accel = ?, swings = ?, rom_mean = ?, rom_max = ?, fatigue = ? where id = ?`)
      .run(endedAt, Math.max(0, endedAt - row.startedAt), source ?? row.source, s.activeSeconds, s.activeMinutes, s.kcal, s.meanIntensity,
        s.peakAcceleration, s.swings, s.romMean, s.romMax, s.fatigue, id)
    return this.row(id)
  }

  row(id: number): SessionRow | null {
    const r = this.db.prepare('select * from sessions where id = ?').get(id) as Record<string, unknown> | undefined
    return r ? toRow(r) : null
  }

  epochs(id: number): Epoch[] {
    return this.db.prepare('select t, mean, peak, swings, rotation from epochs where session_id = ? order by t').all(id)
      .map((r) => { const e = r as Record<string, number>; return { t: e.t, mean: e.mean, peak: e.peak, swings: e.swings, rotation: e.rotation } })
  }

  sessions(limit = 50): SessionRow[] {
    return this.db.prepare('select * from sessions where ended_at is not null order by ended_at desc limit ?').all(limit).map((r) => toRow(r as Record<string, unknown>))
  }

  summary(now = Date.now(), days = 7): HealthSummary {
    const finished = this.sessions(10_000)
    const byDay = new Map<string, DaySummary>()
    for (let i = days - 1; i >= 0; i--) {
      const day = dayOf(now - i * 86_400_000)
      byDay.set(day, { day, activeSeconds: 0, kcal: 0, swings: 0, sessions: 0 })
    }
    const bySport = Object.fromEntries(SPORTS.map((s) => [s, { sessions: 0, activeSeconds: 0, kcal: 0, swings: 0, romMean: 0 }])) as HealthSummary['bySport']
    const romCount: Record<HealthSport, number> = { boxing: 0, bowling: 0, golf: 0 }
    for (const s of finished) {
      const d = byDay.get(dayOf(s.endedAt ?? s.startedAt))
      if (d) { d.activeSeconds += s.activeSeconds; d.kcal += s.kcal; d.swings += s.swings; d.sessions += 1 }
      const b = bySport[s.sport]
      b.sessions += 1; b.activeSeconds += s.activeSeconds; b.kcal += s.kcal; b.swings += s.swings
      if (s.swings > 0) { b.romMean += s.romMean; romCount[s.sport] += 1 }
    }
    for (const s of SPORTS) if (romCount[s]) bySport[s].romMean /= romCount[s]
    const daysOut = [...byDay.values()]
    // streak: consecutive days ending today with any active seconds
    let streak = 0
    for (let i = daysOut.length - 1; i >= 0 && daysOut[i].activeSeconds > 0; i--) streak += 1
    const last = finished[0] ?? null
    return {
      today: daysOut[daysOut.length - 1],
      days: daysOut,
      bySport,
      romTrend: finished.filter((s) => s.swings > 0).slice(0, 20).reverse().map((s) => ({ id: s.id, sport: s.sport, endedAt: s.endedAt ?? s.startedAt, romMean: s.romMean, romMax: s.romMax })),
      lastSession: last ? { ...last, epochs: this.epochs(last.id) } : null,
      streakDays: streak,
    }
  }

  /** A camera reading that passed the stability gate. */
  addVital(r: { at: number; pulse: number | null; breathing: number | null; hrvRmssd: number | null; confidence: number }): void {
    this.db.prepare('insert into vitals (at, pulse, breathing, hrv_rmssd, confidence) values (?, ?, ?, ?, ?)').run(r.at, r.pulse, r.breathing, r.hrvRmssd, r.confidence)
  }
  vitalsHistory(sinceMs: number): { at: number; pulse: number | null; breathing: number | null; hrvRmssd: number | null }[] {
    return this.db.prepare('select at, pulse, breathing, hrv_rmssd from vitals where at >= ? order by at').all(sinceMs)
      .map((r) => { const x = r as Record<string, number | null>; return { at: Number(x.at), pulse: x.pulse, breathing: x.breathing, hrvRmssd: x.hrv_rmssd } })
  }
  clear(): void { this.db.exec('delete from vitals; delete from swings; delete from epochs; delete from sessions;') }
  close(): void { this.db.close() }
}

function toRow(r: Record<string, unknown>): SessionRow {
  const n = (k: string): number => Number(r[k] ?? 0)
  return {
    id: n('id'), sport: String(r.sport) as HealthSport, controller: String(r.controller), source: String(r.source) as SessionSource,
    startedAt: n('started_at'), endedAt: r.ended_at === null || r.ended_at === undefined ? null : n('ended_at'), durationMs: n('duration_ms'), weightKg: n('weight_kg'),
    activeSeconds: n('active_seconds'), activeMinutes: n('active_minutes'), kcal: n('kcal'), meanIntensity: n('mean_intensity'), peakAcceleration: n('peak_accel'),
    swings: n('swings'), romMean: n('rom_mean'), romMax: n('rom_max'), fatigue: n('fatigue'),
  }
}

export type { ActivitySummary }
