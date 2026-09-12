import type { ActRequest, ActResponse } from '../../server/service'
import type { BoxingSummary } from '../../server/summarize'
import type { BoxingMatch } from '../games/boxing/sim/match'
import type { Side, SimEvent } from '../games/boxing/sim/types'
import { ScriptExecutor } from './executor'

export interface CornerAgent { side: Side; persona: string; exec: ScriptExecutor; inflight: boolean; lastLatency: number; lastSource: 'llm' | 'fallback' | 'none'; calls: number; lastAt: number; plan: string; thinking: boolean }

/** One in-flight request per corner; the next call goes out as soon as the previous returns (min 1 s apart). Never blocks the sim. */
export class AgentLink {
  corners: Record<Side, CornerAgent>
  onTaunt: ((side: Side, text: string) => void) | null = null
  private endpoint: string
  private recent: SimEvent[] = []
  private minIntervalMs = 1000
  constructor(personas: [string, string], endpoint = '/agent/act') {
    this.endpoint = endpoint
    this.corners = {
      a: { side: 'a', persona: personas[0], exec: new ScriptExecutor(), inflight: false, lastLatency: 0, lastSource: 'none', calls: 0, lastAt: -1e9, plan: '', thinking: false },
      b: { side: 'b', persona: personas[1], exec: new ScriptExecutor(), inflight: false, lastLatency: 0, lastSource: 'none', calls: 0, lastAt: -1e9, plan: '', thinking: false },
    }
  }
  noteEvents(events: SimEvent[]): void { for (const e of events) { this.recent.push(e); if (this.recent.length > 12) this.recent.shift() } }

  summary(m: BoxingMatch, side: Side): BoxingSummary {
    const me = m.fighter(side), opp = m.fighter(side === 'a' ? 'b' : 'a')
    const oppPunches = this.recent.filter((e) => e.kind === 'punch' && e.who === opp.id)
    const blocked = this.recent.filter((e) => e.kind === 'punch' && e.who === me.id && e.result === 'blocked').length
    const mine = this.recent.filter((e) => e.kind === 'punch' && e.who === me.id).length
    const fav = oppPunches.filter((e) => e.kind === 'punch' && e.punch === 'cross').length > oppPunches.length / 2 ? 'cross' : 'jab'
    const describe = (e: SimEvent): string => (e.kind === 'punch' ? `${e.who === me.id ? 'my' : 'their'} ${e.punch} ${e.result}` : e.kind === 'dodge' ? `${e.who === me.id ? 'I' : 'they'} dodged` : e.kind)
    const c = this.corners[side]
    return {
      plan: c.plan || undefined,
      round: m.round, clock: m.snapshot().clock, dist: m.distance(),
      me: { hp: me.hp, stamina: me.stamina, state: me.state, kd: me.kdRound },
      opp: { hp: opp.hp, stamina: opp.stamina, state: opp.state, kd: opp.kdRound, guard: opp.guard },
      recent: this.recent.slice(-5).map(describe),
      oppTendencies: { blockRate: mine ? blocked / mine : 0, punchesPerSec: oppPunches.length / 6, favorite: fav },
    }
  }

  /** Between rounds: a slow, high-reasoning strategy call per corner. Runs while the fighters rest. */
  strategize(m: BoxingMatch): void {
    for (const c of Object.values(this.corners)) {
      if (c.thinking) continue
      c.thinking = true
      const req: ActRequest = { sport: 'boxing', corner: c.side, persona: c.persona, summary: this.summary(m, c.side), effort: 'high', tick: c.calls }
      void fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
        .then((r) => r.json() as Promise<ActResponse>)
        .then((res) => { if ('strategy' in res.output) { c.plan = res.output.strategy.plan; if (res.output.strategy.taunt && this.onTaunt) this.onTaunt(c.side, res.output.strategy.taunt) } })
        .catch(() => undefined)
        .finally(() => { c.thinking = false })
    }
  }

  /** Fire a request for a corner if none is in flight and the interval has passed. */
  tick(m: BoxingMatch, nowMs: number, effort: 'low' | 'high' = 'low'): void {
    for (const c of Object.values(this.corners)) {
      if (c.inflight || nowMs - c.lastAt < this.minIntervalMs) continue
      c.inflight = true; c.lastAt = nowMs; c.calls++
      const req: ActRequest = { sport: 'boxing', corner: c.side, persona: c.persona, summary: this.summary(m, c.side), effort, tick: c.calls }
      const startTick = m.tick
      void fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
        .then((r) => r.json() as Promise<ActResponse>)
        .then((res) => {
          c.lastLatency = res.latencyMs; c.lastSource = res.source
          if ('script' in res.output) { c.exec.load(res.output.script, Math.max(m.tick, startTick)); if (res.output.script.taunt && this.onTaunt) this.onTaunt(c.side, res.output.script.taunt) }
        })
        .catch(() => { c.lastSource = 'fallback' })
        .finally(() => { c.inflight = false })
    }
  }
}
