import Phaser from 'phaser'
import { loadSettings } from '../agent/sliders'
import { Captions, SPORT_CAPTIONS, type CaptionPlace } from '../ui/captions'
import { createMap, type Perspective, type Sport, type SportMap, type SportTypes } from './director'
import { CUES, captionText, cueOf, lineText, type Group } from './lines'
import { SpeechRules, VariantPicker, requestFor, type Speech } from './rules'
import { voice, type PlayHandle } from './voice'

export { personaKey, type Perspective, type Sport } from './director'
export { LOBBY_CAPTIONS, MENU_CAPTIONS, SPORT_CAPTIONS } from '../ui/captions'

type EventOf<S> = S extends Sport ? SportTypes[S]['event'] : never
type CtxOf<S> = S extends Sport ? SportTypes[S]['ctx'] : never
type ViewOf<S> = S extends Sport ? SportTypes[S]['view'] : never

export interface AnnouncerOptions<S extends Sport | 'menu'> {
  sport: S
  perspective?: Perspective
  /** Practice modes stay silent. */
  practice?: boolean
  place?: CaptionPlace
  /** False: voice only, even when captions are on in settings. */
  captions?: boolean
}

export interface AnnouncerLogEntry { at: number; cue: string; line?: string; kind: 'play' | 'caption' | 'cut' | 'skip' | 'drop' | 'queue' | 'stale' | 'cleared' | 'replaced'; reason?: string }

const LINE_GAP_MS = 150
const CAPTION_MS_PER_CHAR = 60
const CAPTION_MIN_MS = 1200
const PAUSE_FADE_MS = 120
const now = (): number => performance.now()

interface Playing { speech: Speech; lines: string[]; index: number; handle: PlayHandle | null; endsAt: number | null; waiting: boolean; gapUntil: number | null }

const devLog: AnnouncerLogEntry[] = []
let active: Announcer<Sport | 'menu'> | null = null
function log(entry: AnnouncerLogEntry): void {
  if (!import.meta.env.DEV) return
  devLog.push(entry)
  if (devLog.length > 500) devLog.splice(0, devLog.length - 500)
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Dev hook for verification: the call log, a way to trigger a cue, and each line's audio status.
  (window as unknown as { __announcer?: unknown }).__announcer = { log: devLog, say: (cue: string) => active?.say(cue), status: (line: string) => voice.status(line), duration: (line: string) => voice.duration(line) }
}

function groupsFor(sport: Sport | 'menu', p: Perspective | undefined): Group[] {
  if (sport === 'menu') return ['shared']
  if (sport === 'boxing') return p?.mode === 'card' ? ['shared', 'boxing', 'card'] : ['shared', 'boxing']
  return ['shared', sport]
}

/**
 * The spoken announcer a scene owns for one match (or one menu visit). The scene feeds it sim events, snapshots and a
 * few direct cues; the sport map turns them into calls, the speaking rules decide what plays, and the voice player
 * and caption strip deliver them. It follows the scene's own pause, resume and shutdown events.
 */
export class Announcer<S extends Sport | 'menu'> {
  private static readonly spoken = new Set<string>()
  private readonly scene: Phaser.Scene
  private readonly enabled: boolean
  private readonly map: SportMap<unknown, unknown, unknown> | null
  private readonly rules: SpeechRules
  /** Shared by every announcer in the session, so a new match carries on through the variants instead of starting over. */
  private static readonly sharedPicker = new VariantPicker()
  private readonly picker = Announcer.sharedPicker
  private readonly captions: Captions | null
  private current: Playing | null = null
  private gamePaused = false
  private scenePaused = false
  private liveUntil = 0
  private destroyed = false

  constructor(scene: Phaser.Scene, opts: AnnouncerOptions<S>) {
    this.scene = scene
    const settings = loadSettings()
    this.enabled = settings.announcer && !opts.practice
    this.rules = new SpeechRules((kind, s) => log({ at: now(), cue: s.cues.join('+'), kind }))
    this.map = this.enabled && opts.sport !== 'menu'
      ? createMap(opts.sport as Sport, opts.perspective ?? { mode: '1p' }) as unknown as SportMap<unknown, unknown, unknown>
      : null
    this.captions = this.enabled && settings.captions && opts.captions !== false ? new Captions(scene, opts.place ?? SPORT_CAPTIONS) : null
    if (!this.enabled) return
    voice.setVolume(settings.announcerVolume)
    voice.load(groupsFor(opts.sport, opts.perspective))
    this.rules.reset(now())
    const ev = scene.events
    ev.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this)
    ev.on(Phaser.Scenes.Events.PAUSE, this.onScenePause, this)
    ev.on(Phaser.Scenes.Events.RESUME, this.onSceneResume, this)
    ev.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
    active = this as Announcer<Sport | 'menu'>
  }

  /** Say `cue` once per page load, from a menu scene. */
  static once(scene: Phaser.Scene, cue: string, place: CaptionPlace): void {
    if (Announcer.spoken.has(cue)) return
    Announcer.spoken.add(cue)
    new Announcer(scene, { sport: 'menu', place }).say(cue)
  }

  /** Play one cue with no caption, at the saved volume (the settings volume row). Destroy it to cut it short. */
  static sample(scene: Phaser.Scene, cue: string): Announcer<'menu'> {
    const a = new Announcer(scene, { sport: 'menu', captions: false })
    a.say(cue)
    return a
  }

  /** The match is on screen. */
  start(): void { if (this.map) for (const call of this.map.start()) this.request(call) }

  /** One sim event; `ctx` is read only when the event needs it. */
  event(e: EventOf<S>, ctx: () => CtxOf<S>): void { if (this.map) for (const call of this.map.event(e, ctx)) this.request(call) }

  /** The latest snapshot, once per rendered frame while play runs. */
  frame(view: ViewOf<S>): void {
    if (!this.map) return
    if (this.map.live(view)) this.liveUntil = now() + 250
    for (const call of this.map.frame(view)) this.request(call)
  }

  /** A direct cue from the scene (betting windows, payouts, menus). */
  say(cue: string): void { if (this.enabled && !this.destroyed) this.request([cue]) }

  /** The scene's own pause menu opened or closed. */
  pause(on: boolean): void { this.gamePaused = on; this.syncPause() }

  layout(W: number, H: number): void { this.captions?.layout(W, H) }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stopCurrent(40)
    const ev = this.scene.events
    ev.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this)
    ev.off(Phaser.Scenes.Events.PAUSE, this.onScenePause, this)
    ev.off(Phaser.Scenes.Events.RESUME, this.onSceneResume, this)
    ev.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this)
    this.captions?.destroy()
    if (active === (this as Announcer<Sport | 'menu'>)) active = null
  }

  private request(cues: readonly string[]): void {
    const req = requestFor(cues)
    if (!req || this.destroyed) return
    const t = now()
    const d = this.rules.request(req, t)
    if (d.kind === 'play') this.begin(d.speech, d.cutMs, t)
    else log({ at: t, cue: req.cues.join('+'), kind: d.kind, reason: d.kind === 'drop' ? d.reason : undefined })
  }

  private begin(speech: Speech, cutMs: number | null, t: number): void {
    if (this.current) { log({ at: t, cue: this.current.speech.cues.join('+'), kind: 'cut' }); this.stopCurrent(cutMs ?? 0) }
    const lines = speech.cues.map((c) => this.picker.pick(c, CUES[c]?.lines ?? [])).filter((l): l is string => !!l)
    this.current = { speech, lines, index: 0, handle: null, endsAt: null, waiting: false, gapUntil: null }
    this.playLine(t)
  }

  private playLine(t: number): void {
    const cur = this.current
    if (!cur) return
    const line = cur.lines[cur.index]
    if (!line) { this.end(t); return }
    const status = voice.status(line)
    // Wait for audio that is still decoding, within the call's stale window; a count digit never waits.
    if (status === 'loading' && !cur.speech.beat && t - cur.speech.at < cur.speech.staleMs) { cur.waiting = true; return }
    cur.waiting = false
    const text = captionText(lineText(line) ?? '')
    const index = cur.index
    const handle = status === 'ready' ? voice.play(line, () => this.lineDone(cur, index)) : null
    cur.handle = handle
    // Audio ends through its callback; for audio the timer is only a backstop in case the audio clock stalls.
    cur.endsAt = t + (handle ? (voice.duration(line) ?? 3) * 1000 + 1000 : Math.max(CAPTION_MIN_MS, text.length * CAPTION_MS_PER_CHAR))
    this.captions?.show(text)
    log({ at: t, cue: cueOf(line), line, kind: handle ? 'play' : 'caption' })
  }

  private lineDone(cur: Playing, index: number): void {
    if (this.current !== cur || cur.index !== index || this.destroyed) return
    cur.handle?.stop(40)
    cur.handle = null; cur.endsAt = null; cur.index++
    const t = now()
    if (cur.index < cur.lines.length) cur.gapUntil = t + LINE_GAP_MS
    else this.end(t)
  }

  private end(t: number): void {
    const cur = this.current
    if (!cur) return
    this.current = null
    this.captions?.hide(400)
    const next = this.rules.finished(cur.speech, t)
    if (next) this.begin(next, null, t)
  }

  private onUpdate(): void {
    if (this.destroyed || this.rules.paused) return
    const t = now()
    const cur = this.current
    if (cur) {
      if (cur.gapUntil !== null) { if (t >= cur.gapUntil) { cur.gapUntil = null; this.playLine(t) } }
      else if (cur.waiting) this.playLine(t)
      else if (cur.endsAt !== null && t >= cur.endsAt) this.lineDone(cur, cur.index)
      return
    }
    const next = this.rules.tick(t)
    if (next) this.begin(next, null, t)
    else if (this.map && this.rules.colourReady(t, t < this.liveUntil)) this.request([this.map.colour])
  }

  private onScenePause(): void { this.scenePaused = true; this.syncPause() }
  private onSceneResume(): void { this.scenePaused = false; this.syncPause() }

  private syncPause(): void {
    const on = this.gamePaused || this.scenePaused
    if (!this.enabled || this.destroyed || on === this.rules.paused) return
    if (on) { this.stopCurrent(PAUSE_FADE_MS); this.captions?.clear(); this.rules.pause() }
    else this.rules.resume(now())
  }

  private stopCurrent(fadeMs: number): void {
    const cur = this.current
    if (!cur) return
    cur.handle?.stop(fadeMs)
    this.current = null
  }
}
