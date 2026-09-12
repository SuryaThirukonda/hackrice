// TypeScript port of backend/app/motion/synth.py generators for the desktop-test remote (?fake=1).
import type { Sample } from '../protocol'
import type { MotionSource } from './motion'

const G = 9.81
const gauss = (s: number) => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
type Raw = [number, number, number, number, number, number, number, number, number, number, number, number, number]

function sample(t: number, a: number[], w: number[], pose: 'flat' | 'upright', gamma = 0, beta?: number): Raw {
  const g = pose === 'upright' ? [0, G, 0] : [0, 0, G]
  return [t, a[0], a[1], a[2], a[0] + g[0], a[1] + g[1], a[2] + g[2], w[0], w[1], w[2], 0, beta ?? (pose === 'upright' ? 90 : 0), gamma]
}

export function rest(hz: number, seconds: number, pose: 'flat' | 'upright' = 'upright', sigma = 0.12): Raw[] {
  const out: Raw[] = []; const dt = 1000 / hz
  for (let i = 0; i < seconds * hz; i++) out.push(sample(i * dt, [gauss(sigma), gauss(sigma), gauss(sigma)], [gauss(4), gauss(4), gauss(4)], pose, gauss(0.5)))
  return out
}
export function raisePhone(hz: number, seconds = 1.0, pose: 'flat' | 'upright' = 'upright'): Raw[] {
  const out: Raw[] = []; const dt = 1000 / hz; const n = Math.floor(seconds * hz)
  for (let i = 0; i < n; i++) out.push(sample(i * dt, [gauss(0.1), 4 * Math.sin(Math.PI * i / n), gauss(0.1)], [gauss(8), gauss(8), gauss(8)], pose))
  return out
}
export function swing(hz: number, opts: { peak?: number; width?: number; lead?: number; tail?: number; omega?: number; lane?: number; spin?: number } = {}): Raw[] {
  const peak = opts.peak ?? 26, w = opts.width ?? 120, lead = opts.lead ?? 250, tail = opts.tail ?? 250, om = opts.omega ?? 400, lane = opts.lane ?? 0, spin = opts.spin ?? 120
  const out: Raw[] = []; const dt = 1000 / hz; const tc = lead + 2 * w; const total = lead + tail + 4 * w
  for (let t = 0; t <= total; t += dt) {
    const tau = t - tc
    const ay = tau <= 0 ? peak * Math.exp(-((tau / w) ** 2)) : peak * Math.exp(-((tau / w) ** 2)) * Math.cos(Math.PI * tau / w)
    const wx = om * Math.exp(-(((tau + 0.6 * w) / (1.6 * w)) ** 2))
    const wy = spin * Math.exp(-((tau / w) ** 2))
    out.push(sample(t, [gauss(0.15), ay + gauss(0.15), gauss(0.15)], [wx + gauss(5), wy + gauss(5), gauss(5)], 'upright', lane + gauss(0.5)))
  }
  return out
}
export function punch(hz: number, kind: 'jab' | 'hook', peak = 18, rise = 60, quiet = 250, tail = 200): Raw[] {
  const yaw = kind === 'hook' ? 320 : 40; const out: Raw[] = []; const dt = 1000 / hz; const total = quiet + rise + 80 + tail
  for (let t = 0; t <= total; t += dt) {
    const tau = t - quiet
    const ay = tau < 0 ? 0 : tau <= rise ? peak * tau / rise : peak * Math.exp(-(((tau - rise) / 40) ** 2))
    const wz = tau >= -40 ? yaw * Math.exp(-(((tau - rise) / 60) ** 2)) : 0
    out.push(sample(t, [gauss(0.1), ay + gauss(0.1), gauss(0.1)], [gauss(4), gauss(4), wz + gauss(4)], 'upright'))
  }
  return out
}
export function block(hz: number, seconds = 1.2): Raw[] { return rest(hz, seconds, 'upright', 0.08) }
export function unblock(hz: number, seconds = 0.4): Raw[] {
  const out: Raw[] = []; const dt = 1000 / hz; const n = Math.floor(seconds * hz)
  for (let i = 0; i < n; i++) out.push(sample(i * dt, [gauss(0.3), gauss(0.3), 2.5 + gauss(0.3)], [120 + gauss(5), gauss(5), gauss(5)], 'upright', 0, 90 * (1 - i / Math.max(1, n - 1))))
  return out
}
export function dodge(hz: number, delta = 45, over = 100, lead = 150, tail = 150): Raw[] {
  const out: Raw[] = []; const dt = 1000 / hz; const total = lead + over + tail
  for (let t = 0; t <= total; t += dt) {
    const tau = t - lead; const gamma = tau < 0 ? 0 : delta * Math.min(1, tau / over)
    out.push(sample(t, [gauss(0.2), gauss(0.2), gauss(0.2)], [gauss(5), gauss(5), (tau >= 0 && tau <= over ? delta / over * 1000 : 0) + gauss(5)], 'upright', gamma))
  }
  return out
}
export function shake(hz: number, peaks = 4, within = 800, amp = 11): Raw[] {
  const out: Raw[] = []; const dt = 1000 / hz; const f = peaks / (within / 1000)
  for (let t = 0; t <= within + 400; t += dt) { const env = t <= within ? 1 : 0; const ax = env * amp * Math.sin(2 * Math.PI * f * t / 1000)
    out.push(sample(t, [ax + gauss(0.2), gauss(0.2), gauss(0.2)], [gauss(5), gauss(5), 70 * env * Math.sin(2 * Math.PI * f * t / 1000)], 'flat')) }
  return out
}
export function bump(hz: number, peak = 30, width = 30, at = 300): Raw[] {
  const out: Raw[] = []; const dt = 1000 / hz
  for (let t = 0; t <= at + 400; t += dt) { const k = Math.exp(-(((t - at) / (width / 2)) ** 2)); out.push(sample(t, [gauss(0.1), gauss(0.1), peak * k + gauss(0.1)], [gauss(5), gauss(5), gauss(5)], 'flat')) }
  return out
}
export function flick(hz: number, peak = 16): Raw[] {
  const out: Raw[] = []; const dt = 1000 / hz
  for (let t = 0; t <= 700; t += dt) { const tau = t - 300; const ay = tau >= 0 && tau < 50 ? peak * Math.sin(Math.PI * tau / 50) : tau >= 50 && tau < 110 ? -0.55 * peak * Math.sin(Math.PI * (tau - 50) / 60) : 0
    out.push(sample(t, [gauss(0.1), ay + gauss(0.1), gauss(0.1)], [gauss(5) + (tau >= 0 && tau < 110 ? 150 : 0), gauss(5), gauss(5)], 'flat')) }
  return out
}

export type FakeGesture = 'swing' | 'jab' | 'hook' | 'block' | 'unblock' | 'dodge' | 'shake' | 'bump' | 'flick'

/** Emits quiet upright rest at 60 Hz; trigger() splices a generated segment in. Calibration sequence plays first. */
export class SyntheticMotionSource implements MotionSource {
  readonly kind = 'synthetic' as const
  private timer: number | null = null
  private queue: Raw[] = []
  private t = 0
  private base = 0
  private hz = 60
  private pose: 'flat' | 'upright' = 'upright'

  async start(onSample: (s: Sample) => void): Promise<void> {
    this.base = performance.timeOrigin + performance.now()
    this.queue.push(...rest(this.hz, 2.2, this.pose), ...raisePhone(this.hz, 1.1, this.pose))
    const dt = 1000 / this.hz
    let carry = 0
    let last = performance.now()
    this.timer = window.setInterval(() => {
      const now = performance.now(); carry += now - last; last = now
      while (carry >= dt) {
        carry -= dt
        const s = this.queue.length ? this.queue.shift()! : sample(0, [gauss(0.12), gauss(0.12), gauss(0.12)], [gauss(4), gauss(4), gauss(4)], this.pose, gauss(0.5))
        const row = [...s] as Sample; row[0] = this.base + this.t; this.t += dt
        onSample(row)
      }
    }, 16)
  }

  trigger(g: FakeGesture, opts: Record<string, number> = {}): void {
    const hz = this.hz
    const seg: Raw[] = g === 'swing' ? swing(hz, opts) : g === 'jab' ? punch(hz, 'jab') : g === 'hook' ? punch(hz, 'hook') : g === 'block' ? block(hz)
      : g === 'unblock' ? unblock(hz) : g === 'dodge' ? dodge(hz) : g === 'shake' ? shake(hz) : g === 'bump' ? bump(hz) : flick(hz)
    this.queue.push(...seg)
  }

  stop(): void { if (this.timer) window.clearInterval(this.timer) }
}
