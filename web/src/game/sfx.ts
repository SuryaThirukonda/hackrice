// Synthesized sound design (no asset files): punches, blocks, parry, bell, crowd bed with swells, countdown, knockdown, KO.
export class Sfx {
  ctx: AudioContext | null = null
  master: GainNode | null = null
  crowdGain: GainNode | null = null
  private crowdSrc: AudioBufferSourceNode | null = null
  unlocked = false

  unlock(): void {
    if (this.unlocked) return
    try {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(this.ctx.destination)
      void this.ctx.resume()
      this.unlocked = true
      this.startCrowd()
    } catch { /* no audio */ }
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!, buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate), d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 }   // brown-ish noise
    return buf
  }

  private startCrowd(): void {
    const ctx = this.ctx!
    this.crowdSrc = ctx.createBufferSource(); this.crowdSrc.buffer = this.noiseBuffer(4); this.crowdSrc.loop = true
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0.05
    this.crowdSrc.connect(lp); lp.connect(this.crowdGain); this.crowdGain.connect(this.master!)
    this.crowdSrc.start()
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.02
    lfo.connect(lfoGain); lfoGain.connect(this.crowdGain.gain); lfo.start()
  }

  crowdSwell(amount = 0.25, seconds = 1.2): void {
    if (!this.ctx || !this.crowdGain) return
    const t = this.ctx.currentTime
    this.crowdGain.gain.cancelScheduledValues(t)
    this.crowdGain.gain.setTargetAtTime(0.05 + amount, t, 0.05)
    this.crowdGain.gain.setTargetAtTime(0.05, t + seconds, 0.4)
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, slideTo?: number, at = 0): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx, t0 = ctx.currentTime + at
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type; o.frequency.setValueAtTime(freq, t0)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur)
    g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur)
  }

  private burst(dur: number, gain: number, freq: number, q = 1, at = 0): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx, t0 = ctx.currentTime + at
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(dur + 0.05)
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t0); src.stop(t0 + dur + 0.05)
  }

  whoosh(hook = false): void { this.burst(hook ? 0.22 : 0.14, 0.25, hook ? 500 : 900, 0.7) }
  thud(hook = false, power = 0.8): void { this.tone(hook ? 90 : 130, 0.16, 'sine', 0.6 * power, 40); this.burst(0.08, 0.35 * power, 1800, 0.8) }
  block(): void { this.burst(0.06, 0.3, 2600, 3); this.tone(220, 0.08, 'square', 0.12) }
  parry(): void { this.tone(1760, 0.25, 'sine', 0.25, 2400); this.tone(2637, 0.3, 'sine', 0.15, 3200, 0.03) }
  dodge(): void { this.burst(0.12, 0.12, 1200, 0.5) }
  step(): void { this.burst(0.04, 0.08, 400, 1) }
  bell(times = 1): void { for (let i = 0; i < times; i++) { this.tone(1200, 0.9, 'triangle', 0.35, 1150, i * 0.35); this.tone(2400, 0.5, 'sine', 0.12, 2300, i * 0.35) } }
  countdown(n: number): void { this.tone(n > 0 ? 660 : 990, n > 0 ? 0.15 : 0.5, 'square', 0.18) }
  knockdown(): void { this.tone(60, 0.6, 'sawtooth', 0.5, 30); this.burst(0.3, 0.4, 300, 0.6); this.crowdSwell(0.35, 2.5) }
  count(): void { this.tone(880, 0.08, 'square', 0.12) }
  ko(): void { this.tone(55, 1.2, 'sawtooth', 0.6, 25); this.tone(110, 1.2, 'square', 0.2, 55, 0.05); this.burst(0.5, 0.5, 200, 0.5); this.crowdSwell(0.5, 4) }
  win(): void { for (let i = 0; i < 4; i++) this.tone([523, 659, 784, 1046][i], 0.35, 'triangle', 0.25, undefined, i * 0.12); this.crowdSwell(0.4, 3) }
  stagger(): void { this.tone(160, 0.12, 'sawtooth', 0.15, 80) }
  gassed(): void { this.burst(0.3, 0.12, 700, 0.4) }
  menuMove(): void { this.tone(880, 0.05, 'square', 0.08) }
  menuSelect(): void { this.tone(660, 0.08, 'square', 0.12); this.tone(990, 0.12, 'square', 0.12, undefined, 0.06) }
}

export const sfx = new Sfx()
