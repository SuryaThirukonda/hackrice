import type { Sample } from '../protocol'
import type { ArenaSocket } from './ws'

export interface MotionSource {
  readonly kind: 'device' | 'synthetic'
  start(onSample: (s: Sample) => void): Promise<void>
  stop(): void
}

declare global {
  interface DeviceMotionEventConstructor { requestPermission?: () => Promise<'granted' | 'denied'> }
  interface DeviceOrientationEventConstructor { requestPermission?: () => Promise<'granted' | 'denied'> }
}

export function hasDeviceMotion(): boolean { return typeof DeviceMotionEvent !== 'undefined' }

/** Real sensors. Must be started from a user gesture (iOS permission). */
export class DeviceMotionSource implements MotionSource {
  readonly kind = 'device' as const
  private orient: [number, number, number] = [0, 0, 0]
  private onMotion: ((e: DeviceMotionEvent) => void) | null = null
  private onOrient: ((e: DeviceOrientationEvent) => void) | null = null

  async start(onSample: (s: Sample) => void): Promise<void> {
    const DME = DeviceMotionEvent as unknown as DeviceMotionEventConstructor
    const DOE = DeviceOrientationEvent as unknown as DeviceOrientationEventConstructor
    if (typeof DME.requestPermission === 'function') {
      const r = await DME.requestPermission()
      if (r !== 'granted') throw new Error('motion permission denied')
    }
    if (typeof DOE.requestPermission === 'function') { try { await DOE.requestPermission() } catch { /* orientation optional */ } }
    this.onOrient = (e) => { this.orient = [e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0] }
    this.onMotion = (e) => {
      const a = e.acceleration, ag = e.accelerationIncludingGravity, r = e.rotationRate
      const t = performance.timeOrigin + e.timeStamp
      onSample([t, a?.x ?? 0, a?.y ?? 0, a?.z ?? 0, ag?.x ?? 0, ag?.y ?? 0, ag?.z ?? 0, r?.alpha ?? 0, r?.beta ?? 0, r?.gamma ?? 0, this.orient[0], this.orient[1], this.orient[2]])
    }
    window.addEventListener('deviceorientation', this.onOrient)
    window.addEventListener('devicemotion', this.onMotion)
  }

  stop(): void {
    if (this.onMotion) window.removeEventListener('devicemotion', this.onMotion)
    if (this.onOrient) window.removeEventListener('deviceorientation', this.onOrient)
  }
}

/** Fullscreen + wake lock + landscape, all best-effort (iOS ignores most of it). Call inside the same tap. */
export async function enterPlayMode(): Promise<void> {
  try { await document.documentElement.requestFullscreen?.() } catch { /* iOS Safari */ }
  try { await (navigator as unknown as { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen') } catch { /* optional */ }
  try { await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape') } catch { /* optional */ }
}

/** Batches samples every batchMs into motion.frame messages and reports a local |a| for the swing meter. */
export class MotionStreamer {
  private buf: Sample[] = []
  private timer: number | null = null
  private source: MotionSource | null = null
  framesSent = 0
  onMeter: ((mag: number) => void) | null = null
  private socket: ArenaSocket
  private batchMs: number

  constructor(socket: ArenaSocket, batchMs = 50) { this.socket = socket; this.batchMs = batchMs }

  async start(source: MotionSource): Promise<void> {
    this.source = source
    await source.start((s) => {
      this.buf.push(s)
      const mag = Math.hypot(s[1], s[2], s[3])
      this.onMeter?.(mag)
    })
    this.timer = window.setInterval(() => this.flush(), this.batchMs)
  }

  private flush(): void {
    if (!this.buf.length) return
    const s = this.buf.splice(0, this.buf.length)
    if (this.socket.send('motion.frame', { t0: s[0][0], n: s.length, s })) this.framesSent += 1
    else if (this.buf.length < 2000) this.buf.unshift(...s) // keep up to ~2 s while reconnecting
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer)
    this.source?.stop()
  }
}
