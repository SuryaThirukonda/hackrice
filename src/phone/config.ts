export type Sport = 'golf' | 'boxing' | 'bowling'
export type GestureName = 'punch' | 'golf_swing' | 'bowling_swing'
export type DirectionMode = 'up_down' | 'left_right' | 'swing' | 'mixed_3d'

export const DEFAULT_DIRECTION_MODE: Record<Sport, DirectionMode> = {
  boxing: 'mixed_3d',
  golf: 'swing',
  bowling: 'swing',
}

export interface DetectorConfig {
  gesture: GestureName
  mode: 'punch' | 'swing'
  startAcceleration: number
  armRotation: number
  armDurationMs: number
  armResetRotation: number
  armTimeoutMs: number
  releaseAcceleration: number
  releasePeakRatio: number
  rearmAcceleration: number
  minDurationMs: number
  maxDurationMs: number
  cooldownMs: number
  powerAccelerationMax: number
  powerRotationMax: number
  accelerationWeight: number
  rotationWeight: number
  powerCurveExponent: number
  directionAccelerationWeight: number
  directionRotationWeight: number
  retriggerRiseRatio: number
}

/**
 * Controller tuning lives here so detector behavior can be adjusted on a
 * physical phone without hunting through UI, filtering, and socket code.
 * Acceleration is m/s², rotation is deg/s, and durations are milliseconds.
 */
export const CONTROLLER_CONFIG = {
  filter: {
    alphaAtReferenceRate: 0.55,
    referenceRateHz: 60,
    minIntervalMs: 4,
    maxIntervalMs: 100,
    sensorRateWindowMs: 1_000,
  },
  sensorFallback: {
    gravityMps2: 9.81,
    gravityTimeConstantMs: 750,
    nominalRateHz: 60,
  },
  calibration: {
    durationMs: 1_200,
    minSamples: 30,
    maxAccelerationNoise: 1.15,
    maxRotationNoise: 18,
  },
  stick: {
    maxTiltDegrees: 28,
    deadzone: 0.1,
    smoothing: 0.3,
    maxHz: 30,
  },
  detectors: {
    boxing: {
      gesture: 'punch',
      mode: 'punch',
      // Phone browsers vary substantially in their reported linear acceleration.
      // Keep this above calibrated hand jitter while allowing a normal jab to fire.
      startAcceleration: 3.8,
      armRotation: 0,
      armDurationMs: 0,
      armResetRotation: 0,
      armTimeoutMs: 0,
      releaseAcceleration: 2.2,
      releasePeakRatio: 0.48,
      rearmAcceleration: 2.8,
      minDurationMs: 34,
      maxDurationMs: 260,
      cooldownMs: 180,
      powerAccelerationMax: 20,
      powerRotationMax: 600,
      accelerationWeight: 1,
      rotationWeight: 0,
      powerCurveExponent: 1.05,
      directionAccelerationWeight: 0.9,
      directionRotationWeight: 0.1,
      retriggerRiseRatio: 0.2,
    },
    golf: {
      gesture: 'golf_swing',
      mode: 'swing',
      startAcceleration: 6.5,
      armRotation: 95,
      armDurationMs: 34,
      armResetRotation: 46,
      armTimeoutMs: 420,
      releaseAcceleration: 3.2,
      releasePeakRatio: 0.42,
      rearmAcceleration: 4,
      minDurationMs: 70,
      maxDurationMs: 520,
      cooldownMs: 260,
      // A committed, fast swing should land in the 50s and 60s; only an all-out one reads 100.
      powerAccelerationMax: 52,
      powerRotationMax: 950,
      accelerationWeight: 0.38,
      rotationWeight: 0.62,
      powerCurveExponent: 1.5,
      directionAccelerationWeight: 0.55,
      directionRotationWeight: 0.45,
      retriggerRiseRatio: 0.2,
    },
    bowling: {
      gesture: 'bowling_swing',
      mode: 'swing',
      startAcceleration: 5.8,
      armRotation: 78,
      armDurationMs: 42,
      armResetRotation: 38,
      armTimeoutMs: 500,
      releaseAcceleration: 2.8,
      releasePeakRatio: 0.4,
      rearmAcceleration: 3.8,
      minDurationMs: 85,
      maxDurationMs: 620,
      cooldownMs: 320,
      powerAccelerationMax: 48,
      powerRotationMax: 820,
      accelerationWeight: 0.64,
      rotationWeight: 0.36,
      powerCurveExponent: 1.5,
      directionAccelerationWeight: 0.78,
      directionRotationWeight: 0.22,
      retriggerRiseRatio: 0.2,
    },
  } satisfies Record<Sport, DetectorConfig>,
  socket: {
    protocolVersion: 1,
    pingIntervalMs: 1_000,
    helloTimeoutMs: 4_000,
    reconnectInitialMs: 250,
    reconnectMaxMs: 4_000,
    reconnectJitter: 0.2,
    rttWindowSize: 60,
    rawTelemetryMaxHz: 30,
    wirePrecision: 3,
  },
  ui: {
    refreshMs: 100,
    gestureFlashMs: 700,
    attemptCountdownSeconds: 3,
    attemptCaptureMs: 2_000,
  },
} as const
