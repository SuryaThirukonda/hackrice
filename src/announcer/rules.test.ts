import { describe, expect, it } from 'vitest'
import type { Priority } from './lines'
import { BEAT_FADE_MS, COLOUR, INTERRUPT_FADE_MS, SpeechRules, VariantPicker, requestFor, type Decision, type RuleLog, type Speech, type SpeechRequest } from './rules'

const req = (priority: Priority, extra: Partial<SpeechRequest> = {}): SpeechRequest =>
  ({ cues: [`cue.p${priority}`], priority, beat: false, staleMs: priority === 5 ? 4000 : 2000, cooldownMs: 0, ...extra })
const beat = (cue: string): SpeechRequest => req(5, { cues: [cue], beat: true })
function played(d: Decision): Speech {
  if (d.kind !== 'play') throw new Error(`expected play, got ${d.kind}`)
  return d.speech
}
function rules(): { r: SpeechRules; log: [RuleLog, string][] } {
  const log: [RuleLog, string][] = []
  const r = new SpeechRules((kind, s) => log.push([kind, s.cues.join('+')]))
  r.reset(0)
  return { r, log }
}

describe('SpeechRules', () => {
  it('starts a call at once when the voice is silent', () => {
    const { r } = rules()
    expect(r.request(req(3), 5000)).toMatchObject({ kind: 'play', cutMs: null })
  })

  it('lets only a higher priority interrupt, with a fade, and keeps the queued call', () => {
    const { r } = rules()
    played(r.request(req(3), 5000))
    expect(r.request(req(3, { cues: ['queued'] }), 5100)).toEqual({ kind: 'queue' })
    expect(r.request(req(4), 5200)).toMatchObject({ kind: 'play', cutMs: INTERRUPT_FADE_MS })
    expect(r.pending?.cues).toEqual(['queued'])
  })

  it('keeps one pending call: an equal or higher newcomer replaces it, a lower one is dropped', () => {
    const { r, log } = rules()
    played(r.request(req(4), 5000))
    r.request(req(3, { cues: ['first'] }), 5100)
    expect(r.request(req(2, { cues: ['lower'] }), 5200)).toEqual({ kind: 'drop', reason: 'lower' })
    expect(r.request(req(3, { cues: ['second'] }), 5300)).toEqual({ kind: 'queue' })
    expect(r.pending?.cues).toEqual(['second'])
    expect(log).toContainEqual(['replaced', 'first'])
  })

  it('plays the pending call when the current one ends, unless it has gone stale', () => {
    const { r, log } = rules()
    const a = played(r.request(req(4), 5000))
    r.request(req(3, { cues: ['next'] }), 5500)
    expect(r.finished(a, 7000)?.cues).toEqual(['next'])

    const b = played(r.request(req(4), 10_000))
    r.request(req(3, { cues: ['late'] }), 10_000)
    expect(r.finished(b, 12_100)).toBeNull()
    expect(r.pending).toBeNull()
    expect(log).toContainEqual(['stale', 'late'])
  })

  it('gives a decisive call four seconds before it goes stale', () => {
    const { r } = rules()
    const a = played(r.request(req(5), 5000))
    r.request(req(5, { cues: ['winner'] }), 5000)
    expect(r.finished(a, 8500)?.cues).toEqual(['winner'])
  })

  it('ignores the end of a call that was already cut', () => {
    const { r } = rules()
    const a = played(r.request(req(3), 5000))
    const b = played(r.request(req(4), 5100))
    expect(r.finished(a, 5200)).toBeNull()
    expect(r.playing).toBe(b)
  })

  it('starts count digits on the beat, cutting lower calls and digits, but never the knockdown call', () => {
    const { r } = rules()
    const down = played(r.request(req(5, { cues: ['down.house'] }), 5000))
    expect(r.request(beat('count.1'), 6000)).toEqual({ kind: 'skip' })
    r.finished(down, 6200)
    expect(r.request(beat('count.2'), 7000)).toMatchObject({ kind: 'play', cutMs: null })
    expect(r.request(beat('count.3'), 7900)).toMatchObject({ kind: 'play', cutMs: BEAT_FADE_MS })
    expect(r.request(req(4, { cues: ['boxing.getup'] }), 8000)).toEqual({ kind: 'queue' })

    const { r: r2 } = rules()
    played(r2.request(req(3), 5000))
    expect(r2.request(beat('count.1'), 5100)).toMatchObject({ kind: 'play', cutMs: BEAT_FADE_MS })
  })

  it('lets the knockout call replace a count digit on the tenth beat, while lower calls still wait for the digit', () => {
    const { r } = rules()
    played(r.request(beat('count.9'), 5000))
    expect(r.request(req(5, { cues: ['count.10', 'boxing.ko', 'win.house'] }), 6000)).toMatchObject({ kind: 'play', cutMs: BEAT_FADE_MS })

    const { r: r2 } = rules()
    played(r2.request(beat('count.8'), 5000))
    expect(r2.request(req(4, { cues: ['boxing.getup'] }), 5000)).toEqual({ kind: 'queue' })
  })

  it('makes minor calls wait for silence and respect their cooldown', () => {
    const { r } = rules()
    const a = played(r.request(req(3), 5000))
    r.finished(a, 6000)
    const cross = req(2, { cues: ['boxing.cross'], cooldownMs: 15_000 })
    expect(r.request(cross, 6500)).toEqual({ kind: 'queue' })
    expect(r.tick(6900)).toBeNull()
    const started = r.tick(7300)
    expect(started?.cues).toEqual(['boxing.cross'])
    r.finished(started!, 8000)
    expect(r.request(cross, 10_000)).toEqual({ kind: 'drop', reason: 'cooldown' })
    expect(r.request(cross, 22_400)).toMatchObject({ kind: 'play' })
  })

  it('clears everything on pause, refuses calls while paused, and replays nothing on resume', () => {
    const { r, log } = rules()
    played(r.request(req(4), 5000))
    r.request(req(3, { cues: ['waiting'] }), 5100)
    r.pause()
    expect(r.playing).toBeNull()
    expect(r.pending).toBeNull()
    expect(log).toContainEqual(['cleared', 'waiting'])
    expect(r.request(req(5), 5200)).toEqual({ kind: 'drop', reason: 'paused' })
    r.resume(9000)
    expect(r.tick(9100)).toBeNull()
    expect(r.request(req(3), 9200)).toMatchObject({ kind: 'play' })
  })

  it('allows colour only in live play, after long silence, spaced out, within the match budget', () => {
    const { r } = rules()
    expect(r.colourReady(COLOUR.silenceMs - 1, true)).toBe(false)
    expect(r.colourReady(COLOUR.silenceMs, false)).toBe(false)
    expect(r.colourReady(COLOUR.silenceMs, true)).toBe(true)
    let t = COLOUR.silenceMs
    const first = played(r.request(req(1), t))
    r.finished(first, t + 1000)
    expect(r.colourReady(t + 1000 + COLOUR.silenceMs, true)).toBe(false) // too soon after the last colour line
    for (let i = 1; i < COLOUR.perMatch; i++) {
      t += COLOUR.spacingMs + 1000
      expect(r.colourReady(t, true)).toBe(true)
      r.finished(played(r.request(req(1), t)), t + 1000)
    }
    expect(r.colourReady(t + 10 * COLOUR.spacingMs, true)).toBe(false)
  })
})

describe('requestFor', () => {
  it('reads priority, beat, cooldown and the stale window from the catalogue', () => {
    expect(requestFor(['count.3'])).toMatchObject({ priority: 5, beat: true, staleMs: 4000, cooldownMs: 0 })
    expect(requestFor(['boxing.cross'])).toMatchObject({ priority: 2, beat: false, staleMs: 2000, cooldownMs: 15_000 })
    expect(requestFor(['card.payout.won'])).toMatchObject({ priority: 3, staleMs: 3000 })
  })

  it('gives a sequence its highest priority and never a beat or a cooldown', () => {
    expect(requestFor(['count.10', 'boxing.ko', 'win.you'])).toMatchObject({ priority: 5, beat: false, cooldownMs: 0 })
    expect(requestFor(['corner.blue.lou', 'corner.red.maggie', 'card.bets.open'])).toMatchObject({ priority: 4, staleMs: 2000 })
  })

  it('leaves out unknown cues', () => {
    expect(requestFor(['no.such.cue'])).toBeNull()
    expect(requestFor(['no.such.cue', 'draw'])?.cues).toEqual(['draw'])
  })
})

describe('VariantPicker', () => {
  it('never repeats a variant twice in a row', () => {
    const picker = new VariantPicker(() => 0)
    const lines = ['a#1', 'a#2', 'a#3']
    let prev = ''
    for (let i = 0; i < 20; i++) {
      const line = picker.pick('a', lines)!
      expect(line).not.toBe(prev)
      prev = line
    }
  })

  it('plays every variant once before repeating any', () => {
    let seed = 7
    const picker = new VariantPicker(() => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 })
    const lines = ['c#1', 'c#2', 'c#3', 'c#4']
    for (let round = 0; round < 5; round++) expect(new Set(Array.from({ length: 4 }, () => picker.pick('c', lines))).size).toBe(4)
  })

  it('returns the only line every time, and null for no lines', () => {
    const picker = new VariantPicker(() => 0.99)
    expect(picker.pick('b', ['b'])).toBe('b')
    expect(picker.pick('b', ['b'])).toBe('b')
    expect(picker.pick('c', [])).toBeNull()
  })
})
