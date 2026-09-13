import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { takeHash, takeText } from '../../scripts/announcer/takes'
import { DEFAULT_MAX_CHARS } from '../../scripts/announcer/voice'
import { AUDIO_TAGS, CUES, NAME_KEYS, PERSONA_KEYS, SIDE_KEYS, TAKES, allLineIds, cueOf } from './lines'
import type { Manifest } from './manifest'

describe('announcer catalogue', () => {
  it('gives every cue at least one line, and every line a cue', () => {
    for (const [id, cue] of Object.entries(CUES)) expect(cue.lines.length, id).toBeGreaterThan(0)
    for (const line of allLineIds()) expect(CUES[cueOf(line)], line).toBeDefined()
  })

  it('uses each line id once', () => {
    const ids = allLineIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has every per-name line and the cues the scenes say directly', () => {
    const needed = [
      ...NAME_KEYS.flatMap((k) => [`win.${k}`, `down.${k}`, `round.won.${k}`]),
      ...PERSONA_KEYS.flatMap((k) => [`corner.blue.${k}`, `corner.red.${k}`]),
      ...SIDE_KEYS.map((k) => `golf.won.${k}`),
      ...Array.from({ length: 10 }, (_, i) => `count.${i + 1}`),
      'menu.welcome', 'card.lobby', 'card.bets.next', 'card.bets.closing', 'card.payout.won', 'card.payout.lost',
    ]
    for (const cue of needed) expect(CUES[cue]?.lines.length ?? 0, cue).toBeGreaterThan(0)
  })

  it('spells numbers out, uses only known audio tags, and keeps lines short', () => {
    for (const t of TAKES) for (const [id, text] of t.lines) {
      expect(text, id).not.toMatch(/\d/)
      for (const tag of text.match(/\[[^\]]*\]/g) ?? []) expect(AUDIO_TAGS, `${id} ${tag}`).toContain(tag)
      expect(text.length, id).toBeLessThanOrEqual(120)
    }
  })

  it('can be regenerated in full within one month of the free plan', () => {
    // Two runs at the default --max-chars: 9,000 of the plan's 10,000 monthly credits.
    const total = TAKES.reduce((n, t) => n + takeText(t).text.length, 0)
    expect(total).toBeLessThanOrEqual(2 * DEFAULT_MAX_CHARS)
  })
})

const dir = resolve(import.meta.dirname, '../../public/announcer')
const manifestPath = resolve(dir, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest : null

describe.skipIf(!manifest)('committed announcer audio', () => {
  it('has every take, generated from the catalogue text as it is now', () => {
    const m = manifest!
    for (const t of TAKES) {
      const entry = m.takes[t.id]
      expect(entry, `${t.id} is missing: npm run announcer -- generate --only ${t.id}`).toBeDefined()
      const hash = takeHash({ voiceId: m.voiceId, modelId: m.modelId, stability: entry.stability, seed: entry.seed, format: m.outputFormat, text: takeText(t).text })
      expect(entry.hash, `${t.id} changed since it was generated: npm run announcer -- generate --only ${t.id}`).toBe(hash)
    }
  })

  it('has a segment and a file for every line', () => {
    const m = manifest!
    for (const id of allLineIds()) {
      const line = m.lines[id]
      expect(line, id).toBeDefined()
      const file = line.file ?? m.takes[line.take]?.file
      expect(file && existsSync(resolve(dir, file)), `${id}: ${file}`).toBe(true)
    }
  })

  it('keeps every count digit short enough to land on its one-second beat', () => {
    // A segment holds the spoken digit plus up to 0.45 s of padding that playback trims.
    for (let n = 1; n <= 10; n++) {
      const line = manifest!.lines[`count.${n}`]
      if (line.start !== null && line.end !== null) expect(line.end - line.start, `count.${n}`).toBeLessThanOrEqual(1.4)
    }
  })
})
