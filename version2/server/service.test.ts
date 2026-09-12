import { describe, expect, it } from 'vitest'
import { AgentService, type LlmClient } from './service'
import { INTERVAL_MS, parseOutput } from './tools'
import type { BoxingSummary } from './summarize'

const summary: BoxingSummary = { round: 1, clock: 60, me: { hp: 80, stamina: 70, state: 'idle', kd: 0 }, opp: { hp: 90, stamina: 60, state: 'idle', kd: 0, guard: true }, dist: 1.1, recent: ['a jab hit'], oppTendencies: { blockRate: 0.4, punchesPerSec: 0.8, favorite: 'jab' } }

/** Fake OpenAI client with controllable latency and payloads. */
function fake(args: unknown, delayMs = 0, models: string[] = ['gpt-5.6-luna']): LlmClient & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = []
  return {
    calls,
    models: { retrieve: async (id: string) => { if (!models.includes(id)) throw new Error(`model ${id} not found`); return { id } } },
    responses: {
      create: async (params, opts) => {
        calls.push(params)
        await new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, delayMs); opts?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }) })
        const name = (params.tools as { name: string }[] | undefined)?.[0]?.name ?? 'act'
        return { output: [{ type: 'function_call', name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }] }
      },
    },
  }
}
const req = { sport: 'boxing' as const, corner: 'a' as const, persona: 'Knuckles', summary }

describe('agent service', () => {
  it('applies a valid tool call, sorted and clamped', async () => {
    const c = fake({ steps: [{ at_ms: 900, do: 'cross' }, { at_ms: 100, do: 'in' }, { at_ms: 99999, do: 'block_on' }, { at_ms: 0, do: 'moonwalk' }], taunt: 'x'.repeat(100) })
    const s = new AgentService({ client: c, model: 'gpt-5.6-luna' })
    const r = await s.act(req)
    expect(r.source).toBe('llm')
    if (!('script' in r.output)) throw new Error('expected a script')
    expect(r.output.script.steps.map((x) => x.do)).toEqual(['in', 'cross', 'block_on'])
    expect(r.output.script.steps[2].at_ms).toBe(INTERVAL_MS)
    expect(r.output.script.taunt?.length).toBe(60)
    expect(c.calls[0].tool_choice).toBe('required')
    expect((c.calls[0].reasoning as { effort: string }).effort).toBe('none')
  })
  it('falls back on malformed arguments and on garbage JSON', async () => {
    const s1 = new AgentService({ client: fake({ nope: 1 }), model: 'gpt-5.6-luna' })
    const r1 = await s1.act(req)
    expect(r1.source).toBe('fallback'); expect(r1.error).toMatch(/validation/)
    const s2 = new AgentService({ client: fake('{not json'), model: 'gpt-5.6-luna' })
    expect((await s2.act(req)).source).toBe('fallback')
  })
  it('falls back within the time budget when the model is slow, and the fallback is playable', async () => {
    const s = new AgentService({ client: fake({ steps: [] }, 5000), model: 'gpt-5.6-luna', timeoutMs: { low: 60, high: 100 } })
    const t0 = Date.now()
    const r = await s.act(req)
    expect(Date.now() - t0).toBeLessThan(400)
    expect(r.source).toBe('fallback'); expect(r.error).toMatch(/timeout/)
    if (!('script' in r.output)) throw new Error('expected a script')
    expect(r.output.script.steps.length).toBeGreaterThan(0)
  })
  it('uses the fallback model when the configured id is rejected, and reports it in health', async () => {
    const c = fake({ steps: [{ at_ms: 0, do: 'jab' }] }, 0, ['gpt-5-mini'])
    const s = new AgentService({ client: c, model: 'gpt-5.6-luna' })
    const h = await s.health()
    expect(h.model).toBe('gpt-5-mini'); expect(h.detail).toMatch(/rejected/)
    const r = await s.act(req)
    expect(r.source).toBe('llm'); expect(c.calls[0].model).toBe('gpt-5-mini')
  })
  it('works with no key at all (pure fallback) and never throws', async () => {
    const s = new AgentService({ client: null, model: 'gpt-5.6-luna' })
    expect((await s.health()).source).toBe('fallback')
    for (const sport of ['boxing', 'bowling', 'golf'] as const) {
      const r = await s.act({ ...req, sport, summary: sport === 'boxing' ? summary : sport === 'bowling' ? { frame: 1, ball: 1, standing: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], myTotal: 0, oppTotal: 0, lastRolls: [] } : { hole: 1, par: 4, strokes: 0, oppStrokes: 0, distToCup: 300, surface: 'fairway', wind: { speed: 2, fromDeg: 90 }, hazards: 'none', recent: [] } })
      expect(r.source).toBe('fallback'); expect(r.output.sport).toBe(sport)
    }
  })
  it('a high-effort call uses the strategy tool with full reasoning and returns a plan', async () => {
    const c = fake({ plan: 'Jab and move, cross when he drops the guard.', taunt: null })
    const s = new AgentService({ client: c, model: 'gpt-5.6-luna' })
    const r = await s.act({ ...req, effort: 'high' })
    expect(r.source).toBe('llm')
    expect('strategy' in r.output && r.output.strategy.plan).toMatch(/Jab and move/)
    expect((c.calls[0].reasoning as { effort: string }).effort).toBe('high')
    expect((c.calls[0].tools as { name: string }[])[0].name).toBe('strategy')
  })
  it('parseOutput clamps bowling and golf shots', () => {
    const b = parseOutput('bowling', { lane_pos: 9, angle_deg: -9, power: 2, hook: 'x' })
    expect(b && 'shot' in b && b.shot).toEqual({ lane_pos: 0.45, angle_deg: -4, power: 1, hook: 0, taunt: undefined })
    const g = parseOutput('golf', { club: 'bazooka', aim_deg: 400, power: -1, risk: 0.5 })
    if (!g || !('shot' in g) || g.sport !== 'golf') throw new Error('golf shot')
    expect(g.shot.club).toBe('iron7')
    expect(g.shot.aim_deg).toBe(180)
  })
})
