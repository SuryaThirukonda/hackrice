// Projector audio: the only client that plays sound. Unlocked by a host click; one voice line at a time; SFX ducked under speech.
import type { VoiceLine } from '../protocol'

class AudioBus {
  ctx: AudioContext | null = null
  unlocked = false
  private voiceGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private pending: VoiceLine | null = null
  private speaking = false
  onLine: ((line: VoiceLine) => void) | null = null

  async unlock(): Promise<boolean> {
    try {
      this.ctx = this.ctx ?? new AudioContext()
      await this.ctx.resume()
      this.voiceGain = this.ctx.createGain(); this.voiceGain.connect(this.ctx.destination)
      this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.ctx.destination)
      const b = this.ctx.createBuffer(1, 1, 22050); const s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start()
      this.unlocked = true
      return true
    } catch { return false }
  }

  enqueue(line: VoiceLine): void {
    if (!this.pending || line.priority >= this.pending.priority) this.pending = line
    if (!this.speaking) this.next()
  }

  private next(): void {
    const line = this.pending; this.pending = null
    if (!line) return
    const age = Date.now() - (line as unknown as { ts?: number }).ts! || 0
    if (age > 6000 && line.priority < 3) { this.next(); return }
    this.speaking = true
    this.onLine?.(line)
    this.duck(true)
    const done = () => { this.speaking = false; this.duck(false); this.next() }
    if (line.url && this.unlocked) {
      const a = new Audio(line.url)
      a.onended = done; a.onerror = () => setTimeout(done, Math.min(4000, line.duration_ms))
      a.play().catch(() => setTimeout(done, Math.min(4000, line.duration_ms)))
    } else {
      this.beep(line.priority >= 3 ? 660 : 440, 0.12)
      setTimeout(done, Math.min(4000, line.duration_ms || 1500))
    }
  }

  private duck(on: boolean): void { if (this.sfxGain && this.ctx) this.sfxGain.gain.setTargetAtTime(on ? 0.3 : 1, this.ctx.currentTime, 0.05) }

  /** Tiny synthesized SFX so the demo has sound without asset files. */
  sfx(name: string, gain = 1): void {
    if (!this.ctx || !this.unlocked) return
    const map: Record<string, [number, number, OscillatorType]> = { strike: [220, 0.5, 'sawtooth'], pins: [180, 0.35, 'square'], bell: [880, 0.8, 'sine'], hit: [140, 0.12, 'square'], whoosh: [600, 0.18, 'triangle'], payout: [1046, 0.4, 'sine'], house_takes: [110, 0.6, 'sawtooth'], knockdown: [90, 0.9, 'sawtooth'] }
    const [f, d, type] = map[name] ?? [330, 0.15, 'sine']
    this.beep(f, d, type, gain)
  }

  private beep(freq: number, dur: number, type: OscillatorType = 'sine', gain = 1): void {
    if (!this.ctx || !this.sfxGain) return
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain()
    o.type = type; o.frequency.setValueAtTime(freq, this.ctx.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(40, freq / 2), this.ctx.currentTime + dur)
    g.gain.setValueAtTime(0.25 * gain, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur)
    o.connect(g); g.connect(this.sfxGain); o.start(); o.stop(this.ctx.currentTime + dur)
  }
}

export const audio = new AudioBus()
