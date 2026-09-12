// The House Champ learns the challenger's punch rhythm and guards on the predicted beat.
import type { BoxingSim, Fighter } from './boxing'

export class RhythmLearner {
  times: number[] = []; kinds: string[] = []
  level = 0; predicted = -1; guardedUntil = 0; hitsPredicted = 0
  onPunch(t: number, kind: string): void {
    const iv = this.intervals()
    if (iv.length >= 1 && this.times.length) {
      const mean = iv.reduce((a, b) => a + b, 0) / iv.length
      if (mean > 0 && iv.length >= 2 && Math.abs((t - this.times[this.times.length - 1]) - mean) / mean > 0.4) { this.times = []; this.kinds = [] }
    }
    this.times.push(t); this.kinds.push(kind)
    if (this.times.length > 9) { this.times.shift(); this.kinds.shift() }
    this.update()
  }
  private intervals(): number[] { const out: number[] = []; for (let i = 1; i < this.times.length; i++) out.push(this.times[i] - this.times[i - 1]); return out }
  private update(): void {
    const iv = this.intervals()
    if (iv.length >= 2) {
      const mean = iv.reduce((a, b) => a + b, 0) / iv.length
      const std = Math.sqrt(iv.reduce((a, v) => a + (v - mean) ** 2, 0) / iv.length)
      this.level = Math.max(0, Math.min(1, 1 - std / 0.3))
      this.predicted = iv.length + 1 >= 5 && std < 0.12 ? this.times[this.times.length - 1] + mean : -1
    } else { this.level = 0; this.predicted = -1 }
  }
  tick(t: number, me: Fighter, sim: BoxingSim): void {
    if (this.predicted < 0 || t < this.guardedUntil) return
    if (this.predicted - 0.1 <= t && t <= this.predicted + 0.25 && ['idle', 'block', 'recover'].includes(me.state)) {
      this.guardedUntil = this.predicted + 0.4; this.hitsPredicted++
      const hooks = this.kinds.filter((k) => k === 'hook').length
      if (hooks * 2 > this.kinds.length) sim.dodge(me, (-me.facing) as 1 | -1)
      else { me.wantsGuard = true; if (me.ai) { me.ai.counterPending = true; me.ai.retreatT = 0.4 } }
      sim.events.push({ kind: 'rhythm', who: me.id })
    }
  }
}
