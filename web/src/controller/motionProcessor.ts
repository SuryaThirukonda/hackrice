import type { Sample } from '../protocol'
import {
  CONTROLLER_CONFIG,
  DEFAULT_DIRECTION_MODE,
  type DetectorConfig,
  type DirectionMode,
  type GestureName,
  type Sport,
} from './config'

export type Vector3 = [number, number, number]
export type CalibrationState = 'uncalibrated' | 'calibrating' | 'calibrated' | 'failed'
export type DetectorState = 'idle' | 'tracking' | 'cooldown'
export type MotionAxis = 'x' | 'y' | 'z'
export type DirectionLabel = 'left' | 'right' | 'up' | 'down' | 'front' | 'back'

export interface ProcessedMotion {
  t: number
  acceleration: Vector3
  rotation: Vector3
  accelerationMagnitude: number
  rotationMagnitude: number
  intervalMs: number
  sensorHz: number
}

export interface DetectedGesture {
  gesture: GestureName
  t: number
  power: number
  direction: Vector3
  peakAcceleration: number
  peakRotation: number
  duration: number
  dominantAxis: MotionAxis
  directionLabel: DirectionLabel
  /** Set only when Emergency Power boosted this score. Never affects direction. */
  emergencyBoostApplied?: boolean
}

export interface MotionSnapshot extends ProcessedMotion {
  calibration: CalibrationState
  calibrationProgress: number
  calibrationMessage: string
  detector: DetectorState
}

interface ActiveGesture {
  startedAt: number
  peakAcceleration: number
  peakAccelerationAt: number
  peakAccelerationVector: Vector3
  accelerationDirection: Vector3
  peakRotation: number
  peakRotationVector: Vector3
  rotationDirection: Vector3
}

type InternalDetectorState = DetectorState | 'armed'

const ZERO_VECTOR: Vector3 = [0, 0, 0]

function magnitude(vector: Vector3): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize(vector: Vector3): Vector3 {
  const length = magnitude(vector)
  if (length <= Number.EPSILON) return [0, 1, 0]
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

/** Converts device X/Y into the current screen orientation while preserving Z. */
export function orientVectorToScreen(vector: Vector3, angle: number): Vector3 {
  const normalizedAngle = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  if (normalizedAngle === 90) return [-vector[1], vector[0], vector[2]]
  if (normalizedAngle === 180) return [-vector[0], -vector[1], vector[2]]
  if (normalizedAngle === 270) return [vector[1], -vector[0], vector[2]]
  return [...vector]
}

function currentScreenAngle(): number {
  if (typeof screen !== 'undefined' && Number.isFinite(screen.orientation?.angle)) {
    return screen.orientation.angle
  }
  if (typeof window !== 'undefined') {
    const legacyAngle = (window as typeof window & { orientation?: number }).orientation
    if (typeof legacyAngle === 'number') return legacyAngle
  }
  return 0
}

function accelerationForMode(vector: Vector3, mode: DirectionMode): Vector3 {
  if (mode === 'up_down') return [0, vector[1], 0]
  if (mode === 'left_right') return [vector[0], 0, 0]
  return [...vector]
}

function positiveProjection(vector: Vector3, direction: Vector3): number {
  return Math.max(0, dot(vector, direction))
}

/** Reporting only: this classification is never used by the power calculation. */
export function classifyDirection(vector: Vector3): {
  dominantAxis: MotionAxis
  directionLabel: DirectionLabel
} {
  const axisIndex = [0, 1, 2].reduce(
    (best, axis) => Math.abs(vector[axis]) > Math.abs(vector[best]) ? axis : best,
    0,
  )
  if (axisIndex === 0) {
    return { dominantAxis: 'x', directionLabel: vector[0] >= 0 ? 'right' : 'left' }
  }
  if (axisIndex === 1) {
    return { dominantAxis: 'y', directionLabel: vector[1] >= 0 ? 'up' : 'down' }
  }
  return { dominantAxis: 'z', directionLabel: vector[2] >= 0 ? 'front' : 'back' }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function combineDirection(
  active: ActiveGesture,
  config: DetectorConfig,
  directionMode: DirectionMode,
): Vector3 {
  const acceleration = normalize(active.peakAccelerationVector)
  if (directionMode === 'up_down' || directionMode === 'left_right') {
    return acceleration
  }
  const rotation = normalize(active.peakRotationVector)
  return normalize([
    acceleration[0] * config.directionAccelerationWeight
      + rotation[0] * config.directionRotationWeight,
    acceleration[1] * config.directionAccelerationWeight
      + rotation[1] * config.directionRotationWeight,
    acceleration[2] * config.directionAccelerationWeight
      + rotation[2] * config.directionRotationWeight,
  ])
}

class GestureDetector {
  private sport: Sport
  private directionMode: DirectionMode
  private state: InternalDetectorState = 'idle'
  private active: ActiveGesture | null = null
  private armedSince: number | null = null
  private armedAt = 0
  private cooldownUntil = 0
  private cooldownRearmed = true
  private previousAcceleration = 0
  // Learned once from a deliberate forward punch, not re-learned on recoil.
  private opponentDirection: Vector3 | null = null
  private retracting = false
  private neutralSince: number | null = null

  constructor(sport: Sport, directionMode: DirectionMode) {
    this.sport = sport
    this.directionMode = directionMode
  }

  setSport(sport: Sport): void {
    this.sport = sport
    this.reset(true)
  }

  setDirectionMode(directionMode: DirectionMode): void {
    this.directionMode = directionMode
    this.reset(true)
  }

  reset(clearForward = false): void {
    if (clearForward) this.opponentDirection = null
    this.retracting = false
    this.neutralSince = null
    this.state = 'idle'
    this.active = null
    this.armedSince = null
    this.armedAt = 0
    this.cooldownUntil = 0
    this.cooldownRearmed = true
    this.previousAcceleration = 0
  }

  getState(): DetectorState {
    return this.state === 'armed' ? 'tracking' : this.state
  }

  push(sample: ProcessedMotion): DetectedGesture | null {
    const config = CONTROLLER_CONFIG.detectors[this.sport]
    const profiledAcceleration = accelerationForMode(
      sample.acceleration,
      this.directionMode,
    )
    const movementAcceleration = this.sport === 'boxing' && this.opponentDirection
      ? positiveProjection(profiledAcceleration, this.opponentDirection)
      : magnitude(profiledAcceleration)
    const previousAcceleration = this.previousAcceleration
    this.previousAcceleration = movementAcceleration

    if (this.sport === 'boxing' && this.opponentDirection) {
      if (dot(profiledAcceleration, this.opponentDirection) < -config.rearmAcceleration) {
        this.retracting = true
        this.neutralSince = null
      }
      if (this.retracting) {
        // Retraction braking may accelerate forward too. Require a brief
        // neutral grip before a new punch, rather than scoring that braking.
        if (magnitude(profiledAcceleration) <= config.releaseAcceleration) {
          this.neutralSince ??= sample.t
          if (sample.t - this.neutralSince >= 100) this.retracting = false
        } else this.neutralSince = null
        // Let the original forward gesture finish on its negative release.
        if (this.retracting && this.state !== 'tracking') return null
      }
    }

    if (this.state === 'cooldown') {
      if (movementAcceleration <= config.rearmAcceleration) {
        this.cooldownRearmed = true
      }
      if (sample.t < this.cooldownUntil) return null
      // A partial return is enough to rearm a punch. If the phone never
      // decayed that far, require a fresh rising edge to avoid duplicate hits.
      const hasFreshRise = movementAcceleration - previousAcceleration
        >= config.startAcceleration * config.retriggerRiseRatio
      if (!this.cooldownRearmed && !hasFreshRise) return null
      this.state = 'idle'
    }

    if (this.state === 'idle') {
      if (config.mode === 'swing') {
        if (sample.rotationMagnitude < config.armRotation) {
          this.armedSince = null
          return null
        }
        this.armedSince ??= sample.t
        if (sample.t - this.armedSince < config.armDurationMs) return null
        this.state = 'armed'
        this.armedAt = sample.t
        return null
      }
      if (movementAcceleration < config.startAcceleration) return null
      if (this.sport === 'boxing' && !this.opponentDirection) {
        this.opponentDirection = normalize(profiledAcceleration)
      }
      this.beginGesture(sample, profiledAcceleration)
      return null
    }

    if (this.state === 'armed') {
      if (movementAcceleration >= config.startAcceleration) {
        this.beginGesture(sample, profiledAcceleration)
      } else if (
        sample.t - this.armedAt >= config.armTimeoutMs
        || sample.rotationMagnitude < config.armResetRotation
      ) {
        this.state = 'idle'
        this.armedSince = null
      }
      return null
    }

    const active = this.active
    if (!active) {
      this.reset()
      return null
    }

    const positiveAcceleration = positiveProjection(
      profiledAcceleration,
      active.accelerationDirection,
    )
    const positiveRotation = positiveProjection(
      sample.rotation,
      active.rotationDirection,
    )
    if (positiveAcceleration > active.peakAcceleration) {
      active.peakAcceleration = positiveAcceleration
      active.peakAccelerationAt = sample.t
      active.peakAccelerationVector = [...profiledAcceleration]
    }
    if (positiveRotation > active.peakRotation && (this.sport !== 'boxing' || positiveAcceleration > 0)) {
      active.peakRotation = positiveRotation
      active.peakRotationVector = [...sample.rotation]
    }

    const duration = Math.max(0, sample.t - active.startedAt)
    const releaseThreshold = Math.max(
      config.releaseAcceleration,
      active.peakAcceleration * config.releasePeakRatio,
    )
    const settled = positiveAcceleration <= releaseThreshold
      && duration >= config.minDurationMs
    if (!settled && duration < config.maxDurationMs) return null

    const accelerationPower = this.normalizedPower(
      active.peakAcceleration,
      config.startAcceleration,
      config.powerAccelerationMax,
    )
    const rotationPower = this.normalizedPower(
      active.peakRotation,
      config.mode === 'swing' ? config.armRotation : 0,
      config.powerRotationMax,
    )
    const power = Math.round(100 * (
      Math.pow(accelerationPower, config.powerCurveExponent) * config.accelerationWeight
      + Math.pow(rotationPower, config.powerCurveExponent) * config.rotationWeight
    ))
    const direction = combineDirection(active, config, this.directionMode)
    const directionReport = classifyDirection(direction)
    const gesture: DetectedGesture = {
      gesture: config.gesture,
      t: active.peakAccelerationAt,
      power,
      direction,
      peakAcceleration: active.peakAcceleration,
      peakRotation: active.peakRotation,
      duration,
      ...directionReport,
    }

    this.active = null
    this.state = 'cooldown'
    this.cooldownUntil = active.peakAccelerationAt + config.cooldownMs
    this.cooldownRearmed = movementAcceleration <= config.rearmAcceleration
    this.armedSince = null
    return gesture
  }

  private beginGesture(sample: ProcessedMotion, profiledAcceleration: Vector3): void {
    const accelerationDirection = this.sport === 'boxing' && this.opponentDirection
      ? this.opponentDirection : normalize(profiledAcceleration)
    const rotationDirection = normalize(sample.rotation)
    const positiveAcceleration = positiveProjection(
      profiledAcceleration,
      accelerationDirection,
    )
    const positiveRotation = positiveProjection(sample.rotation, rotationDirection)
    this.state = 'tracking'
    this.active = {
      startedAt: sample.t,
      peakAcceleration: positiveAcceleration,
      peakAccelerationAt: sample.t,
      peakAccelerationVector: [...profiledAcceleration],
      accelerationDirection,
      peakRotation: positiveRotation,
      peakRotationVector: [...sample.rotation],
      rotationDirection,
    }
  }

  private normalizedPower(value: number, threshold: number, maximum: number): number {
    if (maximum <= threshold) return value >= maximum ? 1 : 0
    return clamp01((value - threshold) / (maximum - threshold))
  }
}

function emptySnapshot(): MotionSnapshot {
  return {
    t: 0,
    acceleration: [...ZERO_VECTOR],
    rotation: [...ZERO_VECTOR],
    accelerationMagnitude: 0,
    rotationMagnitude: 0,
    intervalMs: 0,
    sensorHz: 0,
    calibration: 'uncalibrated',
    calibrationProgress: 0,
    calibrationMessage: 'Calibrate while holding the phone still',
    detector: 'idle',
  }
}

export class MotionProcessor {
  private detector: GestureDetector
  private sport: Sport
  private directionMode: DirectionMode
  private detectionEnabled = true
  private onGesture: ((gesture: DetectedGesture) => void) | null = null
  private snapshot = emptySnapshot()
  private lastSampleTime: number | null = null
  private filteredAcceleration: Vector3 = [...ZERO_VECTOR]
  private filteredRotation: Vector3 = [...ZERO_VECTOR]
  private filterInitialized = false
  private accelerationBias: Vector3 = [...ZERO_VECTOR]
  private rotationBias: Vector3 = [...ZERO_VECTOR]
  private receiveTimes: number[] = []
  private calibrationStartedAt: number | null = null
  private calibrationCount = 0
  private calibrationAccelerationSum: Vector3 = [...ZERO_VECTOR]
  private calibrationAccelerationSquaredSum: Vector3 = [...ZERO_VECTOR]
  private calibrationRotationSum: Vector3 = [...ZERO_VECTOR]
  private calibrationRotationSquaredSum: Vector3 = [...ZERO_VECTOR]

  constructor(sport: Sport, directionMode = DEFAULT_DIRECTION_MODE[sport]) {
    this.sport = sport
    this.directionMode = directionMode
    this.detector = new GestureDetector(sport, directionMode)
  }

  setGestureHandler(handler: ((gesture: DetectedGesture) => void) | null): void {
    this.onGesture = handler
  }

  setSport(sport: Sport): void {
    if (sport === this.sport) return
    this.sport = sport
    this.detector.setSport(sport)
    this.snapshot.detector = this.detector.getState()
  }

  setDirectionMode(directionMode: DirectionMode): void {
    if (directionMode === this.directionMode) return
    this.directionMode = directionMode
    this.detector.setDirectionMode(directionMode)
    this.snapshot.detector = this.detector.getState()
  }

  setDetectionEnabled(enabled: boolean): void {
    if (enabled === this.detectionEnabled) return
    this.detectionEnabled = enabled
    this.detector.reset()
    this.snapshot.detector = this.detector.getState()
  }

  resetDetector(): void {
    this.detector.reset()
    this.snapshot.detector = this.detector.getState()
  }

  reset(): void {
    this.detector.reset(true)
    this.lastSampleTime = null
    this.filterInitialized = false
    this.receiveTimes = []
    this.snapshot = emptySnapshot()
    this.accelerationBias = [...ZERO_VECTOR]
    this.rotationBias = [...ZERO_VECTOR]
    this.calibrationStartedAt = null
    this.calibrationCount = 0
  }

  startCalibration(): void {
    this.detector.reset(true)
    this.filterInitialized = false
    this.calibrationStartedAt = null
    this.calibrationCount = 0
    this.calibrationAccelerationSum = [...ZERO_VECTOR]
    this.calibrationAccelerationSquaredSum = [...ZERO_VECTOR]
    this.calibrationRotationSum = [...ZERO_VECTOR]
    this.calibrationRotationSquaredSum = [...ZERO_VECTOR]
    this.snapshot.calibration = 'calibrating'
    this.snapshot.calibrationProgress = 0
    this.snapshot.calibrationMessage = 'Hold completely still'
    this.snapshot.detector = this.detector.getState()
  }

  getSnapshot(): MotionSnapshot {
    return {
      ...this.snapshot,
      acceleration: [...this.snapshot.acceleration],
      rotation: [...this.snapshot.rotation],
    }
  }

  push(sample: Sample): ProcessedMotion {
    const t = sample[0] >= performance.timeOrigin
      ? sample[0] - performance.timeOrigin
      : sample[0]
    const fallbackInterval = 1_000 / CONTROLLER_CONFIG.filter.referenceRateHz
    const unboundedInterval = this.lastSampleTime === null ? fallbackInterval : t - this.lastSampleTime
    const intervalMs = Number.isFinite(unboundedInterval)
      ? Math.max(
          CONTROLLER_CONFIG.filter.minIntervalMs,
          Math.min(CONTROLLER_CONFIG.filter.maxIntervalMs, unboundedInterval),
        )
      : fallbackInterval
    this.lastSampleTime = t

    this.receiveTimes.push(t)
    while (
      this.receiveTimes.length > 1
      && this.receiveTimes[0] < t - CONTROLLER_CONFIG.filter.sensorRateWindowMs
    ) {
      this.receiveTimes.shift()
    }
    const sensorSpan = this.receiveTimes.length > 1
      ? this.receiveTimes[this.receiveTimes.length - 1] - this.receiveTimes[0]
      : 0
    const sensorHz = sensorSpan > 0
      ? (this.receiveTimes.length - 1) * 1_000 / sensorSpan
      : 0

    const screenAngle = currentScreenAngle()
    const rawAcceleration = orientVectorToScreen(
      [sample[1], sample[2], sample[3]],
      screenAngle,
    )
    // DeviceMotion reports alpha around Z, beta around X, and gamma around Y.
    const rawRotation = orientVectorToScreen(
      [sample[8], sample[9], sample[7]],
      screenAngle,
    )
    this.updateCalibration(rawAcceleration, rawRotation, t)

    const acceleration: Vector3 = [
      rawAcceleration[0] - this.accelerationBias[0],
      rawAcceleration[1] - this.accelerationBias[1],
      rawAcceleration[2] - this.accelerationBias[2],
    ]
    const rotation: Vector3 = [
      rawRotation[0] - this.rotationBias[0],
      rawRotation[1] - this.rotationBias[1],
      rawRotation[2] - this.rotationBias[2],
    ]
    const alpha = 1 - Math.pow(
      1 - CONTROLLER_CONFIG.filter.alphaAtReferenceRate,
      intervalMs / fallbackInterval,
    )
    if (!this.filterInitialized) {
      this.filteredAcceleration = [...acceleration]
      this.filteredRotation = [...rotation]
      this.filterInitialized = true
    } else {
      for (let axis = 0; axis < 3; axis += 1) {
        this.filteredAcceleration[axis] += alpha
          * (acceleration[axis] - this.filteredAcceleration[axis])
        this.filteredRotation[axis] += alpha
          * (rotation[axis] - this.filteredRotation[axis])
      }
    }

    const processed: ProcessedMotion = {
      t,
      acceleration: [...this.filteredAcceleration],
      rotation: [...this.filteredRotation],
      accelerationMagnitude: magnitude(this.filteredAcceleration),
      rotationMagnitude: magnitude(this.filteredRotation),
      intervalMs,
      sensorHz,
    }
    if (this.snapshot.calibration === 'calibrated' && this.detectionEnabled) {
      const gesture = this.detector.push(processed)
      if (gesture) this.onGesture?.(gesture)
    }
    this.snapshot = {
      ...processed,
      calibration: this.snapshot.calibration,
      calibrationProgress: this.snapshot.calibrationProgress,
      calibrationMessage: this.snapshot.calibrationMessage,
      detector: this.detector.getState(),
    }
    return processed
  }

  private updateCalibration(acceleration: Vector3, rotation: Vector3, now: number): void {
    if (this.snapshot.calibration !== 'calibrating') return

    this.calibrationStartedAt ??= now
    this.calibrationCount += 1
    for (let axis = 0; axis < 3; axis += 1) {
      this.calibrationAccelerationSum[axis] += acceleration[axis]
      this.calibrationAccelerationSquaredSum[axis] += acceleration[axis] ** 2
      this.calibrationRotationSum[axis] += rotation[axis]
      this.calibrationRotationSquaredSum[axis] += rotation[axis] ** 2
    }
    const elapsed = now - this.calibrationStartedAt
    this.snapshot.calibrationProgress = clamp01(
      elapsed / CONTROLLER_CONFIG.calibration.durationMs,
    )
    if (elapsed < CONTROLLER_CONFIG.calibration.durationMs) return

    if (this.calibrationCount < CONTROLLER_CONFIG.calibration.minSamples) {
      this.failCalibration('Not enough sensor samples — try again')
      return
    }

    const accelerationNoise = this.calibrationNoise(
      this.calibrationAccelerationSum,
      this.calibrationAccelerationSquaredSum,
    )
    const rotationNoise = this.calibrationNoise(
      this.calibrationRotationSum,
      this.calibrationRotationSquaredSum,
    )
    if (
      accelerationNoise > CONTROLLER_CONFIG.calibration.maxAccelerationNoise
      || rotationNoise > CONTROLLER_CONFIG.calibration.maxRotationNoise
    ) {
      this.failCalibration('Phone moved during calibration — hold still and retry')
      return
    }

    for (let axis = 0; axis < 3; axis += 1) {
      this.accelerationBias[axis] = this.calibrationAccelerationSum[axis]
        / this.calibrationCount
      this.rotationBias[axis] = this.calibrationRotationSum[axis]
        / this.calibrationCount
    }
    this.filterInitialized = false
    this.snapshot.calibration = 'calibrated'
    this.snapshot.calibrationProgress = 1
    this.snapshot.calibrationMessage = 'Ready for gestures'
  }

  private calibrationNoise(sum: Vector3, squaredSum: Vector3): number {
    let combinedVariance = 0
    for (let axis = 0; axis < 3; axis += 1) {
      const mean = sum[axis] / this.calibrationCount
      combinedVariance += Math.max(0, squaredSum[axis] / this.calibrationCount - mean ** 2)
    }
    return Math.sqrt(combinedVariance)
  }

  private failCalibration(message: string): void {
    this.snapshot.calibration = 'failed'
    this.snapshot.calibrationProgress = 0
    this.snapshot.calibrationMessage = message
    this.detector.reset()
  }
}
