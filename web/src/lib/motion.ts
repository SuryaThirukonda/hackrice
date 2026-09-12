import type { Sample } from '../protocol'
import { CONTROLLER_CONFIG } from '../controller/config'
import type { ArenaSocket } from './ws'

export type AccelerationMode =
  | 'waiting'
  | 'linear'
  | 'orientation-fallback'
  | 'gravity-filter-fallback'
  | 'synthetic'

export interface MotionSource {
  readonly kind: 'device' | 'synthetic'
  readonly accelerationMode: AccelerationMode
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
  accelerationMode: AccelerationMode = 'waiting'
  private orient: [number, number, number] = [0, 0, 0]
  private hasOrientation = false
  private gravityEstimate: [number, number, number] | null = null
  private lastTimestamp: number | null = null
  private onMotion: ((e: DeviceMotionEvent) => void) | null = null
  private onOrient: ((e: DeviceOrientationEvent) => void) | null = null

  async start(onSample: (s: Sample) => void): Promise<void> {
    const DME = globalThis.DeviceMotionEvent as unknown as DeviceMotionEventConstructor
    const DOE = typeof globalThis.DeviceOrientationEvent === 'undefined'
      ? null
      : globalThis.DeviceOrientationEvent as unknown as DeviceOrientationEventConstructor
    const motionPermission = typeof DME.requestPermission === 'function'
      ? DME.requestPermission()
      : Promise.resolve<'granted'>('granted')
    const orientationPermission = DOE && typeof DOE.requestPermission === 'function'
      ? DOE.requestPermission().catch(() => 'denied' as const)
      : Promise.resolve<'granted'>('granted')
    const [motionResult] = await Promise.all([motionPermission, orientationPermission])
    if (motionResult !== 'granted') {
      throw new Error('Motion permission denied. Enable Motion & Orientation Access and retry.')
    }

    this.onOrient = (e) => {
      if (e.beta === null || e.gamma === null) return
      this.orient = [e.alpha ?? 0, e.beta, e.gamma]
      this.hasOrientation = true
    }
    this.onMotion = (e) => {
      const a = e.acceleration, ag = e.accelerationIncludingGravity, r = e.rotationRate
      const t = performance.timeOrigin + e.timeStamp
      const includingGravity: [number, number, number] = [
        ag?.x ?? 0,
        ag?.y ?? 0,
        ag?.z ?? 0,
      ]
      let linear: [number, number, number]
      if (a?.x !== null && a?.x !== undefined
        && a.y !== null && a.y !== undefined
        && a.z !== null && a.z !== undefined) {
        linear = [a.x, a.y, a.z]
        this.accelerationMode = 'linear'
      } else if (this.hasOrientation) {
        const beta = this.orient[1] * Math.PI / 180
        const gamma = this.orient[2] * Math.PI / 180
        const gravity = CONTROLLER_CONFIG.sensorFallback.gravityMps2
        const expectedGravity: [number, number, number] = [
          -gravity * Math.sin(gamma) * Math.cos(beta),
          gravity * Math.sin(beta),
          gravity * Math.cos(gamma) * Math.cos(beta),
        ]
        linear = [
          includingGravity[0] - expectedGravity[0],
          includingGravity[1] - expectedGravity[1],
          includingGravity[2] - expectedGravity[2],
        ]
        this.accelerationMode = 'orientation-fallback'
      } else {
        const interval = this.lastTimestamp === null
          ? 1_000 / CONTROLLER_CONFIG.sensorFallback.nominalRateHz
          : e.timeStamp - this.lastTimestamp
        const gravityAlpha = 1 - Math.exp(
          -Math.max(0, interval) / CONTROLLER_CONFIG.sensorFallback.gravityTimeConstantMs,
        )
        this.gravityEstimate ??= [...includingGravity]
        for (let axis = 0; axis < 3; axis += 1) {
          this.gravityEstimate[axis] += gravityAlpha
            * (includingGravity[axis] - this.gravityEstimate[axis])
        }
        linear = [
          includingGravity[0] - this.gravityEstimate[0],
          includingGravity[1] - this.gravityEstimate[1],
          includingGravity[2] - this.gravityEstimate[2],
        ]
        this.accelerationMode = 'gravity-filter-fallback'
      }
      this.lastTimestamp = e.timeStamp
      onSample([
        t,
        linear[0],
        linear[1],
        linear[2],
        includingGravity[0],
        includingGravity[1],
        includingGravity[2],
        r?.alpha ?? 0,
        r?.beta ?? 0,
        r?.gamma ?? 0,
        this.orient[0],
        this.orient[1],
        this.orient[2],
      ])
    }
    if (DOE) window.addEventListener('deviceorientation', this.onOrient)
    window.addEventListener('devicemotion', this.onMotion)
  }

  stop(): void {
    if (this.onMotion) window.removeEventListener('devicemotion', this.onMotion)
    if (this.onOrient) window.removeEventListener('deviceorientation', this.onOrient)
    this.onMotion = null
    this.onOrient = null
    this.hasOrientation = false
    this.gravityEstimate = null
    this.lastTimestamp = null
    this.accelerationMode = 'waiting'
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
