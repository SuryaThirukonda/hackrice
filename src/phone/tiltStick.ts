import type { Sample } from './sample'
import { CONTROLLER_CONFIG } from './config'

export type StickVector = [number, number]
export type StickCalibration = 'uncalibrated' | 'calibrating' | 'calibrated'

export interface StickSnapshot {
  vector: StickVector
  raw: StickVector
  calibration: StickCalibration
  calibrationProgress: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function angleDelta(value: number, origin: number): number {
  return ((value - origin + 540) % 360) - 180
}

function currentScreenAngle(): number {
  if (typeof screen !== 'undefined' && Number.isFinite(screen.orientation?.angle)) {
    return screen.orientation.angle
  }
  if (typeof window !== 'undefined') {
    const legacy = (window as typeof window & { orientation?: number }).orientation
    if (typeof legacy === 'number') return legacy
  }
  return 0
}

/** Converts beta/gamma into screen-relative horizontal/vertical tilt. */
export function screenTilt(beta: number, gamma: number, angle: number): StickVector {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  const portrait: StickVector = [gamma, -beta]
  if (normalized === 90) return [-portrait[1], portrait[0]]
  if (normalized === 180) return [-portrait[0], -portrait[1]]
  if (normalized === 270) return [portrait[1], -portrait[0]]
  return portrait
}

export class TiltStickProcessor {
  private snapshot: StickSnapshot = {
    vector: [0, 0],
    raw: [0, 0],
    calibration: 'uncalibrated',
    calibrationProgress: 0,
  }
  private calibrationStartedAt: number | null = null
  private calibrationCount = 0
  private calibrationSum: StickVector = [0, 0]
  private neutral: StickVector = [0, 0]

  reset(): void {
    this.snapshot = {
      vector: [0, 0],
      raw: [0, 0],
      calibration: 'uncalibrated',
      calibrationProgress: 0,
    }
    this.calibrationStartedAt = null
    this.calibrationCount = 0
    this.calibrationSum = [0, 0]
    this.neutral = [0, 0]
  }

  startCalibration(): void {
    this.calibrationStartedAt = null
    this.calibrationCount = 0
    this.calibrationSum = [0, 0]
    this.snapshot.vector = [0, 0]
    this.snapshot.raw = [0, 0]
    this.snapshot.calibration = 'calibrating'
    this.snapshot.calibrationProgress = 0
  }

  push(sample: Sample, screenAngle = currentScreenAngle()): StickSnapshot {
    const t = sample[0] >= performance.timeOrigin
      ? sample[0] - performance.timeOrigin
      : sample[0]
    const beta = sample[11]
    const gamma = sample[12]
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return this.getSnapshot()
    const tilt = screenTilt(beta, gamma, screenAngle)

    if (this.snapshot.calibration === 'calibrating') {
      this.calibrationStartedAt ??= t
      this.calibrationCount += 1
      this.calibrationSum[0] += tilt[0]
      this.calibrationSum[1] += tilt[1]
      const elapsed = Math.max(0, t - this.calibrationStartedAt)
      this.snapshot.calibrationProgress = clamp(
        elapsed / CONTROLLER_CONFIG.calibration.durationMs,
        0,
        1,
      )
      if (
        elapsed >= CONTROLLER_CONFIG.calibration.durationMs
        && this.calibrationCount >= CONTROLLER_CONFIG.calibration.minSamples
      ) {
        this.neutral = [
          this.calibrationSum[0] / this.calibrationCount,
          this.calibrationSum[1] / this.calibrationCount,
        ]
        this.snapshot.calibration = 'calibrated'
        this.snapshot.calibrationProgress = 1
      }
      return this.getSnapshot()
    }

    if (this.snapshot.calibration !== 'calibrated') return this.getSnapshot()
    const raw: StickVector = [
      clamp(angleDelta(tilt[0], this.neutral[0]) / CONTROLLER_CONFIG.stick.maxTiltDegrees, -1, 1),
      clamp(angleDelta(tilt[1], this.neutral[1]) / CONTROLLER_CONFIG.stick.maxTiltDegrees, -1, 1),
    ]
    const magnitude = Math.hypot(raw[0], raw[1])
    let shaped: StickVector = [0, 0]
    if (magnitude > CONTROLLER_CONFIG.stick.deadzone) {
      const scaled = Math.min(1, (magnitude - CONTROLLER_CONFIG.stick.deadzone)
        / (1 - CONTROLLER_CONFIG.stick.deadzone))
      shaped = [raw[0] / magnitude * scaled, raw[1] / magnitude * scaled]
    }
    const smoothing = CONTROLLER_CONFIG.stick.smoothing
    this.snapshot.raw = raw
    this.snapshot.vector = [
      this.snapshot.vector[0] + smoothing * (shaped[0] - this.snapshot.vector[0]),
      this.snapshot.vector[1] + smoothing * (shaped[1] - this.snapshot.vector[1]),
    ]
    return this.getSnapshot()
  }

  getSnapshot(): StickSnapshot {
    return {
      ...this.snapshot,
      vector: [...this.snapshot.vector],
      raw: [...this.snapshot.raw],
    }
  }
}
