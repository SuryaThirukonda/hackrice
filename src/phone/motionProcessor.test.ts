import { describe, expect, it } from 'vitest'
import type { Sample } from './sample'
import { CONTROLLER_CONFIG, type DirectionMode, type Sport } from './config'
import {
  classifyDirection,
  MotionProcessor,
  orientVectorToScreen,
  type DetectedGesture,
  type Vector3,
} from './motionProcessor'

const DT = 1_000 / 60

function sample(
  t: number,
  acceleration: Vector3 = [0, 0, 0],
  rotation: Vector3 = [0, 0, 0],
): Sample {
  return [
    t,
    acceleration[0],
    acceleration[1],
    acceleration[2],
    acceleration[0],
    acceleration[1] + 9.81,
    acceleration[2],
    rotation[0],
    rotation[1],
    rotation[2],
    0,
    90,
    0,
  ]
}

function calibratedProcessor(
  sport: Sport,
  accelerationBias: Vector3 = [0, 0, 0],
  rotationBias: Vector3 = [0, 0, 0],
  directionMode?: DirectionMode,
): { processor: MotionProcessor; events: DetectedGesture[]; nextTime: number } {
  const processor = new MotionProcessor(sport, directionMode)
  const events: DetectedGesture[] = []
  processor.setGestureHandler((gesture) => events.push(gesture))
  processor.startCalibration()
  let t = 0
  const end = CONTROLLER_CONFIG.calibration.durationMs + DT
  while (t <= end) {
    processor.push(sample(t, accelerationBias, rotationBias))
    t += DT
  }
  expect(processor.getSnapshot().calibration).toBe('calibrated')
  return { processor, events, nextTime: t + DT }
}

function feedVectors(
  processor: MotionProcessor,
  startTime: number,
  vectors: Array<{ acceleration: Vector3; rotation?: Vector3 }>,
): number {
  let t = startTime
  for (const vector of vectors) {
    processor.push(sample(t, vector.acceleration, vector.rotation ?? [0, 0, 0]))
    t += DT
  }
  return t
}

function quietFrames(count: number, acceleration = 0): Array<{ acceleration: Vector3 }> {
  return Array.from({ length: count }, () => ({
    acceleration: [0, acceleration, 0] as Vector3,
  }))
}

function punchFrames(peak = 22): Array<{ acceleration: Vector3; rotation: Vector3 }> {
  return [0, 3, 9, 15, peak, peak * 0.82, peak * 0.48, 5, 3].map(
    (value, index) => ({
      acceleration: [0, value, 0],
      rotation: [0, 0, index >= 2 && index <= 6 ? 90 : 8],
    }),
  )
}

function swingFrames(
  accelerationPeak: number,
  rotationPeak: number,
  direction: Vector3,
): Array<{ acceleration: Vector3; rotation: Vector3 }> {
  const arm = Array.from({ length: 5 }, (_, index) => ({
    acceleration: [0, index * 0.5, 0] as Vector3,
    rotation: [rotationPeak * 0.72, 0, 0] as Vector3,
  }))
  const strike = [4, 8, accelerationPeak * 0.72, accelerationPeak, accelerationPeak * 0.7, 7, 3, 1]
    .map((magnitude, index) => ({
      acceleration: direction.map((component) => component * magnitude) as Vector3,
      rotation: [
        rotationPeak,
        index < 5 ? rotationPeak * 0.2 : rotationPeak * 0.08,
        0,
      ] as Vector3,
    }))
  return [...arm, ...strike]
}

describe('MotionProcessor', () => {
  it('accepts a punching-grip Z stroke after learning an upright Y stroke', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    const t = feedVectors(processor, nextTime, [...punchFrames(18), ...quietFrames(30)])
    feedVectors(processor, t, [
      ...punchFrames(18).map(f => ({ ...f, acceleration: [0, 0, -f.acceleration[1]] as Vector3 })),
      ...quietFrames(30),
    ])
    expect(events).toHaveLength(2)
    expect(events[1].power).toBeCloseTo(events[0].power, 0)
  })

  it.each(['golf', 'bowling'] as Sport[])('%s scores the same absolute swing in either direction', sport => {
    const forward = calibratedProcessor(sport)
    const backward = calibratedProcessor(sport)
    const frames: Array<{ acceleration: Vector3; rotation?: Vector3 }> = [...swingFrames(28, 460, [0, 0, 1]), ...quietFrames(45)]
    feedVectors(forward.processor, forward.nextTime, frames)
    feedVectors(backward.processor, backward.nextTime, frames.map(f => ({
      acceleration: f.acceleration.map(v => -v) as Vector3,
      rotation: (f.rotation ?? [0, 0, 0]).map(v => -v) as Vector3,
    })))
    expect(forward.events).toHaveLength(1)
    expect(backward.events).toHaveLength(1)
    expect(backward.events[0].power).toBe(forward.events[0].power)
  })
  it('learns forward from the punch peak after a sideways wrist lead-in', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    let t = feedVectors(processor, nextTime, [
      { acceleration: [8, 0, 0] },
      { acceleration: [4, 14, 0] },
      { acceleration: [1, 24, 0] },
      { acceleration: [0, 24, 0] },
      ...quietFrames(30),
    ])
    expect(events).toHaveLength(1)
    expect(events[0].peakAcceleration).toBeGreaterThan(18)
    t = feedVectors(processor, t, [...punchFrames(24), ...quietFrames(30)])
    expect(events).toHaveLength(2)
    expect(events[1].power).toBeGreaterThan(60)
  })

  it('measures gyro rotation even when its axis changes during the forward punch', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    feedVectors(processor, nextTime, [
      { acceleration: [0, 8, 0], rotation: [2, 0, 0] },
      { acceleration: [0, 15, 0], rotation: [0, 0, 300] },
      { acceleration: [0, 18, 0], rotation: [0, 0, 400] },
      ...quietFrames(20),
    ])
    expect(events).toHaveLength(1)
    expect(events[0].peakRotation).toBeGreaterThan(200)
  })
  it('suppresses the positive braking pulse at the end of a retraction', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    // Eight quiet frames is the pause inside a real punch-and-pull-back, short of the stillness reset.
    let t = feedVectors(processor, nextTime, [...punchFrames(22), ...quietFrames(8)])
    t = feedVectors(processor, t, punchFrames(70).map(f => ({ acceleration: [0,-f.acceleration[1],0] as Vector3 })))
    feedVectors(processor, t, [...punchFrames(45), ...quietFrames(20)])
    expect(events).toHaveLength(1)
  })
  it('never counts an immediate stronger retraction as a second punch', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    let t = feedVectors(processor, nextTime, [...punchFrames(22), ...quietFrames(8)])
    const forwardPower = events[0].power
    t = feedVectors(processor, t, [
      ...punchFrames(90).map(f => ({ acceleration: [0, -f.acceleration[1], 0] as Vector3, rotation: f.rotation })),
      ...quietFrames(40),
    ])
    expect(events).toHaveLength(1)
    expect(events[0].power).toBe(forwardPower)
    feedVectors(processor, t, [...punchFrames(22), ...quietFrames(12)])
    expect(events).toHaveLength(2)
  })
  it('lets a punch go in any direction once the phone has come to rest', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    // Forward, then straight back toward the body, then sideways, then down: four different axes,
    // each after a real pause. Before the stillness reset the second one was thrown away as recoil.
    const strokes: Vector3[] = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [0, -1, 0]]
    let t = nextTime
    for (const axis of strokes) {
      const frames = punchFrames(20).map(f => ({ ...f, acceleration: axis.map(c => c * f.acceleration[1]) as Vector3 }))
      t = feedVectors(processor, t, [...frames, ...quietFrames(24)])
    }
    expect(events).toHaveLength(4)
    for (const [i, axis] of strokes.entries()) {
      const d = events[i].direction
      expect(d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]).toBeGreaterThan(0.75)
    }
    // Power does not depend on which way it went.
    const powers = events.map(e => e.power)
    expect(Math.max(...powers) - Math.min(...powers)).toBeLessThanOrEqual(2)
  })
  it('reports all six dominant directions without changing their vectors', () => {
    expect(classifyDirection([1, 0.2, 0])).toEqual({ dominantAxis: 'x', directionLabel: 'right' })
    expect(classifyDirection([-1, 0.2, 0])).toEqual({ dominantAxis: 'x', directionLabel: 'left' })
    expect(classifyDirection([0.1, 1, 0])).toEqual({ dominantAxis: 'y', directionLabel: 'up' })
    expect(classifyDirection([0.1, -1, 0])).toEqual({ dominantAxis: 'y', directionLabel: 'down' })
    expect(classifyDirection([0.1, 0, 1])).toEqual({ dominantAxis: 'z', directionLabel: 'front' })
    expect(classifyDirection([0.1, 0, -1])).toEqual({ dominantAxis: 'z', directionLabel: 'back' })
  })

  it('keeps directions screen-relative in every device orientation', () => {
    const vector: Vector3 = [2, 5, 7]
    expect(orientVectorToScreen(vector, 0)).toEqual([2, 5, 7])
    expect(orientVectorToScreen(vector, 90)).toEqual([-5, 2, 7])
    expect(orientVectorToScreen(vector, 180)).toEqual([-2, -5, 7])
    expect(orientVectorToScreen(vector, 270)).toEqual([5, -2, 7])
  })

  it('does not emit while stationary', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    let t = nextTime
    for (let index = 0; index < 600; index += 1) {
      const acceleration = 0.18 * Math.sin(index * 0.31)
      const rotation = 3 * Math.cos(index * 0.19)
      processor.push(sample(t, [acceleration, 0, 0], [0, 0, rotation]))
      t += DT
    }
    expect(events).toEqual([])
    expect(processor.getSnapshot().detector).toBe('idle')
  })

  it('detects a boxing punch with normalized direction', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    feedVectors(processor, nextTime, [...punchFrames(), ...quietFrames(8)])

    expect(events).toHaveLength(1)
    expect(events[0].gesture).toBe('punch')
    expect(events[0].power).toBeGreaterThan(0)
    expect(Math.hypot(...events[0].direction)).toBeCloseTo(1, 6)
    expect(events[0].peakAcceleration).toBeGreaterThan(10)
    expect(events[0].duration).toBeGreaterThan(0)
  })

  it('detects a moderate phone jab and gives it non-zero power', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    feedVectors(processor, nextTime, [...punchFrames(6), ...quietFrames(8)])

    expect(events).toHaveLength(1)
    expect(events[0].gesture).toBe('punch')
    expect(events[0].power).toBeGreaterThan(0)
  })

  it.each([
    ['right', [1, 0, 0] as Vector3],
    ['up', [0, 1, 0] as Vector3],
    ['outward', [0, 0, 1] as Vector3],
    ['diagonal', [0.58, 0.58, 0.58] as Vector3],
  ])('detects a Mixed 3D punch moving %s', (_label, direction) => {
    const { processor, events, nextTime } = calibratedProcessor(
      'boxing',
      [0, 0, 0],
      [0, 0, 0],
      'mixed_3d',
    )
    const frames = punchFrames(24).map((frame) => ({
      ...frame,
      acceleration: direction.map(
        (component) => component * frame.acceleration[1],
      ) as Vector3,
    }))
    feedVectors(processor, nextTime, [...frames, ...quietFrames(8)])

    expect(events).toHaveLength(1)
    expect(events[0].gesture).toBe('punch')
    expect(
      events[0].direction[0] * direction[0]
      + events[0].direction[1] * direction[1]
      + events[0].direction[2] * direction[2],
    ).toBeGreaterThan(0.75)
  })

  it('detects rapid double punches without a full neutral reset', () => {
    const { processor, events, nextTime } = calibratedProcessor('boxing')
    let t = feedVectors(processor, nextTime, punchFrames())
    t = feedVectors(processor, t, quietFrames(9, 5))
    feedVectors(processor, t, [...punchFrames(20), ...quietFrames(8, 4)])

    expect(events.map((event) => event.gesture)).toEqual(['punch', 'punch'])
    expect(events[1].t - events[0].t).toBeLessThan(400)
  })

  it('detects a rotation-led golf swing', () => {
    const { processor, events, nextTime } = calibratedProcessor('golf')
    feedVectors(
      processor,
      nextTime,
      [...swingFrames(27, 460, [0.15, 0.98, 0]), ...quietFrames(10)],
    )

    expect(events).toHaveLength(1)
    expect(events[0].gesture).toBe('golf_swing')
    expect(events[0].peakRotation).toBeGreaterThan(250)
    // an ordinary swing lands in the 20s: the ceiling was raised so 100 takes an all-out effort
    expect(events[0].power).toBeGreaterThan(15)
    expect(events[0].power).toBeLessThan(35)
    expect(Math.hypot(...events[0].direction)).toBeCloseTo(1, 6)
  })

  it('scores a strong swing in the 40s and 50s, and only an all-out swing near 100', () => {
    const strong = calibratedProcessor('golf')
    feedVectors(strong.processor, strong.nextTime, [...swingFrames(38, 650, [0.1, 0.99, 0]), ...quietFrames(10)])
    expect(strong.events).toHaveLength(1)
    expect(strong.events[0].power).toBeGreaterThanOrEqual(40)
    expect(strong.events[0].power).toBeLessThanOrEqual(58)
    // 100 is still reachable, it just costs everything the arm has
    const allOut = calibratedProcessor('golf')
    feedVectors(allOut.processor, allOut.nextTime, [...swingFrames(72, 1_500, [0.1, 0.99, 0]), ...quietFrames(10)])
    expect(allOut.events).toHaveLength(1)
    expect(allOut.events[0].power).toBeGreaterThanOrEqual(95)
  })

  it('detects a separately tuned bowling swing and direction', () => {
    const { processor, events, nextTime } = calibratedProcessor('bowling')
    feedVectors(
      processor,
      nextTime,
      [...swingFrames(23, 330, [0.35, 0.94, 0]), ...quietFrames(10)],
    )

    expect(events).toHaveLength(1)
    expect(events[0].gesture).toBe('bowling_swing')
    expect(events[0].direction[1]).toBeGreaterThan(0.5)
    expect(events[0].power).toBeGreaterThan(10) // a gentle roll; the raised ceiling keeps 100 for a real heave
  })

  it('can gate detection to a single capture window', () => {
    const { processor, events, nextTime } = calibratedProcessor('golf')
    processor.setDetectionEnabled(false)
    let t = feedVectors(
      processor,
      nextTime,
      [...swingFrames(32, 540, [0, 1, 0]), ...quietFrames(10)],
    )
    expect(events).toEqual([])

    processor.setDetectionEnabled(true)
    processor.resetDetector()
    feedVectors(
      processor,
      t,
      [...swingFrames(32, 540, [0, 1, 0]), ...quietFrames(10)],
    )
    expect(events).toHaveLength(1)
  })

  it('produces identical mechanics and scores for Player 1 and Player 2 inputs', () => {
    const player1 = calibratedProcessor('bowling')
    const player2 = calibratedProcessor('bowling')
    const frames = [...swingFrames(34, 560, [0.2, 0.98, 0]), ...quietFrames(10)]

    feedVectors(player1.processor, player1.nextTime, frames)
    feedVectors(player2.processor, player2.nextTime, frames)

    expect(player1.events).toHaveLength(1)
    expect(player2.events).toEqual(player1.events)
  })

  it('clamps gesture power to the 0-100 wire range', () => {
    const { processor, events, nextTime } = calibratedProcessor('golf')
    feedVectors(
      processor,
      nextTime,
      [...swingFrames(180, 2_000, [0, 1, 0]), ...quietFrames(10)],
    )

    expect(events).toHaveLength(1)
    expect(events[0].power).toBe(100)
  })

  it('ignores the reverse stroke when calculating power and direction', () => {
    const { processor, events, nextTime } = calibratedProcessor(
      'boxing',
      [0, 0, 0],
      [0, 0, 0],
      'mixed_3d',
    )
    feedVectors(processor, nextTime, [
      { acceleration: [0, 8, 0], rotation: [0, 0, 80] },
      { acceleration: [0, 18, 0], rotation: [0, 0, 120] },
      { acceleration: [0, -70, 0], rotation: [0, 0, -1_000] },
      { acceleration: [0, -100, 0], rotation: [0, 0, -1_400] },
      ...quietFrames(6),
    ])

    expect(events).toHaveLength(1)
    expect(events[0].peakAcceleration).toBeLessThan(20)
    expect(events[0].peakRotation).toBeLessThan(150)
    // The forward stroke is intentionally useful, but the much larger reverse
    // acceleration must not inflate it to a maximum-power punch.
    expect(events[0].power).toBeGreaterThan(35)
    expect(events[0].power).toBeLessThan(70)
    expect(events[0].direction[1]).toBeGreaterThan(0.8)
  })

  it('uses only the selected screen axis for directional profiles', () => {
    const { processor, events, nextTime } = calibratedProcessor(
      'boxing',
      [0, 0, 0],
      [0, 0, 0],
      'left_right',
    )
    let t = feedVectors(processor, nextTime, [
      ...punchFrames(),
      ...quietFrames(8),
    ])
    expect(events).toEqual([])

    const horizontalPunch = punchFrames().map((frame) => ({
      ...frame,
      acceleration: [frame.acceleration[1], 0, 0] as Vector3,
    }))
    t = feedVectors(processor, t, [...horizontalPunch, ...quietFrames(8)])
    expect(events).toHaveLength(1)
    expect(Math.abs(events[0].direction[0])).toBeGreaterThan(0.9)
  })

  it('calibrates baseline bias and reset clears calibration', () => {
    const accelerationBias: Vector3 = [0.8, -0.4, 0.25]
    const rotationBias: Vector3 = [2, -3, 4]
    const { processor, nextTime } = calibratedProcessor(
      'boxing',
      accelerationBias,
      rotationBias,
    )
    for (let index = 0; index < 8; index += 1) {
      processor.push(sample(nextTime + index * DT, accelerationBias, rotationBias))
    }

    const calibrated = processor.getSnapshot()
    expect(calibrated.accelerationMagnitude).toBeLessThan(0.01)
    expect(calibrated.rotationMagnitude).toBeLessThan(0.01)

    processor.reset()
    const reset = processor.getSnapshot()
    expect(reset.calibration).toBe('uncalibrated')
    expect(reset.accelerationMagnitude).toBe(0)
    expect(reset.detector).toBe('idle')
  })
})
