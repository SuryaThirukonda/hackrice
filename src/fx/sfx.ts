// Tiny synthesized UI sounds (no asset files). Unlocked on the first pointer or key event.
// Every sound goes through one game-sound bus, so the announcer can duck it while it speaks.
class Sfx {
  private ctx: AudioContext | null = null
  private bus: GainNode | null = null
  private unlockListeners: ((ctx: AudioContext) => void)[] = []
  enabled = true
  unlock(): void {
    if (this.ctx) return
    try {
      const ctx = new AudioContext(); void ctx.resume()
      const bus = ctx.createGain(); bus.connect(ctx.destination)
      this.ctx = ctx; this.bus = bus
    } catch { return /* silent */ }
    const listeners = this.unlockListeners; this.unlockListeners = []
    for (const cb of listeners) { try { cb(this.ctx) } catch { /* a listener must not break unlocking */ } }
  }
  /** The shared audio context, or null until the first user gesture unlocks audio. */
  context(): AudioContext | null { return this.ctx }
  /** Run `cb` with the audio context now if audio is unlocked, otherwise as soon as it is. */
  onUnlock(cb: (ctx: AudioContext) => void): void { if (this.ctx) cb(this.ctx); else this.unlockListeners.push(cb) }
  /** Lower game sounds under the announcer (to 45 % over 120 ms) or bring them back (over 250 ms). */
  duck(on: boolean): void {
    if (!this.ctx || !this.bus) return
    const g = this.bus.gain, t = this.ctx.currentTime
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(on ? 0.45 : 1, t + (on ? 0.12 : 0.25))
  }
  private tone(f: number, d: number, type: OscillatorType = 'square', g = 0.08, slide?: number, at = 0): void {
    if (!this.ctx || !this.enabled) return
    const t0 = this.ctx.currentTime + at, o = this.ctx.createOscillator(), gn = this.ctx.createGain()
    o.type = type; o.frequency.setValueAtTime(f, t0); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + d)
    gn.gain.setValueAtTime(g, t0); gn.gain.exponentialRampToValueAtTime(0.001, t0 + d)
    o.connect(gn); gn.connect(this.bus ?? this.ctx.destination); o.start(t0); o.stop(t0 + d)
  }
  hover(): void { this.tone(880, 0.05, 'square', 0.05, 1100) }
  select(): void { this.tone(660, 0.08, 'square', 0.09); this.tone(990, 0.14, 'square', 0.09, 1320, 0.06) }
  back(): void { this.tone(520, 0.1, 'triangle', 0.08, 300) }
  stamp(): void { this.tone(140, 0.18, 'sine', 0.25, 60); this.tone(2400, 0.04, 'square', 0.04) }
  wipe(): void { this.tone(300, 0.25, 'sawtooth', 0.05, 1200) }
  sparkle(): void { for (let i = 0; i < 3; i++) this.tone([1760, 2217, 2637][i], 0.12, 'sine', 0.05, undefined, i * 0.05) }
  private noise(d: number, g = 0.2, lp = 1200, at = 0): void {
    if (!this.ctx || !this.enabled) return
    const t0 = this.ctx.currentTime + at, n = Math.floor(this.ctx.sampleRate * d), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), ch = buf.getChannelData(0)
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n)
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), gn = this.ctx.createGain()
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = lp; gn.gain.setValueAtTime(g, t0); gn.gain.exponentialRampToValueAtTime(0.001, t0 + d)
    src.connect(f); f.connect(gn); gn.connect(this.bus ?? this.ctx.destination); src.start(t0)
  }
  // fight sounds
  whoosh(heavy = false): void { this.noise(heavy ? 0.22 : 0.14, 0.12, heavy ? 900 : 1600) }
  thud(power = 0.8): void { this.tone(110, 0.16, 'sine', 0.35 * power, 40); this.noise(0.08, 0.3 * power, 700) }
  block(): void { this.tone(420, 0.06, 'square', 0.12, 180); this.noise(0.05, 0.15, 2500) }
  dodge(): void { this.noise(0.12, 0.08, 3000) }
  parry(): void { this.tone(1200, 0.08, 'square', 0.1, 2400); this.noise(0.05, 0.1, 5000) }
  stagger(): void { this.tone(220, 0.3, 'sawtooth', 0.12, 80) }
  gassed(): void { this.tone(300, 0.25, 'triangle', 0.08, 120) }
  bell(times = 1): void { for (let i = 0; i < times; i++) { this.tone(1500, 0.6, 'triangle', 0.18, 1400, i * 0.35); this.tone(2250, 0.5, 'sine', 0.08, undefined, i * 0.35) } }
  countdown(n: number): void { this.tone(n === 0 ? 880 : 440, n === 0 ? 0.35 : 0.12, 'square', 0.12) }
  knockdown(): void { this.tone(70, 0.5, 'sine', 0.4, 30); this.noise(0.3, 0.35, 400) }
  count(): void { this.tone(520, 0.08, 'square', 0.1) }
  ko(): void { this.tone(160, 0.6, 'sawtooth', 0.2, 50); this.tone(80, 0.9, 'sine', 0.3, 30, 0.1) }
  win(): void { for (let i = 0; i < 4; i++) this.tone([523, 659, 784, 1047][i], 0.18, 'square', 0.1, undefined, i * 0.12) }
  crowd(amount = 0.2, d = 1.0): void { this.noise(d, amount * 0.4, 500) }
}
export const sfx = new Sfx()
