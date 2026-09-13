import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from '../../server/env'
import { TAKES, type Group, type Take } from '../../src/announcer/lines'
import { MANIFEST_VERSION, type Manifest } from '../../src/announcer/manifest'

loadEnv()

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb' // George - deep, energetic sports hypecaster
const DEFAULT_MODEL = 'eleven_turbo_v2_5'
const OUTPUT_FORMAT = 'mp3_44100_128'
const STABILITY = 0.5
const SIMILARITY_BOOST = 0.75
const ANNOUNCER_DIR = resolve(process.cwd(), 'public/announcer')
const MANIFEST_PATH = resolve(ANNOUNCER_DIR, 'manifest.json')

function sha1(str: string): string {
  return createHash('sha1').update(str).digest('hex')
}

function safeFilename(takeId: string, lineId: string): string {
  const safeTake = takeId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeLine = lineId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safeTake}_${safeLine}.mp3`
}

function loadManifest(voiceId: string, modelId: string): Manifest {
  if (existsSync(MANIFEST_PATH)) {
    try {
      const data = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
      if (data && data.version === MANIFEST_VERSION) {
        return data
      }
    } catch {
      /* ignore corrupt manifest and re-create */
    }
  }
  return {
    version: MANIFEST_VERSION,
    voiceId,
    modelId,
    outputFormat: OUTPUT_FORMAT,
    generatedAt: new Date().toISOString(),
    takes: {},
    lines: {},
  }
}

async function synthesizeLine(
  apiKey: string,
  voiceId: string,
  modelId: string,
  text: string
): Promise<{ buffer: Buffer; requestId?: string }> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: STABILITY,
        similarity_boost: SIMILARITY_BOOST,
      },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`ElevenLabs TTS error (${res.status}): ${errText}`)
  }

  const requestId = res.headers.get('request-id') ?? undefined
  const arrayBuf = await res.arrayBuffer()
  return { buffer: Buffer.from(arrayBuf), requestId }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] || 'generate'

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(`
Usage: npm run announcer -- [command] [options]

Commands:
  generate          Synthesize missing preset lines with ElevenLabs (default)
  status            Show status of lines in manifest and on disk

Options:
  --force           Re-synthesize even if hash matches cached file
  --dry-run         Print what would be generated without making API calls
  --group <name>    Filter by group: shared, boxing, bowling, golf, card
  --take <id>       Filter by take id (e.g. shared.results)
  --line <id>       Filter by specific line id
  --voice <id>      Use custom ElevenLabs voice id (default: ${DEFAULT_VOICE})
  --model <id>      Use custom model (default: ${DEFAULT_MODEL})
  --limit <n>       Maximum number of lines to synthesize in this run
`)
    return
  }

  const apiKey = process.env.ELEVENLABS_KEY || process.env.ELEVEN_LABS_KEY || ''
  const force = args.includes('--force')
  const dryRun = args.includes('--dry-run')

  const groupIdx = args.indexOf('--group')
  const targetGroup = groupIdx !== -1 ? (args[groupIdx + 1] as Group) : null

  const takeIdx = args.indexOf('--take')
  const targetTake = takeIdx !== -1 ? args[takeIdx + 1] : null

  const lineIdx = args.indexOf('--line')
  const targetLine = lineIdx !== -1 ? args[lineIdx + 1] : null

  const voiceIdx = args.indexOf('--voice')
  const voiceId = voiceIdx !== -1 ? args[voiceIdx + 1] : DEFAULT_VOICE

  const modelIdx = args.indexOf('--model')
  const modelId = modelIdx !== -1 ? args[modelIdx + 1] : DEFAULT_MODEL

  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity

  mkdirSync(ANNOUNCER_DIR, { recursive: true })
  const manifest = loadManifest(voiceId, modelId)

  // Filter takes
  let takesToProcess = TAKES as readonly Take[]
  if (targetGroup) {
    takesToProcess = takesToProcess.filter((t) => t.group === targetGroup)
  }
  if (targetTake) {
    takesToProcess = takesToProcess.filter((t) => t.id === targetTake)
  }

  console.log(`\n🎙️  Tempo Announcer Generator`)
  console.log(`Voice ID: ${voiceId} | Model: ${modelId}`)
  console.log(`Output: ${ANNOUNCER_DIR}\n`)

  if (command === 'status') {
    let totalLines = 0
    let cachedLines = 0
    for (const take of takesToProcess) {
      for (const [lineId] of take.lines) {
        if (targetLine && lineId !== targetLine) continue
        totalLines++
        const file = safeFilename(take.id, lineId)
        const exists = existsSync(resolve(ANNOUNCER_DIR, file))
        if (exists && manifest.lines[lineId]) cachedLines++
      }
    }
    console.log(`Status: ${cachedLines} / ${totalLines} lines cached on disk.`)
    return
  }

  if (!apiKey && !dryRun) {
    console.error(`❌ Error: ELEVENLABS_KEY is not set in .env!`)
    process.exit(1)
  }

  let generatedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const take of takesToProcess) {
    let takeChars = 0
    let takeBytes = 0
    const takeFiles: string[] = []

    for (const [lineId, text] of take.lines) {
      if (targetLine && lineId !== targetLine) continue
      if (generatedCount >= limit) {
        console.log(`\nReached limit of ${limit} lines. Stopping.`)
        break
      }

      const file = safeFilename(take.id, lineId)
      const filePath = resolve(ANNOUNCER_DIR, file)
      const lineHash = sha1(`${text}:${voiceId}:${modelId}:${STABILITY}:${SIMILARITY_BOOST}`)

      // Check if already cached and valid
      const existingLine = manifest.lines[lineId]
      const existingTake = manifest.takes[take.id]
      const fileExists = existsSync(filePath)

      if (!force && fileExists && existingLine && existingTake?.hash === lineHash) {
        skippedCount++
        continue
      }

      console.log(`[${take.group}] Synthesizing: "${lineId}" -> "${text}"`)

      if (dryRun) {
        generatedCount++
        continue
      }

      try {
        const { buffer, requestId } = await synthesizeLine(apiKey, voiceId, modelId, text)
        writeFileSync(filePath, buffer)

        takeChars += text.length
        takeBytes += buffer.byteLength
        takeFiles.push(file)

        manifest.lines[lineId] = {
          take: take.id,
          file,
          start: null,
          end: null,
        }

        generatedCount++
        console.log(`  ✓ Saved ${file} (${buffer.byteLength} bytes)`)

        // Save manifest progressively
        manifest.generatedAt = new Date().toISOString()
        manifest.voiceId = voiceId
        manifest.modelId = modelId
        manifest.takes[take.id] = {
          file: takeFiles[0] || file,
          hash: lineHash,
          seed: 42,
          stability: STABILITY,
          chars: takeChars,
          bytes: takeBytes,
          requestId,
          perLine: true,
        }
        writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8')

        // Small pause between requests to prevent rate limit throttling
        await sleep(180)
      } catch (err: unknown) {
        errorCount++
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  ✗ Error synthesizing "${lineId}": ${msg}`)
        // Continue with other lines
      }
    }
  }

  // Final manifest save
  manifest.generatedAt = new Date().toISOString()
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`\nDone! Generated: ${generatedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`)
  console.log(`Manifest updated at: ${MANIFEST_PATH}\n`)
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void runCli()
}
