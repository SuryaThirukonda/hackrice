import { CUES, type Cue, type Priority } from './lines'

/**
 * Speaking rules for one announcer: a single voice, priorities, one pending call, staleness, cooldowns and colour
 * pacing. Pure: the caller passes the clock in milliseconds and plays whatever the rules start.
 */
export interface SpeechRequest {
  readonly cues: readonly string[]
  readonly priority: Priority
  /** Starts on its event and never queues (the knockdown count). */
  readonly beat: boolean
  readonly staleMs: number
  readonly cooldownMs: number
}
export interface Speech extends SpeechRequest { readonly at: number }
export type Decision =
  | { kind: 'play'; speech: Speech; cutMs: number | null }
  | { kind: 'queue' }
  | { kind: 'drop'; reason: 'paused' | 'cooldown' | 'lower' }
  | { kind: 'skip' }
export type RuleLog = 'replaced' | 'stale' | 'cleared'

export const INTERRUPT_FADE_MS = 80
export const BEAT_FADE_MS = 40
/** Silence a minor or colour line waits for after the last line ends. */
export const MINOR_GAP_MS = 1200
export const COLOUR = { silenceMs: 12_000, spacingMs: 30_000, perMatch: 4 } as const

export class SpeechRules {
  private playingNow: Speech | null = null
  private pendingNow: Speech | null = null
  private lastEnded = 0
  private readonly lastStart = new Map<string, number>()
  private pausedNow = false
  private colours = 0
  private lastColour = -Infinity

  private readonly onLog: (kind: RuleLog, s: Speech) => void
  constructor(onLog: (kind: RuleLog, s: Speech) => void = () => {}) { this.onLog = onLog }

  get playing(): Speech | null { return this.playingNow }
  get pending(): Speech | null { return this.pendingNow }
  get paused(): boolean { return this.pausedNow }

  /** A new match: silence counts from now, cooldowns and the colour budget reset. */
  reset(now: number): void {
    this.playingNow = null; this.pendingNow = null; this.lastEnded = now; this.lastStart.clear()
    this.pausedNow = false; this.colours = 0; this.lastColour = -Infinity
  }

  request(req: SpeechRequest, now: number): Decision {
    if (this.pausedNow) return { kind: 'drop', reason: 'paused' }
    if (req.cooldownMs > 0) {
      const t = this.lastStart.get(req.cues[0])
      if (t !== undefined && now - t < req.cooldownMs) return { kind: 'drop', reason: 'cooldown' }
    }
    const s: Speech = { ...req, at: now }
    const cur = this.playingNow
    if (req.beat) {
      // A digit never cuts the decisive call that started the count; it is skipped instead.
      if (cur && cur.priority === 5 && !cur.beat) return { kind: 'skip' }
      return this.start(s, now, cur ? BEAT_FADE_MS : null)
    }
    if (!cur) return req.priority <= 2 && now - this.lastEnded < MINOR_GAP_MS ? this.hold(s) : this.start(s, now, null)
    if (req.priority > cur.priority) return this.start(s, now, INTERRUPT_FADE_MS)
    return this.hold(s)
  }

  /** The playing speech ended on its own. Returns the next speech to start now, if one is due. */
  finished(speech: Speech, now: number): Speech | null {
    if (this.playingNow !== speech) return null
    this.playingNow = null; this.lastEnded = now
    return this.next(now)
  }

  /** Call every frame: starts a held call once it is due, drops it once it is stale. */
  tick(now: number): Speech | null { return this.playingNow || this.pausedNow ? null : this.next(now) }

  /** Pausing fades out and clears everything; nothing replays on resume. */
  pause(): void {
    this.pausedNow = true; this.playingNow = null
    if (this.pendingNow) { this.onLog('cleared', this.pendingNow); this.pendingNow = null }
  }
  resume(now: number): void { this.pausedNow = false; this.lastEnded = now }

  /** True when a colour line may start: live play, long silence, spaced out and within the match budget. */
  colourReady(now: number, live: boolean): boolean {
    return live && !this.pausedNow && !this.playingNow && !this.pendingNow && now - this.lastEnded >= COLOUR.silenceMs
      && now - this.lastColour >= COLOUR.spacingMs && this.colours < COLOUR.perMatch
  }

  private hold(s: Speech): Decision {
    const p = this.pendingNow
    if (p && s.priority < p.priority) return { kind: 'drop', reason: 'lower' }
    if (p) this.onLog('replaced', p)
    this.pendingNow = s
    return { kind: 'queue' }
  }

  private start(s: Speech, now: number, cutMs: number | null): Decision {
    this.playingNow = s
    for (const c of s.cues) this.lastStart.set(c, now)
    if (s.priority === 1) { this.colours++; this.lastColour = now }
    return { kind: 'play', speech: s, cutMs }
  }

  private next(now: number): Speech | null {
    const p = this.pendingNow
    if (!p || this.pausedNow) return null
    if (now - p.at > p.staleMs) { this.pendingNow = null; this.onLog('stale', p); return null }
    if (p.priority <= 2 && now - this.lastEnded < MINOR_GAP_MS) return null
    this.pendingNow = null
    const d = this.start(p, now, null)
    return d.kind === 'play' ? d.speech : null
  }
}

/**
 * The request for a call made of one or more cues. A sequence takes its highest priority and the longest stale
 * window; only a single cue carries a beat or a cooldown. Unknown cues are left out; null when none remain.
 */
export function requestFor(cues: readonly string[], catalogue: Readonly<Record<string, Cue>> = CUES): SpeechRequest | null {
  const known = cues.filter((c) => (catalogue[c]?.lines.length ?? 0) > 0)
  if (known.length === 0) return null
  const defs = known.map((c) => catalogue[c])
  const priority = Math.max(...defs.map((d) => d.priority)) as Priority
  const single = defs.length === 1 ? defs[0] : null
  const staleS = Math.max(...defs.map((d) => d.staleS ?? (priority === 5 ? 4 : 2)))
  const cooldownS = single ? (single.cooldownS ?? (single.priority === 2 ? 15 : 0)) : 0
  return { cues: known, priority, beat: !!single?.beat, staleMs: staleS * 1000, cooldownMs: cooldownS * 1000 }
}

/** Picks a variant line for a cue, never the same line twice in a row when the cue has more than one. */
export class VariantPicker {
  private readonly last = new Map<string, string>()
  private readonly random: () => number
  constructor(random: () => number = Math.random) { this.random = random }
  pick(cue: string, lines: readonly string[]): string | null {
    if (lines.length === 0) return null
    const prev = this.last.get(cue)
    const options = lines.length > 1 && prev !== undefined ? lines.filter((l) => l !== prev) : lines
    const line = options[Math.min(options.length - 1, Math.floor(this.random() * options.length))]
    this.last.set(cue, line)
    return line
  }
}
