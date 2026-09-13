import { describe, expect, it } from 'vitest'
import { main, type CliDeps, type CliFs } from '../scripts/announcer/cli'
import { takeText } from '../scripts/announcer/takes'
import { DEFAULT_VOICE_ID, PREVIEW_TEXT } from '../scripts/announcer/voice'
import { TAKES } from '../src/announcer/lines'
import type { Manifest } from '../src/announcer/manifest'

interface Call { url: string; method: string; body: Record<string, unknown> | undefined; key: string | undefined }
type Responder = (call: Call, n: number) => Response | undefined

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const alignmentFor = (text: string) => {
  const characters = [...text]
  return { characters, character_start_times_seconds: characters.map((_, i) => i * 0.05), character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.05) }
}
const speech = (text: string, alignText = text): Response =>
  json(200, { audio_base64: Buffer.from(`mp3:${text.length}`).toString('base64'), alignment: alignmentFor(alignText), normalized_alignment: null }, { 'request-id': 'req-1' })

function memFs(initial: Record<string, string> = {}): CliFs & { files: Map<string, string | Uint8Array>; text(p: string): string } {
  const files = new Map<string, string | Uint8Array>(Object.entries(initial))
  const text = (p: string): string => { const v = files.get(p); if (v === undefined) throw new Error(`ENOENT ${p}`); return typeof v === 'string' ? v : Buffer.from(v).toString('utf8') }
  return {
    files, text,
    readFile: async (p) => text(p),
    writeFile: async (p, d) => { files.set(p, d) },
    appendFile: async (p, d) => { files.set(p, (files.has(p) ? text(p) : '') + d) },
    mkdir: async () => {},
    exists: (p) => files.has(p),
  }
}

/** A fake ElevenLabs: `respond` may answer a call; anything else gets the normal success for its endpoint. */
function harness(respond: Responder = () => undefined, env: Record<string, string | undefined> = { ELEVENLABS_KEY: 'test-key', ELEVENLABS_ANNOUNCER_VOICE: 'voice123' }, fs = memFs()) {
  const calls: Call[] = [], out: string[] = [], err: string[] = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call: Call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined, key: headers['xi-api-key'] }
    calls.push(call)
    const custom = respond(call, calls.filter((c) => c.url === url).length)
    if (custom) return custom
    if (url.endsWith('/v1/user/subscription')) return json(200, { character_count: 1000, character_limit: 10000, next_character_count_reset_unix: 1790000000 })
    if (url.includes('/with-timestamps')) return speech(String(call.body?.text))
    if (url.endsWith('/v1/text-to-voice/design')) return json(200, { previews: [1, 2, 3].map((i) => ({ audio_base_64: Buffer.from(`preview${i}`).toString('base64'), generated_voice_id: `gen${i}`, duration_secs: 4.2, media_type: 'audio/mpeg' })) })
    if (url.endsWith('/v1/text-to-voice')) return json(200, { voice_id: 'v-new' })
    return json(404, { detail: { status: 'not_found', message: 'no such route' } })
  }
  const deps: CliDeps = { fetch, env, cwd: '/proj', fs, out: (l) => out.push(l), err: (l) => err.push(l), sleep: async () => {}, now: () => new Date('2026-09-13T12:00:00Z') }
  return { deps, calls, out, err, fs, speechCalls: () => calls.filter((c) => c.url.includes('/with-timestamps')) }
}
const MANIFEST = '/proj/public/announcer/manifest.json'

describe('announcer CLI', () => {
  it('lists every take on a dry run without asking for speech', async () => {
    const h = harness()
    expect(await main(['generate', '--dry-run', '--max-chars', '10000'], h.deps)).toBe(0)
    const total = TAKES.reduce((n, t) => n + takeText(t).text.length, 0)
    expect(h.out.join('\n')).toContain(`${TAKES.length} of ${TAKES.length} takes to generate: ${total} characters`)
    expect(h.speechCalls()).toHaveLength(0)
  })

  it('refuses a run over --max-chars', async () => {
    const h = harness()
    expect(await main(['generate', '--dry-run', '--max-chars', '100'], h.deps)).toBe(1)
    expect(h.err.join('\n')).toContain('Over budget')
  })

  it('generates takes, cuts line segments from the alignment, and skips unchanged takes on the next run', async () => {
    const h = harness()
    expect(await main(['generate', '--only', 'boxing.finish,golf.holes'], h.deps)).toBe(0)
    const [first] = h.speechCalls()
    expect(first.url).toContain('/v1/text-to-speech/voice123/with-timestamps?output_format=mp3_44100_96')
    expect(first.key).toBe('test-key')
    expect(first.body).toMatchObject({ model_id: 'eleven_v3', voice_settings: { stability: 0.5 } })
    expect(typeof first.body?.seed).toBe('number')
    expect(h.fs.files.has('/proj/public/announcer/boxing.finish.mp3')).toBe(true)
    const m = JSON.parse(h.fs.text(MANIFEST)) as Manifest
    expect(Object.keys(m.takes).sort()).toEqual(['boxing.finish', 'golf.holes'])
    expect(m.voiceId).toBe('voice123')
    const ko = m.lines['boxing.ko#1']
    expect(ko.take).toBe('boxing.finish')
    expect(ko.start).not.toBeNull()
    expect(ko.end!).toBeGreaterThan(ko.start!)
    expect(m.lines['boxing.getup#1'].end!).toBeLessThanOrEqual(m.lines['boxing.getup#2'].start!)

    const again = harness(undefined, undefined, h.fs)
    expect(await main(['generate', '--only', 'boxing.finish,golf.holes'], again.deps)).toBe(0)
    expect(again.speechCalls()).toHaveLength(0)
    expect(again.out.join('\n')).toContain('0 of 2 takes to generate')
  })

  it('fails a take whose alignment does not match, with the per-line command, and saves nothing for it', async () => {
    const h = harness((c) => (c.url.includes('/with-timestamps') ? speech(String(c.body?.text), 'something else entirely') : undefined))
    expect(await main(['generate', '--only', 'boxing.finish'], h.deps)).toBe(1)
    expect(h.err.join('\n')).toContain('npm run announcer -- generate --per-line --only boxing.finish')
    expect(h.fs.files.has('/proj/public/announcer/boxing.finish.mp3')).toBe(false)
  })

  it('generates one request per line with --per-line', async () => {
    const h = harness()
    expect(await main(['generate', '--per-line', '--only', 'card.betting'], h.deps)).toBe(0)
    expect(h.speechCalls()).toHaveLength(5)
    const m = JSON.parse(h.fs.text(MANIFEST)) as Manifest
    expect(m.takes['card.betting'].perLine).toBe(true)
    expect(m.lines['card.bets.open']).toMatchObject({ file: 'card.betting.card.bets.open.mp3', start: null, end: null })
  })

  it('retries a busy service and then succeeds', async () => {
    const h = harness((c, n) => (c.url.includes('/with-timestamps') && n === 1 ? json(429, { detail: { status: 'system_busy', message: 'busy' } }) : undefined))
    expect(await main(['generate', '--only', 'card.betting'], h.deps)).toBe(0)
    expect(h.speechCalls()).toHaveLength(2)
  })

  it('stops on an exhausted quota and names the code', async () => {
    const h = harness((c) => (c.url.includes('/with-timestamps') ? json(401, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota' } }) : undefined))
    expect(await main(['generate', '--only', 'card.betting'], h.deps)).toBe(1)
    expect(h.err.join('\n')).toContain('quota_exceeded')
    expect(h.fs.files.has(MANIFEST)).toBe(false)
  })

  it('explains a missing key without calling the service', async () => {
    const noKey = harness(undefined, {})
    expect(await main(['generate'], noKey.deps)).toBe(1)
    expect(noKey.err.join('\n')).toContain('ELEVENLABS_KEY is not set')
    expect(noKey.calls).toHaveLength(0)
  })

  it('uses the stock voice when no announcer voice is set', async () => {
    const h = harness(undefined, { ELEVENLABS_KEY: 'test-key' })
    expect(await main(['generate', '--only', 'card.betting'], h.deps)).toBe(0)
    expect(h.speechCalls()[0].url).toContain(`/v1/text-to-speech/${DEFAULT_VOICE_ID}/with-timestamps`)
  })

  it('prints the credits left', async () => {
    const h = harness()
    expect(await main(['budget'], h.deps)).toBe(0)
    expect(h.out.join('\n')).toContain('1000 used of 10000, 9000 left')
  })

  it('designs three previews into the git-ignored data folder, falling back to the older design model if refused', async () => {
    const h = harness((c, n) => (c.url.endsWith('/design') && n === 1 ? json(400, { detail: { status: 'invalid_model', message: 'model not available' } }) : undefined))
    expect(await main(['design'], h.deps)).toBe(0)
    const designs = h.calls.filter((c) => c.url.endsWith('/design'))
    expect(designs.map((c) => c.body?.model_id)).toEqual(['eleven_ttv_v3', 'eleven_multilingual_ttv_v2'])
    expect(designs[0].body?.text).toBe(PREVIEW_TEXT)
    expect(PREVIEW_TEXT.length).toBeGreaterThanOrEqual(100)
    expect([...h.fs.files.keys()].filter((p) => p.startsWith('/proj/data/announcer/voice-design/'))).toHaveLength(3)
  })

  it('creates the voice and records its id in .env once', async () => {
    const fs = memFs({ '/proj/.env': 'ELEVENLABS_KEY = x' })
    const h = harness(undefined, undefined, fs)
    expect(await main(['create', 'gen2'], h.deps)).toBe(0)
    expect(h.calls.find((c) => c.url.endsWith('/v1/text-to-voice'))?.body).toMatchObject({ voice_name: 'Tempo Announcer', generated_voice_id: 'gen2' })
    expect(fs.text('/proj/.env')).toBe('ELEVENLABS_KEY = x\nELEVENLABS_ANNOUNCER_VOICE = v-new\n')
    const again = harness(undefined, undefined, fs)
    expect(await main(['create', 'gen3'], again.deps)).toBe(0)
    expect(fs.text('/proj/.env')).toBe('ELEVENLABS_KEY = x\nELEVENLABS_ANNOUNCER_VOICE = v-new\n')
    expect(again.out.join('\n')).toContain('already set')
  })
})
