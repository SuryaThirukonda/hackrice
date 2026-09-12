import type { KeyState } from '../../input/keys'
import { SHOT_LIMITS } from './sim/constants'

export interface BowlingBindings { left: string[]; right: string[]; aimL: string[]; aimR: string[]; hookL: string[]; hookR: string[]; roll: string[]; confirm: string[] }
export const BOWLING_KEYS: BowlingBindings = {
  left: ['KeyA'], right: ['KeyD'], aimL: ['KeyQ'], aimR: ['KeyE'],
  hookL: ['ArrowLeft'], hookR: ['ArrowRight'], roll: ['Space'], confirm: ['Enter'],
}
/** Human-readable labels for tutorials and overlays, generated from the same table. */
export const BOWLING_HELP: { action: keyof BowlingBindings; label: string; hint: string }[] = [
  { action: 'left', label: 'Step left (hold)', hint: 'slide across the approach' },
  { action: 'right', label: 'Step right (hold)', hint: 'slide across the approach' },
  { action: 'aimL', label: 'Aim left (hold)', hint: 'turn the release angle, up to 4°' },
  { action: 'aimR', label: 'Aim right (hold)', hint: 'turn the release angle, up to 4°' },
  { action: 'hookL', label: 'Hook left (tap)', hint: 'the ball curves left after the oil line' },
  { action: 'hookR', label: 'Hook right (tap)', hint: 'the ball curves right after the oil line' },
  { action: 'roll', label: 'Lock, then charge', hint: 'tap once to stop the sweeping line; hold and release for power' },
  { action: 'confirm', label: 'Lock the line', hint: 'alternative to the first tap' },
]
export const keyLabel = (code: string): string => code.replace('Key', '').replace('Arrow', '').replace('Space', 'Space')

export type Axis = -1 | 0 | 1
export interface BowlingInput { moveLane: Axis; aim: Axis; hook: Axis; meterPress: boolean; meterDown: boolean; meterRelease: boolean; confirm: boolean }
export interface AimState { lanePos: number; angleDeg: number; hook: number }

/** Remembers whether the charge key was held last frame so the release edge can be detected from held state alone. */
export class MeterTracker {
  private wasDown = false
  /** Feed this frame's held state; true exactly on the frame the key went up. */
  sample(down: boolean): boolean { const rel = this.wasDown && !down; this.wasDown = down; return rel }
  reset(): void { this.wasDown = false }
}
const sharedMeter = new MeterTracker()

const axis = (neg: boolean, pos: boolean): Axis => (neg === pos ? 0 : neg ? -1 : 1)

/** Build this frame's input. Lane and aim are held axes; hook taps and the confirm key use press edges; the meter release is an up edge. */
export function bowlingInput(k: KeyState, b: BowlingBindings = BOWLING_KEYS, meter: MeterTracker = sharedMeter): BowlingInput {
  const meterDown = k.isDown(...b.roll)
  return {
    moveLane: axis(k.isDown(...b.left), k.isDown(...b.right)),
    aim: axis(k.isDown(...b.aimL), k.isDown(...b.aimR)),
    hook: axis(k.justPressed(...b.hookL), k.justPressed(...b.hookR)),
    meterPress: k.justPressed(...b.roll),
    meterDown,
    meterRelease: meter.sample(meterDown),
    confirm: k.justPressed(...b.confirm),
  }
}

export const METER_HZ = 1.2
export const METER_PERIOD_MS = 1000 / METER_HZ
/** Power meter value at time t (ms since the charge began): triangle wave 0 → 1 → 0 once per period. */
export function meterValue(tMs: number): number {
  const ph = (((tMs / METER_PERIOD_MS) % 1) + 1) % 1
  return ph < 0.5 ? ph * 2 : 2 - ph * 2
}

export const LANE_SPEED = 0.5
export const ANGLE_SPEED = 4
export const HOOK_STEP = 0.2
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
/** Advance the aim state by one frame of input. Pure: returns a new state, never mutates. */
export function applyAim(s: AimState, i: BowlingInput, dtS: number): AimState {
  const L = SHOT_LIMITS
  return {
    lanePos: clamp(s.lanePos + i.moveLane * LANE_SPEED * dtS, -L.lanePos, L.lanePos),
    angleDeg: clamp(s.angleDeg + i.aim * ANGLE_SPEED * dtS, -L.angleDeg, L.angleDeg),
    hook: clamp(Math.round((s.hook + i.hook * HOOK_STEP) * 10) / 10, -1, 1),
  }
}
export const defaultAim = (): AimState => ({ lanePos: 0, angleDeg: 0, hook: 0 })
