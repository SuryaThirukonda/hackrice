import { sfx } from '../fx/sfx'
import { TAKES, type Group } from './lines'
import { MANIFEST_VERSION, lineFile, takeFiles, type Manifest } from './manifest'
import { audibleSpan, frameLevels, lineWindows } from './segments'

export type LineStatus = 'ready' | 'loading' | 'missing'
export interface PlayHandle { stop(fadeMs: number): void }

const BASE = `${import.meta.env.BASE_URL ?? '/'}announcer/`

/**
 * The announcer's voice for the whole session: loads the committed manifest and the takes each scene needs, decodes
 * them once audio is unlocked, and plays a line's trimmed segment on a voice gain node while ducking game sound.
 * Anything missing (no manifest, a failed fetch or decode, audio still locked) reports 'missing', and the
 * announcer shows captions only.
 */
class Voice {
  private manifest: Promise<Manifest | null> | null = null
  private loaded: Manifest | null = null
  private failed = false
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>()
  private readonly buffers = new Map<string, AudioBuffer | null>()
  /** Loudness per 10 ms frame of each decoded file, for finding pauses and trimming silence. */
  private readonly levels = new Map<string, Float32Array>()
  /** Each line's window in its take once the cuts between lines are moved into real pauses. */
  private readonly windows = new Map<string, [number, number]>()
  private readonly trims = new Map<string, [number, number]>()
  private output: GainNode | null = null
  private volume = 0.9
  private speaking = 0
  private undock: ReturnType<typeof setTimeout> | null = null
  /** Dev only: `?voice=captions` pretends no clip exists, to check captions-only mode. */
  readonly captionsOnly = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('voice') === 'captions'

  /** Start fetching the manifest and every take in `groups`. Safe to call repeatedly. */
  load(groups: readonly Group[]): void {
    if (this.captionsOnly) return
    void this.fetchManifest().then((m) => {
      if (!m) return
      for (const t of TAKES) if (groups.includes(t.group)) for (const file of takeFiles(m, t.id)) this.fetchFile(file)
    })
  }

  status(lineId: string): LineStatus {
    if (this.captionsOnly || this.failed) return 'missing'
    if (!this.loaded) return this.manifest ? 'loading' : 'missing'
    const file = lineFile(this.loaded, lineId)
    if (!file) return 'missing'
    if (!this.bytes.has(file)) this.fetchFile(file)
    const ctx = sfx.context()
    if (!ctx) return 'missing'
    // A suspended context plays nothing and never ends a clip: caption this line and try to wake audio for the next.
    if (ctx.state !== 'running') { void ctx.resume().catch(() => {}); return 'missing' }
    const buf = this.buffers.get(file)
    return buf === undefined ? 'loading' : buf ? 'ready' : 'missing'
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    if (this.output) this.output.gain.value = this.volume
  }

  /** Seconds of audio a ready line plays after trimming, or null. */
  duration(lineId: string): number | null {
    const hit = this.segment(lineId)
    return hit ? hit.to - hit.from : null
  }

  /** Play a ready line. `onEnd` runs when it finishes on its own, not when stopped. Null when it can't play. */
  play(lineId: string, onEnd: () => void): PlayHandle | null {
    const ctx = sfx.context(), hit = this.segment(lineId)
    if (!ctx || !hit || hit.to - hit.from < 0.05) return null
    const src = ctx.createBufferSource(), gain = ctx.createGain()
    src.buffer = hit.buf; src.connect(gain); gain.connect(this.out(ctx))
    let done = false
    src.onended = () => { if (done) return; done = true; this.release(); onEnd() }
    this.duckStart()
    const t0 = ctx.currentTime, len = hit.to - hit.from
    // A 20 ms fade at the end, so a segment that ends on a quiet but audible sample doesn't click.
    gain.gain.setValueAtTime(1, t0); gain.gain.setValueAtTime(1, t0 + Math.max(0, len - 0.02)); gain.gain.linearRampToValueAtTime(0, t0 + len)
    src.start(t0, hit.from, len)
    return {
      stop: (fadeMs) => {
        if (done) return
        done = true; this.release()
        const t = ctx.currentTime, end = t + Math.max(0.005, fadeMs / 1000)
        gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, end)
        try { src.stop(end + 0.01) } catch { /* already stopped */ }
      },
    }
  }

  private segment(lineId: string): { buf: AudioBuffer; from: number; to: number } | null {
    const m = this.loaded, line = m?.lines[lineId]
    const file = m ? lineFile(m, lineId) : null
    const buf = file ? this.buffers.get(file) : null
    const levels = file ? this.levels.get(file) : undefined
    if (!line || !buf || !levels) return null
    let span = this.trims.get(lineId)
    if (!span) {
      const w = this.windows.get(lineId)
      span = audibleSpan(levels, buf.duration, w ? w[0] : line.start, w ? w[1] : line.end)
      this.trims.set(lineId, span)
    }
    return { buf, from: span[0], to: span[1] }
  }

  private fetchManifest(): Promise<Manifest | null> {
    this.manifest ??= fetch(`${BASE}manifest.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null)
      .then((m) => {
        this.loaded = m && m.version === MANIFEST_VERSION && m.lines && m.takes ? m : null
        this.failed = !this.loaded
        return this.loaded
      })
    return this.manifest
  }

  private fetchFile(file: string): void {
    if (this.bytes.has(file)) return
    this.bytes.set(file, fetch(`${BASE}${file}`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null))
    sfx.onUnlock((ctx) => { void this.decode(ctx, file) })
  }

  private async decode(ctx: AudioContext, file: string): Promise<void> {
    if (this.buffers.has(file)) return
    const data = await this.bytes.get(file)
    let buf: AudioBuffer | null = null
    if (data) { try { buf = await ctx.decodeAudioData(data.slice(0)) } catch { buf = null } }
    if (buf) {
      const levels = frameLevels(buf.getChannelData(0), buf.sampleRate)
      this.levels.set(file, levels)
      this.snap(file, buf.duration, levels)
    }
    this.buffers.set(file, buf)
  }

  /** The manifest's segments come from timestamps that can run early: move each cut between a take's lines into a real pause. */
  private snap(file: string, duration: number, levels: Float32Array): void {
    const m = this.loaded
    if (!m) return
    for (const take of TAKES) {
      const entry = m.takes[take.id]
      if (!entry || entry.perLine || entry.file !== file) continue
      const ids = take.lines.map(([id]) => id)
      const segs = ids.map((id) => m.lines[id])
      if (segs.some((s) => !s || s.start === null || s.end === null)) continue
      const estimates = segs.slice(0, -1).map((s, k) => (s.end! + segs[k + 1].start!) / 2)
      const windows = lineWindows(levels, duration, estimates)
      if (windows) ids.forEach((id, k) => this.windows.set(id, windows[k]))
    }
  }

  private out(ctx: AudioContext): GainNode {
    if (!this.output) { this.output = ctx.createGain(); this.output.gain.value = this.volume; this.output.connect(ctx.destination) }
    return this.output
  }

  private duckStart(): void {
    if (this.undock) { clearTimeout(this.undock); this.undock = null }
    if (++this.speaking === 1) sfx.duck(true)
  }

  private release(): void {
    this.speaking = Math.max(0, this.speaking - 1)
    if (this.speaking > 0) return
    this.undock = setTimeout(() => { this.undock = null; if (this.speaking === 0) sfx.duck(false) }, 150)
  }
}

export const voice = new Voice()
