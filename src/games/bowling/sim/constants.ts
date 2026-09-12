import type { V2 } from './types'

export const HZ = 120
export const DT = 1 / HZ
export const ticks = (seconds: number): number => Math.round(seconds * HZ)

// lane (metres): x lateral, z down the lane, foul line at z = 0
export const LANE_LEN = 18.29
export const LANE_HALF = 0.525
export const GUTTER_W = 0.24
export const BALL_START_Z = -1.0
export const OIL_Z = 12

// pins and ball
export const PIN_Z = LANE_LEN - 0.9        // head pin
export const PIN_SPACING = 0.305
export const PIN_ROW = PIN_SPACING * Math.sqrt(3) / 2
export const PIN_R = 0.06
/** Contact radius of a knocked pin: a tumbling pin sweeps far more floor than its standing footprint. */
export const PIN_R_DOWN = 0.095
export const BALL_R = 0.109
export const PIN_MASS = 1.5
export const BALL_MASS = 7
/** Standard rack: pin 1 nearest the bowler, pins 2/3 behind it (2 at -x), then 4-6, then 7-10. */
export const PIN_SPOTS: readonly V2[] = (() => {
  const out: V2[] = []
  for (let row = 0; row < 4; row++) for (let i = 0; i <= row; i++) out.push({ x: (i - row / 2) * PIN_SPACING, z: PIN_Z + row * PIN_ROW })
  return out
})()

// ball motion
export const SPEED_MIN = 5
export const SPEED_MAX = 9
export const ROLL_FRICTION = 0.35
export const HOOK_ACCEL = 2.2
export const BALL_STOP_SPEED = 0.2
export const BALL_END_Z = 20
export const SHOT_LIMITS = { lanePos: 0.45, angleDeg: 4 }
/** Seeded release jitter applied to every delivery (human or bot). */
export const JITTER = { lanePos: 0.012, angleDeg: 0.1, power: 0.02 }

// pin physics
export const E_BALL_PIN = 0.55
export const E_PIN_PIN = 0.7
export const PIN_FRICTION = 2.5
export const PIN_DOWN_DIST = 0.08
export const PIN_DOWN_SPEED = 1.2
export const DECK_HALF = 0.6
export const DECK_END_Z = 19.5
export const SOLVER_ITERS = 4

// flow
export const SETTLE_TICKS = ticks(1.0)
export const SETTLE_MAX = ticks(3.0)
export const FRAME_END_TICKS = ticks(1.0)
export const BOT_DELAY = ticks(0.4)
export const FRAMES = 10

// aiming
export const POCKET_X = 0.09
export const AIM_MAX_X = LANE_HALF - BALL_R - 0.015 // widest ball centre that still clears the gutter

/** The aim line sways left and right on its own; release timing matters for humans and bots alike. */
export const AIM_SWAY = { ampDeg: 1.6, periodTicks: ticks(4.2) }
export const swayDeg = (tick: number): number => AIM_SWAY.ampDeg * Math.sin((2 * Math.PI * tick) / AIM_SWAY.periodTicks)
export const BOT_MAX_WAIT = ticks(3.5)
export const BOT_CHARGE = ticks(0.6) // a bot holds its charge this long after locking the line
