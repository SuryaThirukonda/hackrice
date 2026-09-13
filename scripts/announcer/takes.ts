import { createHash } from 'node:crypto'
import { CUES, cueOf, type Take } from '../../src/announcer/lines'

/** Lines in a take are separated by a blank line, which the model reads as a clear pause. */
export const JOIN = '\n\n'

export interface TakeText {
  text: string
  /** Each line's [start, end) character offsets in `text`. */
  spans: { id: string; start: number; end: number }[]
}

export function takeText(take: Take): TakeText {
  let text = ''
  const spans: TakeText['spans'] = []
  take.lines.forEach(([id, line], i) => {
    if (i > 0) text += JOIN
    spans.push({ id, start: text.length, end: text.length + line.length })
    text += line
  })
  return { text, spans }
}

export interface HashParts { voiceId: string; modelId: string; stability: number; seed: number; format: string; text: string }

/** Identifies a take's audio: any change to the voice, model, settings, seed, format or text means a new take. */
export function takeHash(p: HashParts): string {
  return createHash('sha1').update([p.voiceId, p.modelId, JSON.stringify({ stability: p.stability }), String(p.seed), p.format, p.text].join('|')).digest('hex')
}

/** A stable seed per take, so a plain rerun reproduces the take unless a retake asks for another seed. */
export function defaultSeed(takeId: string): number {
  return parseInt(createHash('sha1').update(takeId).digest('hex').slice(0, 8), 16)
}

/** Takes holding the highest-priority lines first (stable otherwise), so a run stopped by the quota keeps the decisive calls. */
export function priorityOrder(takes: readonly Take[]): Take[] {
  const top = (t: Take): number => Math.max(...t.lines.map(([id]) => CUES[cueOf(id)]?.priority ?? 0))
  return takes.map((t, i) => ({ t, i, p: top(t) })).sort((a, b) => b.p - a.p || a.i - b.i).map((x) => x.t)
}

export interface Alignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

/**
 * Map each character of the request text to its index in the returned alignment, or null where the service returned
 * nothing for it. Audio tags it didn't echo back and whitespace differences are skipped; any other difference means
 * the alignment belongs to different text, and the result is null.
 */
export function alignIndices(text: string, chars: readonly string[]): (number | null)[] | null {
  const map: (number | null)[] = new Array<number | null>(text.length).fill(null)
  let j = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (j < chars.length && chars[j] === c) { map[i] = j++; continue }
    if (/\s/.test(c)) continue
    if (j < chars.length && /\s/.test(chars[j])) { j++; i--; continue }
    if (c === '[') { const close = text.indexOf(']', i); if (close > i) { i = close; continue } }
    if (j < chars.length && chars[j].toLowerCase() === c.toLowerCase()) { map[i] = j++; continue }
    return null
  }
  for (; j < chars.length; j++) if (!/\s/.test(chars[j])) return null
  return map
}

const spoken = (c: string): boolean => /[\p{L}\p{N}]/u.test(c)
const ms = (x: number): number => Math.round(x * 1000) / 1000

/**
 * Each line's segment in seconds: 100 ms before its first spoken character to 350 ms after its last (tags skipped),
 * clamped to the midpoint of the gap on either side. The timestamps tend to end a word early; playback trims the
 * silence this padding adds.
 */
export function segmentsFor(tt: TakeText, a: Alignment): Record<string, { start: number; end: number }> | { error: string } {
  const map = alignIndices(tt.text, a.characters)
  if (!map) return { error: 'the returned characters do not match the request text' }
  const timed: { id: string; t0: number; t1: number }[] = []
  for (const s of tt.spans) {
    let first = -1, last = -1, inTag = false
    for (let i = s.start; i < s.end; i++) {
      const c = tt.text[i]
      if (c === '[') { inTag = true; continue }
      if (c === ']') { inTag = false; continue }
      if (inTag || !spoken(c) || map[i] === null) continue
      if (first < 0) first = i
      last = i
    }
    const t0 = first < 0 ? NaN : a.character_start_times_seconds[map[first]!]
    const t1 = last < 0 ? NaN : a.character_end_times_seconds[map[last]!]
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return { error: `line ${s.id} has no timed characters` }
    timed.push({ id: s.id, t0, t1 })
  }
  const out: Record<string, { start: number; end: number }> = {}
  timed.forEach((r, i) => {
    const prev = timed[i - 1], next = timed[i + 1]
    const lo = prev ? (prev.t1 + r.t0) / 2 : 0
    const hi = next ? (r.t1 + next.t0) / 2 : Infinity
    out[r.id] = { start: ms(Math.max(lo, r.t0 - 0.1, 0)), end: ms(Math.min(hi, r.t1 + 0.35)) }
  })
  return out
}
