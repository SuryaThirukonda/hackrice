// npm run announcer -- <budget | design | create | generate>: the offline side of the announcer. The key is read here
// only; the game plays the committed files in public/announcer/ and never sees it.
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnv } from '../../server/env'
import { TAKES, type Take } from '../../src/announcer/lines'
import { MANIFEST_VERSION, type Manifest, type ManifestLine } from '../../src/announcer/manifest'
import { ApiError, createVoice, designVoice, speak, subscription, type Api, type Fetch } from './elevenlabs'
import { defaultSeed, priorityOrder, segmentsFor, takeHash, takeText, type TakeText } from './takes'
import { DEFAULT_MAX_CHARS, DEFAULT_STABILITY, DEFAULT_VOICE_ID, DESIGN_DIR, DESIGN_FALLBACK_MODEL, DESIGN_MODEL, KEY_ENV, OUTPUT_FORMAT, OUT_DIR, PREVIEW_TEXT, TTS_MODEL, VOICE_DESCRIPTION, VOICE_ENV, VOICE_NAME } from './voice'

export interface CliFs {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  appendFile(path: string, data: string): Promise<void>
  mkdir(path: string): Promise<void>
  exists(path: string): boolean
}
export interface CliDeps {
  fetch: Fetch
  env: Record<string, string | undefined>
  cwd: string
  fs: CliFs
  out: (line: string) => void
  err: (line: string) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

export const USAGE = `Usage: npm run announcer -- <command>
  budget                        credits used and left this month
  design [--seed n]             three voice previews into ${DESIGN_DIR}/
  create <generated_voice_id>   save the preview you picked as the announcer voice, and record its id in .env
  generate [--dry-run] [--only <take>[,<take>]] [--force] [--seed n] [--stability 0|0.5|1] [--per-line] [--max-chars n]`

interface Flags { dryRun: boolean; force: boolean; perLine: boolean; only: string[]; seed?: number; stability?: number; maxChars: number }

function parse(argv: string[]): { command: string; positional: string[]; flags: Flags } | { error: string } {
  const flags: Flags = { dryRun: false, force: false, perLine: false, only: [], maxChars: DEFAULT_MAX_CHARS }
  const positional: string[] = []
  const num = (name: string, v: string | undefined): number => {
    const n = Number(v)
    if (v === undefined || v.trim() === '' || !Number.isFinite(n)) throw new Error(`${name} needs a number`)
    return n
  }
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]
      if (a === '--dry-run') flags.dryRun = true
      else if (a === '--force') flags.force = true
      else if (a === '--per-line') flags.perLine = true
      else if (a === '--only') {
        const v = argv[++i]
        if (!v) throw new Error('--only needs a take id')
        flags.only.push(...v.split(',').map((s) => s.trim()).filter(Boolean))
      } else if (a === '--seed') {
        const n = num('--seed', argv[++i])
        if (!Number.isInteger(n) || n < 0 || n > 4294967295) throw new Error('--seed must be a whole number from 0 to 4294967295')
        flags.seed = n
      } else if (a === '--stability') {
        const n = num('--stability', argv[++i])
        if (![0, 0.5, 1].includes(n)) throw new Error('--stability must be 0 (Creative), 0.5 (Natural) or 1 (Robust)')
        flags.stability = n
      } else if (a === '--max-chars') {
        const n = num('--max-chars', argv[++i])
        if (n < 0) throw new Error('--max-chars must not be negative')
        flags.maxChars = n
      } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
      else positional.push(a)
    }
  } catch (e) {
    return { error: (e as Error).message }
  }
  return { command: positional[0] ?? '', positional: positional.slice(1), flags }
}

function explain(e: ApiError): string {
  const hint = e.code === 'quota_exceeded' || e.code === 'insufficient_credits' ? 'The monthly credits are used up. They reset on the date `budget` shows.'
    : e.code === 'invalid_api_key' ? `The key was refused. Check ${KEY_ENV} in .env.`
    : e.code === 'missing_permissions' ? 'The key lacks a permission this command needs. Enable it for the key in the ElevenLabs dashboard.'
    : e.code === 'feature_not_available' ? `This plan can't do that through the API. Design and save the voice on elevenlabs.io instead, then put its voice id in .env as ${VOICE_ENV}.`
    : e.status === 429 ? 'The service stayed busy through every retry. Try again in a minute.' : ''
  return `ElevenLabs refused the request (${e.status ? `${e.status} ` : ''}${e.code}): ${e.message}${hint ? `\n${hint}` : ''}`
}

export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const parsed = parse(argv)
  if ('error' in parsed) { deps.err(parsed.error); deps.err(USAGE); return 2 }
  const { command, positional, flags } = parsed
  const api: Api = { fetch: deps.fetch, key: deps.env[KEY_ENV]?.trim() ?? '', sleep: deps.sleep, log: deps.out }
  const needKey = (): boolean => {
    if (api.key) return true
    deps.err(`${KEY_ENV} is not set. Add it to .env (${KEY_ENV} = <your key>) and run again.`)
    return false
  }
  try {
    if (command === 'budget') return needKey() ? await budget(api, deps) : 1
    if (command === 'design') return needKey() ? await design(api, deps, flags) : 1
    if (command === 'create') {
      if (!positional[0]) { deps.err('create needs the generated_voice_id of the preview you picked.'); return 2 }
      return needKey() ? await create(api, deps, positional[0]) : 1
    }
    if (command === 'generate') return await generate(api, deps, flags, needKey)
    deps.err(USAGE)
    return command ? 2 : 0
  } catch (err) {
    if (err instanceof ApiError) { deps.err(explain(err)); return 1 }
    throw err
  }
}

async function budget(api: Api, deps: CliDeps): Promise<number> {
  try {
    const s = await subscription(api)
    deps.out(`Credits: ${s.used} used of ${s.limit}, ${Math.max(0, s.limit - s.used)} left${s.resetsAt ? `, resets ${s.resetsAt.toISOString().slice(0, 10)}` : ''}.`)
    return 0
  } catch (err) {
    if (err instanceof ApiError && err.code === 'missing_permissions') {
      deps.err('This key cannot read the subscription (it needs user_read). generate will rely on --max-chars.')
      return 1
    }
    throw err
  }
}

async function design(api: Api, deps: CliDeps, flags: Flags): Promise<number> {
  deps.out(`Designing three previews (${PREVIEW_TEXT.length} characters of preview text, charged once)…`)
  const r = await designVoice(api, { description: VOICE_DESCRIPTION, text: PREVIEW_TEXT, model: DESIGN_MODEL, fallbackModel: DESIGN_FALLBACK_MODEL, seed: flags.seed })
  const dir = resolve(deps.cwd, DESIGN_DIR)
  await deps.fs.mkdir(dir)
  const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
  for (const [i, p] of r.previews.entries()) {
    const file = join(dir, `${stamp}-${i + 1}-${p.generatedVoiceId.replace(/[^A-Za-z0-9_-]/g, '_')}.mp3`)
    await deps.fs.writeFile(file, p.audio)
    deps.out(`  ${i + 1}. ${p.generatedVoiceId}  ${p.durationS.toFixed(1)} s  ${file}`)
  }
  if (!r.previews.length) { deps.err('The service returned no previews.'); return 1 }
  deps.out(`Model ${r.model}. Listen, pick one, then run: npm run announcer -- create <generated_voice_id>`)
  return 0
}

async function create(api: Api, deps: CliDeps, generatedVoiceId: string): Promise<number> {
  const voiceId = await createVoice(api, { name: VOICE_NAME, description: VOICE_DESCRIPTION, generatedVoiceId })
  deps.out(`Created "${VOICE_NAME}" with voice id ${voiceId}.`)
  const envPath = resolve(deps.cwd, '.env')
  const text = deps.fs.exists(envPath) ? await deps.fs.readFile(envPath) : ''
  if (new RegExp(`^\\s*${VOICE_ENV}\\s*=`, 'm').test(text)) {
    deps.out(`${VOICE_ENV} is already set in .env. Replace its value with ${voiceId} to use this voice.`)
  } else {
    await deps.fs.appendFile(envPath, `${text.length > 0 && !text.endsWith('\n') ? '\n' : ''}${VOICE_ENV} = ${voiceId}\n`)
    deps.out(`Added ${VOICE_ENV} to .env.`)
  }
  return 0
}

interface Planned { take: Take; seed: number; stability: number; tt: TakeText; hash: string; perLine: boolean; chars: number; upToDate: boolean }

async function readManifest(deps: CliDeps, path: string): Promise<Manifest> {
  const empty: Manifest = { version: MANIFEST_VERSION, voiceId: '', modelId: TTS_MODEL, outputFormat: OUTPUT_FORMAT, generatedAt: '', takes: {}, lines: {} }
  if (!deps.fs.exists(path)) return empty
  try {
    const m = JSON.parse(await deps.fs.readFile(path)) as Manifest
    return m.version === MANIFEST_VERSION && m.takes && m.lines ? m : empty
  } catch {
    return empty
  }
}

async function generate(api: Api, deps: CliDeps, flags: Flags, needKey: () => boolean): Promise<number> {
  const voiceId = deps.env[VOICE_ENV]?.trim() || DEFAULT_VOICE_ID
  if (!flags.dryRun && !needKey()) return 1
  const unknown = flags.only.filter((id) => !TAKES.some((t) => t.id === id))
  if (unknown.length) { deps.err(`Unknown take: ${unknown.join(', ')}. Takes: ${TAKES.map((t) => t.id).join(', ')}`); return 2 }

  const outDir = resolve(deps.cwd, OUT_DIR)
  const manifestPath = join(outDir, 'manifest.json')
  const manifest = await readManifest(deps, manifestPath)
  const filesPresent = (takeId: string): boolean => {
    const t = manifest.takes[takeId]
    if (!t) return false
    if (!t.perLine) return deps.fs.exists(join(outDir, t.file))
    const files = Object.values(manifest.lines).filter((l) => l.take === takeId).map((l) => l.file)
    return files.length > 0 && files.every((f) => !!f && deps.fs.exists(join(outDir, f)))
  }
  const plan: Planned[] = priorityOrder(TAKES).filter((t) => !flags.only.length || flags.only.includes(t.id)).map((take) => {
    const prev = manifest.takes[take.id]
    const seed = flags.seed ?? prev?.seed ?? defaultSeed(take.id)
    const stability = flags.stability ?? prev?.stability ?? DEFAULT_STABILITY
    const perLine = flags.perLine || !!prev?.perLine
    const tt = takeText(take)
    const hash = takeHash({ voiceId, modelId: TTS_MODEL, stability, seed, format: OUTPUT_FORMAT, text: tt.text })
    const chars = perLine ? take.lines.reduce((n, [, text]) => n + text.length, 0) : tt.text.length
    const upToDate = !flags.force && prev?.hash === hash && !!prev.perLine === perLine && filesPresent(take.id)
    return { take, seed, stability, tt, hash, perLine, chars, upToDate }
  })
  const todo = plan.filter((p) => !p.upToDate)
  const total = todo.reduce((n, p) => n + p.chars, 0)
  for (const p of plan) deps.out(`  ${p.upToDate ? 'up to date' : 'generate  '}  ${p.take.id.padEnd(18)} ${String(p.chars).padStart(5)} chars  seed ${p.seed}${p.perLine ? '  per line' : ''}`)
  deps.out(`${todo.length} of ${plan.length} takes to generate: ${total} characters, about ${total} credits on ${TTS_MODEL}.`)

  let remaining: number | null = null
  if (api.key && todo.length) {
    try {
      const s = await subscription(api)
      remaining = Math.max(0, s.limit - s.used)
      deps.out(`Credits left this month: ${remaining}.`)
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 402) throw err
      deps.out(`Could not read the remaining credits (${err.code}), so only --max-chars ${flags.maxChars} limits this run.`)
    }
  }
  if (total > flags.maxChars) { deps.err(`Over budget: ${total} characters is more than --max-chars ${flags.maxChars}. Narrow the run with --only, or raise --max-chars.`); return 1 }
  if (remaining !== null && total > remaining) { deps.err(`Over budget: ${total} characters is more than the ${remaining} credits left this month.`); return 1 }
  if (flags.dryRun || todo.length === 0) return 0

  await deps.fs.mkdir(outDir)
  manifest.voiceId = voiceId; manifest.modelId = TTS_MODEL; manifest.outputFormat = OUTPUT_FORMAT
  let writing = Promise.resolve()
  const save = (): Promise<void> => {
    manifest.generatedAt = (deps.now?.() ?? new Date()).toISOString()
    const json = `${JSON.stringify(manifest, null, 2)}\n`
    writing = writing.then(() => deps.fs.writeFile(manifestPath, json))
    return writing
  }
  const commit = (p: Planned, t: { file: string; bytes: number; requestId?: string }, lines: Record<string, ManifestLine>): void => {
    for (const [id, l] of Object.entries(manifest.lines)) if (l.take === p.take.id) delete manifest.lines[id]
    Object.assign(manifest.lines, lines)
    manifest.takes[p.take.id] = { file: t.file, hash: p.hash, seed: p.seed, stability: p.stability, chars: p.chars, bytes: t.bytes, ...(t.requestId ? { requestId: t.requestId } : {}), ...(p.perLine ? { perLine: true } : {}) }
  }
  const settings = (p: Planned) => ({ voiceId, model: TTS_MODEL, stability: p.stability, seed: p.seed, format: OUTPUT_FORMAT })

  const runTake = async (p: Planned): Promise<void> => {
    deps.out(`Generating ${p.take.id} (${p.chars} characters)…`)
    if (p.perLine) {
      const lines: Record<string, ManifestLine> = {}
      let bytes = 0, requestId: string | undefined
      for (const [id, text] of p.take.lines) {
        const r = await speak(api, { ...settings(p), text })
        const file = `${p.take.id}.${id.replace('#', '-')}.mp3`
        await deps.fs.writeFile(join(outDir, file), r.audio)
        bytes += r.audio.length; requestId ??= r.requestId
        lines[id] = { take: p.take.id, file, start: null, end: null }
      }
      commit(p, { file: '', bytes, requestId }, lines)
    } else {
      const r = await speak(api, { ...settings(p), text: p.tt.text })
      let segs = r.alignment ? segmentsFor(p.tt, r.alignment) : { error: 'no alignment came back' }
      if ('error' in segs && r.normalized) { const alt = segmentsFor(p.tt, r.normalized); if (!('error' in alt)) segs = alt }
      if ('error' in segs) throw new Error(`${segs.error}. Generate it one line per request instead: npm run announcer -- generate --per-line --only ${p.take.id}`)
      const file = `${p.take.id}.mp3`
      await deps.fs.writeFile(join(outDir, file), r.audio)
      const lines: Record<string, ManifestLine> = {}
      for (const [id, s] of Object.entries(segs)) lines[id] = { take: p.take.id, start: s.start, end: s.end }
      commit(p, { file, bytes: r.audio.length, requestId: r.requestId }, lines)
    }
    await save()
    deps.out(`  saved ${p.take.id}`)
  }

  const state: { stop: ApiError | null; failures: string[] } = { stop: null, failures: [] }
  const queue = [...todo]
  const worker = async (): Promise<void> => {
    while (!state.stop) {
      const p = queue.shift()
      if (!p) return
      try {
        await runTake(p)
      } catch (err) {
        if (err instanceof ApiError && err.fatal) { state.stop = err; return }
        state.failures.push(`${p.take.id}: ${err instanceof ApiError ? explain(err) : err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  await Promise.all([worker(), worker()]) // the free plan allows two concurrent requests
  await writing
  if (state.stop) { deps.err(explain(state.stop)); deps.err('Stopped. Every take finished before this is saved in the manifest.'); return 1 }
  if (state.failures.length) { for (const f of state.failures) deps.err(f); return 1 }
  deps.out(`Generated ${todo.length} takes. Listen at /announcer-review.html on the dev server, then commit ${OUT_DIR}/.`)
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  loadEnv()
  const fs: CliFs = {
    readFile: (p) => readFile(p, 'utf8'),
    writeFile: (p, d) => writeFile(p, d),
    appendFile: (p, d) => appendFile(p, d),
    mkdir: async (p) => { await mkdir(p, { recursive: true }) },
    exists: (p) => existsSync(p),
  }
  main(process.argv.slice(2), { fetch: (url, init) => fetch(url, init), env: process.env, cwd: process.cwd(), fs, out: (l) => console.log(l), err: (l) => console.error(l) })
    .then((code) => { process.exitCode = code }, (err: unknown) => { console.error(err); process.exitCode = 1 })
}
