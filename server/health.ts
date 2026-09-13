import { DatabaseSync } from 'node:sqlite'
import { metForLoad, summarize, type ActivitySummary, type EnergyConfidence, type Epoch, type HealthSport } from '../src/health/energy'
import { motionLoad } from '../src/wellness/motionLoad'
import type { AdaptationDecision } from '../src/wellness/adaptation'
import type { PlayerState } from '../src/wellness/playerState'

/**
 * Local movement history, in SQLite on the machine running the big screen. Nothing leaves the laptop:
 * the phone sends per-second movement summaries, the game posts them here per session, and the health
 * tab reads back totals. Raw sensor samples are never stored, only the one-second epochs and the
 * rotation of each swing.
 */
export type SessionSource = 'phone' | 'keyboard'
export interface SessionStart { sport: HealthSport; controller: string; startedAt: number; weightKg: number | null; source: SessionSource }
export interface SessionRow extends SessionStart {
  id: number
  endedAt: number | null
  durationMs: number
  activeSeconds: number
  activeMinutes: number
  kcal: number | null
  meanIntensity: number
  peakAcceleration: number
  swings: number
  romMean: number
  romMax: number
  fatigue: number
  motionLoad: number
  energyConfidence: EnergyConfidence
}
export interface DaySummary { day: string; activeSeconds: number; kcal: number; swings: number; sessions: number }
export interface HealthSummary {
  today: DaySummary
  /** Alias for today.activeSeconds — consumer ACTIVE TIME toward the daily goal. */
  todayActiveSeconds: number
  days: DaySummary[]
  bySport: Record<HealthSport, { sessions: number; activeSeconds: number; kcal: number; swings: number; romMean: number }>
  romTrend: { id: number; sport: HealthSport; endedAt: number; romMean: number; romMax: number }[]
  lastSession: (SessionRow & { epochs: Epoch[] }) | null
  streakDays: number
  latestVitals: { at: number; pulse: number | null; breathing: number | null; hrvRmssd: number | null; confidence: number } | null
  lastAdaptation: { sessionId: number; at: number; previousDifficulty: number; newDifficulty: number; reasonCode: string } | null
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
        t integer not null, mean real not null, peak real not null, swings integer not null, rotation real not null,
        motion_load real not null default 0, estimated_met real not null default 1, active_kcal real, confidence text not null default 'LOW'
      );
      create index if not exists epochs_session on epochs(session_id, t);
      create table if not exists swings (session_id integer not null references sessions(id) on delete cascade, rom real not null);
      create table if not exists vitals (at integer not null, pulse real, breathing real, hrv_rmssd real, confidence real not null, phase text not null default 'recovery', validation text, stable integer not null default 1);
      create index if not exists vitals_at on vitals(at);
      create table if not exists fights (
        id integer primary key autoincrement, started_at integer not null, ended_at integer, seed integer not null,
        name_a text not null, name_b text not null, winner text, by text, round integer,
        chips_before integer not null, chips_after integer, bets_won integer not null default 0, bets_lost integer not null default 0, net integer not null default 0
      );
      create table if not exists bets (
        id integer primary key autoincrement, fight_id integer not null references fights(id) on delete cascade, at integer not null,
        market text not null, kind text not null, round integer not null, corner text not null, stake integer not null, odds real not null,
        result text not null default 'open', paid integer
      );
      create table if not exists chip_ledger (
        id integer primary key autoincrement, fight_id integer references fights(id) on delete cascade, at integer not null,
        reason text not null, amount integer not null, balance integer not null
      );
      create index if not exists chip_ledger_at on chip_ledger(at);
      create table if not exists adaptation_decisions (
        session_id integer not null references sessions(id) on delete cascade, at integer not null,
        player_state text not null, previous_difficulty real not null, new_difficulty real not null,
        recovery_seconds_delta integer not null, next_sport_bias text, reason_code text not null
      );
    `)
    this.ensureColumn('sessions', 'motion_load', 'real not null default 0')
    this.ensureColumn('sessions', 'energy_confidence', "text not null default 'LOW'")
    this.ensureColumn('epochs', 'motion_load', 'real not null default 0')
    this.ensureColumn('epochs', 'estimated_met', 'real not null default 1')
    this.ensureColumn('epochs', 'active_kcal', 'real')
    this.ensureColumn('epochs', 'confidence', "text not null default 'LOW'")
    this.ensureColumn('vitals', 'phase', "text not null default 'recovery'")
    this.ensureColumn('vitals', 'validation', 'text')
    this.ensureColumn('vitals', 'stable', 'integer not null default 1')
  }

  private ensureColumn(table: string, name: string, definition: string): void {
    const cols = this.db.prepare(`pragma table_info(${table})`).all().map((r) => String((r as { name: string }).name))
    if (!cols.includes(name)) this.db.exec(`alter table ${table} add column ${name} ${definition}`)
  }

  start(s: SessionStart): number {
    const r = this.db.prepare('insert into sessions (sport, controller, source, started_at, weight_kg) values (?, ?, ?, ?, ?)')
      .run(s.sport, s.controller, s.source, s.startedAt, s.weightKg ?? 0)
    return Number(r.lastInsertRowid)
  }

  /** Append movement to an open session. Epochs arriving out of order or twice are harmless: the
   *  summary is recomputed from whatever is stored, and duplicates by t are ignored. */
  add(id: number, epochs: readonly Epoch[], roms: readonly number[]): void {
    const seen = new Set(this.db.prepare('select t from epochs where session_id = ?').all(id).map((r) => Number((r as { t: number }).t)))
    const row = this.row(id)
    const ins = this.db.prepare('insert into epochs (session_id, t, mean, peak, swings, rotation, motion_load, estimated_met, active_kcal, confidence) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const e of epochs) {
      if (seen.has(e.t)) continue; seen.add(e.t)
      const load = row ? motionLoad(row.sport, e) : 0, met = row ? metForLoad(row.sport, load) : 1
      const kcal = row?.weightKg ? Math.max(0, met - 1) * 3.5 * row.weightKg / 200 / 60 : null
      ins.run(id, e.t, e.mean, e.peak, e.swings, e.rotation, load, met, kcal, row?.weightKg ? 'MODERATE' : 'LOW')
    }
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
      peak_accel = ?, swings = ?, rom_mean = ?, rom_max = ?, fatigue = ?, motion_load = ?, energy_confidence = ? where id = ?`)
      .run(endedAt, Math.max(0, endedAt - row.startedAt), source ?? row.source, s.activeSeconds, s.activeMinutes, s.kcal ?? 0, s.meanIntensity,
        s.peakAcceleration, s.swings, s.romMean, s.romMax, s.fatigue, s.motionLoad, s.energyConfidence, id)
    return this.row(id)
  }

  row(id: number): SessionRow | null {
    const r = this.db.prepare('select * from sessions where id = ?').get(id) as Record<string, unknown> | undefined
    return r ? toRow(r) : null
  }

  epochs(id: number): Epoch[] {
    return this.db.prepare('select t, mean, peak, swings, rotation, motion_load from epochs where session_id = ? order by t').all(id)
      .map((r) => { const e = r as Record<string, number>; return { t: e.t, mean: e.mean, peak: e.peak, swings: e.swings, rotation: e.rotation, motionLoad: e.motion_load } })
  }

  sessions(limit = 50): SessionRow[] {
    return this.db.prepare('select * from sessions where ended_at is not null order by ended_at desc limit ?').all(limit).map((r) => toRow(r as Record<string, unknown>))
  }

  summary(now = Date.now(), days = 7, displayWeightKg: number | null = null): HealthSummary {
    const finished = this.sessions(10_000)
    const byDay = new Map<string, DaySummary>()
    for (let i = days - 1; i >= 0; i--) {
      const day = dayOf(now - i * 86_400_000)
      byDay.set(day, { day, activeSeconds: 0, kcal: 0, swings: 0, sessions: 0 })
    }
    const bySport = Object.fromEntries(SPORTS.map((s) => [s, { sessions: 0, activeSeconds: 0, kcal: 0, swings: 0, romMean: 0 }])) as HealthSummary['bySport']
    const romCount: Record<HealthSport, number> = { boxing: 0, bowling: 0, golf: 0 }
    for (const s of finished) {
      const kcal = this.energyFor(s, displayWeightKg)
      const d = byDay.get(dayOf(s.endedAt ?? s.startedAt))
      if (d) { d.activeSeconds += s.activeSeconds; d.kcal += kcal ?? 0; d.swings += s.swings; d.sessions += 1 }
      const b = bySport[s.sport]
      b.sessions += 1; b.activeSeconds += s.activeSeconds; b.kcal += kcal ?? 0; b.swings += s.swings
      if (s.swings > 0) { b.romMean += s.romMean; romCount[s.sport] += 1 }
    }
    for (const s of SPORTS) if (romCount[s]) bySport[s].romMean /= romCount[s]
    const daysOut = [...byDay.values()]
    let streak = 0
    for (let i = daysOut.length - 1; i >= 0 && daysOut[i].activeSeconds > 0; i--) streak += 1
    const last = finished[0] ?? null
    const today = daysOut[daysOut.length - 1]
    const lastWithEnergy = last ? { ...last, kcal: this.energyFor(last, displayWeightKg), epochs: this.epochs(last.id) } : null
    return {
      today,
      todayActiveSeconds: today.activeSeconds,
      days: daysOut,
      bySport,
      romTrend: finished.filter((s) => s.swings > 0).slice(0, 20).reverse().map((s) => ({ id: s.id, sport: s.sport, endedAt: s.endedAt ?? s.startedAt, romMean: s.romMean, romMax: s.romMax })),
      lastSession: lastWithEnergy,
      streakDays: streak,
      latestVitals: this.latestVital(),
      lastAdaptation: this.latestAdaptation(),
    }
  }

  /**
   * Display energy from epochs + current body weight when possible.
   * Does not mutate stored epochs. Aggregate-only rows without weight → null (NOT ESTIMATED).
   */
  energyFor(row: SessionRow, displayWeightKg: number | null = null): number | null {
    const w = displayWeightKg !== null && displayWeightKg >= 20 ? displayWeightKg : row.weightKg
    if (w === null || w < 20) return null
    const epochs = this.epochs(row.id)
    if (epochs.length) return summarize(row.sport, epochs, [], w).kcal
    if (row.weightKg === null) return null
    return row.kcal
  }

  addAdaptation(sessionId: number, at: number, player: PlayerState, previousDifficulty: number, newDifficulty: number, decision: AdaptationDecision): void {
    this.db.prepare('insert into adaptation_decisions values (?, ?, ?, ?, ?, ?, ?, ?)').run(sessionId, at, JSON.stringify(player), previousDifficulty, newDifficulty, decision.recoverySecondsDelta, decision.nextSportBias ?? null, decision.reasonCode)
  }
  latestAdaptation(): HealthSummary['lastAdaptation'] {
    const r = this.db.prepare('select session_id, at, previous_difficulty, new_difficulty, reason_code from adaptation_decisions order by at desc limit 1').get() as Record<string, unknown> | undefined
    return r ? { sessionId: Number(r.session_id), at: Number(r.at), previousDifficulty: Number(r.previous_difficulty), newDifficulty: Number(r.new_difficulty), reasonCode: String(r.reason_code) } : null
  }
  latestVital(): HealthSummary['latestVitals'] {
    const r = this.db.prepare('select at, pulse, breathing, hrv_rmssd, confidence from vitals order by at desc limit 1').get() as Record<string, number | null> | undefined
    return r ? { at: Number(r.at), pulse: r.pulse, breathing: r.breathing, hrvRmssd: r.hrv_rmssd, confidence: Number(r.confidence) } : null
  }

  /** A camera reading that passed the stability gate. */
  addVital(r: { at: number; pulse: number | null; breathing: number | null; hrvRmssd: number | null; confidence: number }): void {
    this.db.prepare('insert into vitals (at, pulse, breathing, hrv_rmssd, confidence) values (?, ?, ?, ?, ?)').run(r.at, r.pulse, r.breathing, r.hrvRmssd, r.confidence)
  }
  vitalsHistory(sinceMs: number): { at: number; pulse: number | null; breathing: number | null; hrvRmssd: number | null }[] {
    return this.db.prepare('select at, pulse, breathing, hrv_rmssd from vitals where at >= ? order by at').all(sinceMs)
      .map((r) => { const x = r as Record<string, number | null>; return { at: Number(x.at), pulse: x.pulse, breathing: x.breathing, hrvRmssd: x.hrv_rmssd } })
  }
  clear(): void { this.db.exec('delete from adaptation_decisions; delete from vitals; delete from swings; delete from epochs; delete from sessions;') }

  // ---- chips: every fight, every bet, every chip movement ----

  /** The running balance is the last ledger row; with no history it is the starting stack. */
  chipBalance(startChips: number): number {
    const r = this.db.prepare('select balance from chip_ledger order by id desc limit 1').get() as { balance: number } | undefined
    return r ? Number(r.balance) : startChips
  }
  startFight(f: { startedAt: number; seed: number; nameA: string; nameB: string; chipsBefore: number }): number {
    const r = this.db.prepare('insert into fights (started_at, seed, name_a, name_b, chips_before) values (?, ?, ?, ?, ?)').run(f.startedAt, f.seed, f.nameA, f.nameB, f.chipsBefore)
    return Number(r.lastInsertRowid)
  }
  recordBet(fightId: number, b: { at: number; market: string; kind: string; round: number; corner: string; stake: number; odds: number }): number {
    const r = this.db.prepare('insert into bets (fight_id, at, market, kind, round, corner, stake, odds) values (?, ?, ?, ?, ?, ?, ?, ?)').run(fightId, b.at, b.market, b.kind, b.round, b.corner, b.stake, b.odds)
    return Number(r.lastInsertRowid)
  }
  /** A market resolved: the bets' outcomes and the chip movements the book logged for it. */
  settleMarket(fightId: number, market: string, winner: string, bets: { corner: string; stake: number; paid: number }[], ledger: { at: number; reason: string; amount: number; balance: number }[]): void {
    const upd = this.db.prepare("update bets set result = ?, paid = ? where id = (select id from bets where fight_id = ? and market = ? and corner = ? and stake = ? and result = 'open' order by id limit 1)")
    for (const b of bets) upd.run(winner === 'draw' ? 'draw' : b.paid > 0 ? 'won' : 'lost', b.paid, fightId, market, b.corner, b.stake)
    this.appendLedger(fightId, ledger)
  }
  appendLedger(fightId: number | null, ledger: { at: number; reason: string; amount: number; balance: number }[]): void {
    const ins = this.db.prepare('insert into chip_ledger (fight_id, at, reason, amount, balance) values (?, ?, ?, ?, ?)')
    for (const e of ledger) ins.run(fightId, e.at, e.reason, Math.round(e.amount), Math.round(e.balance))
  }
  finishFight(fightId: number, r: { endedAt: number; winner: string; by: string; round: number; chipsAfter: number; betsWon: number; betsLost: number; net: number }): void {
    this.db.prepare('update fights set ended_at = ?, winner = ?, by = ?, round = ?, chips_after = ?, bets_won = ?, bets_lost = ?, net = ? where id = ?')
      .run(r.endedAt, r.winner, r.by, r.round, r.chipsAfter, r.betsWon, r.betsLost, r.net, fightId)
  }
  chipSummary(startChips: number, now = Date.now()): ChipSummary {
    const balance = this.chipBalance(startChips)
    const fights = this.db.prepare('select * from fights where ended_at is not null order by ended_at desc').all() as Record<string, unknown>[]
    const bets = this.db.prepare("select * from bets where result != 'open' order by at desc").all() as Record<string, unknown>[]
    const peak = this.db.prepare('select max(balance) as m, min(balance) as n from chip_ledger').get() as { m: number | null; n: number | null } | undefined
    const bailouts = Number((this.db.prepare("select count(*) as c from chip_ledger where reason = 'bailout'").get() as { c: number }).c)
    const won = bets.filter((b) => b.result === 'won').length, lost = bets.filter((b) => b.result === 'lost').length
    const staked = bets.reduce((s, b) => s + Number(b.stake), 0), returned = bets.reduce((s, b) => s + Number(b.paid ?? 0), 0)
    const day = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const today = day(now)
    const todayNet = fights.filter((f) => day(Number(f.ended_at)) === today).reduce((s, f) => s + Number(f.net), 0)
    return {
      balance, startChips, fights: fights.length, betsWon: won, betsLost: lost, staked, returned, net: returned - staked,
      best: peak?.m ?? balance, worst: peak?.n ?? balance, bailouts, todayNet,
      recentFights: fights.slice(0, 10).map((f) => ({ id: Number(f.id), endedAt: Number(f.ended_at), nameA: String(f.name_a), nameB: String(f.name_b), winner: String(f.winner ?? ''), by: String(f.by ?? ''), round: Number(f.round ?? 0), chipsBefore: Number(f.chips_before), chipsAfter: Number(f.chips_after ?? f.chips_before), net: Number(f.net) })),
      recentBets: bets.slice(0, 20).map((b) => ({ at: Number(b.at), market: String(b.market), corner: String(b.corner), stake: Number(b.stake), odds: Number(b.odds), result: String(b.result), paid: Number(b.paid ?? 0) })),
    }
  }
  chipLedger(limit = 200): { at: number; reason: string; amount: number; balance: number; fightId: number | null }[] {
    return (this.db.prepare('select * from chip_ledger order by id desc limit ?').all(limit) as Record<string, unknown>[])
      .map((r) => ({ at: Number(r.at), reason: String(r.reason), amount: Number(r.amount), balance: Number(r.balance), fightId: r.fight_id === null ? null : Number(r.fight_id) })).reverse()
  }
  /** Back to the starting stack, with the history kept and a grant row that says so. */
  resetChips(startChips: number, now = Date.now()): number {
    const current = this.chipBalance(startChips)
    this.appendLedger(null, [{ at: now, reason: 'grant', amount: startChips - current, balance: startChips }])
    return startChips
  }
  close(): void { this.db.close() }
}

function toRow(r: Record<string, unknown>): SessionRow {
  const n = (k: string): number => Number(r[k] ?? 0)
  const weightKg = n('weight_kg') > 0 ? n('weight_kg') : null
  return {
    id: n('id'), sport: String(r.sport) as HealthSport, controller: String(r.controller), source: String(r.source) as SessionSource,
    startedAt: n('started_at'), endedAt: r.ended_at === null || r.ended_at === undefined ? null : n('ended_at'), durationMs: n('duration_ms'), weightKg,
    activeSeconds: n('active_seconds'), activeMinutes: n('active_minutes'), kcal: weightKg === null && n('active_seconds') > 0 ? null : n('kcal'), meanIntensity: n('mean_intensity'), peakAcceleration: n('peak_accel'),
    swings: n('swings'), romMean: n('rom_mean'), romMax: n('rom_max'), fatigue: n('fatigue'), motionLoad: n('motion_load'), energyConfidence: String(r.energy_confidence ?? 'LOW') as EnergyConfidence,
  }
}

export interface ChipSummary {
  balance: number; startChips: number; fights: number; betsWon: number; betsLost: number; staked: number; returned: number; net: number
  best: number; worst: number; bailouts: number; todayNet: number
  recentFights: { id: number; endedAt: number; nameA: string; nameB: string; winner: string; by: string; round: number; chipsBefore: number; chipsAfter: number; net: number }[]
  recentBets: { at: number; market: string; corner: string; stake: number; odds: number; result: string; paid: number }[]
}

export type { ActivitySummary }
