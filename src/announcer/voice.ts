import { sfx } from '../fx/sfx'
import { TAKES, type Group } from './lines'
import { MANIFEST_VERSION, lineFile, takeFiles, type Manifest } from './manifest'

export type LineStatus = 'ready' | 'loading' | 'missing'
export interface PlayHandle { stop(fadeMs: number): void }

const BASE = `${import.meta.env.BASE_URL ?? '/'}announcer/`
/** −45 dBFS: quieter samples at a segment's edges count as silence. */
const SILENCE = 10 ** (-45 / 20)
/** Kept either side of the audible span so soft consonants survive trimming. */
const EDGE_PAD_S = 0.02

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
    if (!sfx.context()) return 'missing'
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
    src.start(ctx.currentTime, hit.from, hit.to - hit.from)
    return {
      stop: (fadeMs) => {
        if (done) return
        done = true; this.release()
        const t = ctx.currentTime, end = t + Math.max(0.005, fadeMs / 1000)
        gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, end)
        try { src.stop(end + 0.01) } catch { /* already stopped */ }
      },
    }
  }

  private segment(lineId: string): { buf: AudioBuffer; from: number; to: number } | null {
    const m = this.loaded, line = m?.lines[lineId]
    const file = m ? lineFile(m, lineId) : null
    const buf = file ? this.buffers.get(file) : null
    if (!line || !buf) return null
    let span = this.trims.get(lineId)
    if (!span) { span = trim(buf, line.start, line.end); this.trims.set(lineId, span) }
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
    this.buffers.set(file, buf)
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

/** The audible span of a segment, in seconds: leading and trailing silence cut, a little padding kept. */
function trim(buf: AudioBuffer, start: number | null, end: number | null): [number, number] {
  const sr = buf.sampleRate
  const a = Math.max(0, Math.floor((start ?? 0) * sr)), b = Math.min(buf.length, Math.ceil((end ?? buf.duration) * sr))
  let first = b, last = a - 1
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = a; i < Math.min(b, first); i++) if (Math.abs(d[i]) > SILENCE) { first = i; break }
    for (let i = b - 1; i > Math.max(a - 1, last); i--) if (Math.abs(d[i]) > SILENCE) { last = i; break }
  }
  if (last < first) return [a / sr, a / sr]
  const pad = Math.floor(EDGE_PAD_S * sr)
  return [Math.max(a, first - pad) / sr, Math.min(b, last + 1 + pad) / sr]
}

export const voice = new Voice()
