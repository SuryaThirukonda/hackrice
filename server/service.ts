import { fallback } from './fallback'
import { instructions, render, type Summary } from './summarize'
import { parseOutput, STRATEGY_TOOL, TOOLS, type AgentOutput, type Sport } from './tools'

/** effort 'low' = fast in-play call (reasoning off); 'high' = between-round strategy call with full reasoning. */
export interface ActRequest { sport: Sport; corner: 'a' | 'b'; persona: string; summary: Summary; effort?: 'low' | 'high'; tick?: number }
export interface ActResponse { output: AgentOutput; latencyMs: number; source: 'llm' | 'fallback'; model: string; error?: string }

/** The slice of the OpenAI client we use, so tests can inject a fake. */
export interface LlmClient {
  responses: { create(params: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<{ output: { type: string; name?: string; arguments?: string }[] }> }
  models: { retrieve(id: string): Promise<unknown> }
}
export interface ServiceOptions { client: LlmClient | null; model: string; fallbackModel?: string; timeoutMs?: { low: number; high: number }; now?: () => number }

export class AgentService {
  private client: LlmClient | null
  model: string
  private fallbackModel: string
  private timeouts: { low: number; high: number }
  private now: () => number
  resolved: string | null = null
  private calls = 0
  constructor(o: ServiceOptions) {
    this.client = o.client; this.model = o.model; this.fallbackModel = o.fallbackModel ?? 'gpt-5-mini'
    this.timeouts = o.timeoutMs ?? { low: 3000, high: 8000 }; this.now = o.now ?? (() => Date.now())
  }

  /** Confirm the configured model id exists; otherwise fall back. */
  async health(): Promise<{ ok: boolean; model: string; source: 'llm' | 'fallback'; detail: string }> {
    if (!this.client) return { ok: true, model: 'none', source: 'fallback', detail: 'no OPENAI_KEY: deterministic fallback scripts' }
    if (this.resolved) return { ok: true, model: this.resolved, source: 'llm', detail: 'model verified' }
    try { await this.client.models.retrieve(this.model); this.resolved = this.model; return { ok: true, model: this.model, source: 'llm', detail: 'model verified' } }
    catch (e) {
      try { await this.client.models.retrieve(this.fallbackModel); this.resolved = this.fallbackModel; return { ok: true, model: this.fallbackModel, source: 'llm', detail: `${this.model} rejected (${String((e as Error).message).slice(0, 80)}), using ${this.fallbackModel}` } }
      catch (e2) { return { ok: false, model: 'none', source: 'fallback', detail: `no usable model: ${String((e2 as Error).message).slice(0, 80)}` } }
    }
  }

  async act(req: ActRequest): Promise<ActResponse> {
    const t0 = this.now()
    const fb = (error?: string): ActResponse => ({ output: fallback(req.sport, req.summary, req.tick ?? this.calls, req.effort === 'high'), latencyMs: this.now() - t0, source: 'fallback', model: this.resolved ?? 'none', error })
    this.calls++
    if (!this.client) return fb()
    if (!this.resolved) { const h = await this.health(); if (h.source !== 'llm') return fb(h.detail) }
    const effort = req.effort ?? 'low'
    const strategy = effort === 'high'
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeouts[effort])
    try {
      const res = await this.client.responses.create({
        model: this.resolved, instructions: instructions(req.sport, req.persona) + (strategy ? ' The round is over: think it through and set a plan with the strategy tool.' : ''),
        input: [{ role: 'user', content: render(req.sport, req.summary) }],
        tools: [strategy ? STRATEGY_TOOL : TOOLS[req.sport]], tool_choice: 'required', parallel_tool_calls: false,
        max_output_tokens: strategy ? 2000 : 160, reasoning: { effort: strategy ? 'high' : 'none' }, store: false,
      }, { signal: ctrl.signal })
      const call = res.output.find((o) => o.type === 'function_call')
      if (!call?.arguments) return fb('no tool call in response')
      let args: unknown
      try { args = JSON.parse(call.arguments) } catch { return fb('unparseable tool arguments') }
      const out = parseOutput(req.sport, args, call.name)
      if (!out) return fb('tool arguments failed validation')
      return { output: out, latencyMs: this.now() - t0, source: 'llm', model: this.resolved ?? this.model }
    } catch (e) {
      return fb(ctrl.signal.aborted ? `timeout after ${this.timeouts[effort]} ms` : String((e as Error).message).slice(0, 120))
    } finally { clearTimeout(timer) }
  }
}
