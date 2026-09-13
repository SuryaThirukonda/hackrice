import type { Epoch } from './energy'

/**
 * Phone-side movement tracker. Fed every sensor sample at 60 Hz, it folds them into one-second epochs
 * and measures each swing's rotation from a short ring buffer of gyro magnitudes, so the phone sends a
 * few numbers a second instead of the raw stream. Pure and clock-free: every call carries its own
 * timestamp, which keeps it testable and immune to a throttled tab.
 */
const RING_MS = 1500

export class ActivityTracker {
  private epochMs: number
  private origin: number | null = null
  private current: { index: number; sum: number; n: number; peak: number; swings: number; rotation: number } | null = null
  private ready: Epoch[] = []
  private roms: number[] = []
  private ring: { t: number; rot: number; dt: number }[] = []

  constructor(epochMs = 1000) { this.epochMs = epochMs }

  /** Milliseconds since the first sample, or 0 before any. */
  elapsed(t: number): number { return this.origin === null ? 0 : Math.max(0, t - this.origin) }

  /** One processed sample: acceleration magnitude (m/s², gravity and bias removed), rotation magnitude (deg/s). */
  push(t: number, accelMag: number, rotMag: number, intervalMs: number): void {
    this.origin ??= t
    const index = Math.floor((t - this.origin) / this.epochMs)
    if (!this.current || this.current.index !== index) {
      this.roll()
      this.current = { index, sum: 0, n: 0, peak: 0, swings: 0, rotation: 0 }
    }
    const c = this.current
    const a = Number.isFinite(accelMag) ? Math.max(0, accelMag) : 0
    const r = Number.isFinite(rotMag) ? Math.max(0, rotMag) : 0
    const dt = Math.max(1, Math.min(100, intervalMs)) / 1000
    c.sum += a; c.n += 1; c.peak = Math.max(c.peak, a); c.rotation += r * dt
    this.ring.push({ t, rot: r, dt })
    while (this.ring.length && this.ring[0].t < t - RING_MS) this.ring.shift()
  }

  /** A swing the detector just completed, ending now and lasting `durationMs`: its rotation is the
   *  gyro integrated over that window, which is the arm's range of motion for the swing in degrees. */
  noteSwing(t: number, durationMs: number): number {
    const from = t - Math.max(50, durationMs)
    let deg = 0
    for (const s of this.ring) if (s.t >= from && s.t <= t) deg += s.rot * s.dt
    this.roms.push(deg)
    if (this.current) this.current.swings += 1
    return deg
  }

  /** Completed epochs and per-swing rotations since the last drain. The epoch in progress stays. */
  drain(): { epochs: Epoch[]; roms: number[] } {
    const out = { epochs: this.ready, roms: this.roms }
    this.ready = []; this.roms = []
    return out
  }

  /** Close the epoch in progress too, for the end of a session. */
  flush(): { epochs: Epoch[]; roms: number[] } { this.roll(); this.current = null; return this.drain() }

  reset(): void { this.origin = null; this.current = null; this.ready = []; this.roms = []; this.ring = [] }

  private roll(): void {
    const c = this.current
    if (!c || c.n === 0) return
    this.ready.push({ t: c.index * this.epochMs, mean: c.sum / c.n, peak: c.peak, swings: c.swings, rotation: c.rotation })
  }
}
