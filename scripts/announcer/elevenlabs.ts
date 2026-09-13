import type { Alignment } from './takes'

/** A thin ElevenLabs REST client for the announcer CLI: plain fetch (injected for tests) with the plan's retry rules. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>
export interface Api {
  fetch: Fetch
  key: string
  sleep?: (ms: number) => Promise<void>
  base?: string
  log?: (line: string) => void
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Stop the whole run: the key, the quota or a permission is the problem, and retrying won't help. */
  readonly fatal: boolean
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.fatal = status === 401 || status === 402 || status === 403
  }
}

/** Waits after a 429 (`concurrent_limit_exceeded`, `system_busy`). */
const BUSY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]
/** Waits after a 5xx or a network error. */
const SERVER_DELAYS_MS = [1000, 2000]

/** Error statuses specific enough to act on; the service often pairs one with a generic code such as `unauthorized`. */
const SPECIFIC = ['quota_exceeded', 'insufficient_credits', 'missing_permissions', 'invalid_api_key', 'feature_not_available', 'concurrent_limit_exceeded', 'system_busy']

async function errorDetail(res: Response): Promise<{ code: string; message: string }> {
  let body: unknown = null
  try { body = await res.json() } catch { /* not JSON */ }
  // Errors arrive either wrapped in `detail` or as top-level { type, code, status, message }.
  const d = (body as { detail?: unknown } | null)?.detail ?? body
  if (d && typeof d === 'object') {
    const o = d as { code?: string; status?: string; message?: string }
    const message = o.message ?? JSON.stringify(d)
    const specific = [o.status, o.code].find((c) => !!c && SPECIFIC.includes(c))
    const code = specific ?? (/missing the permission/i.test(message) ? 'missing_permissions' : o.code ?? o.status ?? `http_${res.status}`)
    return { code, message }
  }
  return { code: `http_${res.status}`, message: typeof d === 'string' ? d : res.statusText || `HTTP ${res.status}` }
}

export async function call(api: Api, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  const sleep = api.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const url = `${api.base ?? 'https://api.elevenlabs.io'}${path}`
  const headers: Record<string, string> = { 'xi-api-key': api.key }
  if (body !== undefined) headers['content-type'] = 'application/json'
  let busy = 0, server = 0
  for (;;) {
    let res: Response
    try {
      res = await api.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (err) {
      if (server < SERVER_DELAYS_MS.length) { await sleep(SERVER_DELAYS_MS[server++]); continue }
      throw new ApiError(0, 'network_error', err instanceof Error ? err.message : String(err))
    }
    if (res.ok) return res
    if (res.status === 429 && busy < BUSY_DELAYS_MS.length) {
      const d = await errorDetail(res)
      api.log?.(`  busy (${d.code}), retrying in ${BUSY_DELAYS_MS[busy] / 1000} s`)
      await sleep(BUSY_DELAYS_MS[busy++])
      continue
    }
    if (res.status >= 500 && server < SERVER_DELAYS_MS.length) { await sleep(SERVER_DELAYS_MS[server++]); continue }
    const d = await errorDetail(res)
    throw new ApiError(res.status, d.code, d.message)
  }
}

export interface Subscription { used: number; limit: number; resetsAt: Date | null }

/** Credits used and available this period. Needs the key's `user_read` permission. */
export async function subscription(api: Api): Promise<Subscription> {
  const j = await (await call(api, 'GET', '/v1/user/subscription')).json() as { character_count?: number; character_limit?: number; next_character_count_reset_unix?: number }
  return { used: j.character_count ?? 0, limit: j.character_limit ?? 0, resetsAt: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000) : null }
}

export interface Preview { audio: Uint8Array; generatedVoiceId: string; durationS: number; mediaType: string }

/** Three voice previews from a description. Retries once with `fallbackModel` if the model itself is refused. */
export async function designVoice(api: Api, o: { description: string; text: string; model: string; fallbackModel?: string; seed?: number }): Promise<{ model: string; previews: Preview[] }> {
  const attempt = async (model: string) => {
    const body: Record<string, unknown> = { voice_description: o.description, text: o.text, model_id: model }
    if (o.seed !== undefined) body.seed = o.seed
    const j = await (await call(api, 'POST', '/v1/text-to-voice/design', body)).json() as { previews?: { audio_base_64: string; generated_voice_id: string; duration_secs?: number; media_type?: string }[] }
    const previews = (j.previews ?? []).map((p) => ({ audio: Buffer.from(p.audio_base_64, 'base64'), generatedVoiceId: p.generated_voice_id, durationS: p.duration_secs ?? 0, mediaType: p.media_type ?? 'audio/mpeg' }))
    return { model, previews }
  }
  try {
    return await attempt(o.model)
  } catch (err) {
    const refusedModel = err instanceof ApiError && [400, 403, 404, 422].includes(err.status)
    if (!o.fallbackModel || !refusedModel) throw err
    api.log?.(`${o.model} was refused (${(err as ApiError).code}); trying ${o.fallbackModel}`)
    return attempt(o.fallbackModel)
  }
}

/** Save a designed preview as an owned voice; returns its voice id. Uses one custom voice slot. */
export async function createVoice(api: Api, o: { name: string; description: string; generatedVoiceId: string }): Promise<string> {
  const j = await (await call(api, 'POST', '/v1/text-to-voice', { voice_name: o.name, voice_description: o.description, generated_voice_id: o.generatedVoiceId })).json() as { voice_id?: string }
  if (!j.voice_id) throw new ApiError(0, 'no_voice_id', 'the response carried no voice_id')
  return j.voice_id
}

export interface SpeechResult { audio: Uint8Array; alignment: Alignment | null; normalized: Alignment | null; requestId?: string; characterCost?: number }

/** Text to speech with character timestamps. */
export async function speak(api: Api, o: { voiceId: string; text: string; model: string; stability: number; seed: number; format: string }): Promise<SpeechResult> {
  const path = `/v1/text-to-speech/${encodeURIComponent(o.voiceId)}/with-timestamps?output_format=${encodeURIComponent(o.format)}`
  const res = await call(api, 'POST', path, { text: o.text, model_id: o.model, voice_settings: { stability: o.stability }, seed: o.seed })
  const j = await res.json() as { audio_base64?: string; alignment?: Alignment | null; normalized_alignment?: Alignment | null }
  if (!j.audio_base64) throw new ApiError(0, 'no_audio', 'the response carried no audio')
  const cost = Number(res.headers.get('character-cost'))
  return {
    audio: Buffer.from(j.audio_base64, 'base64'),
    alignment: j.alignment ?? null,
    normalized: j.normalized_alignment ?? null,
    requestId: res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? undefined,
    characterCost: Number.isFinite(cost) && cost > 0 ? cost : undefined,
  }
}
