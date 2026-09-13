import type { KeyState } from '../../input/keys'

export interface GolfBindings { clubUp: string[]; clubDown: string[]; aimLeft: string[]; aimRight: string[]; swing: string[]; view: string[] }
export const GOLF_KEYS: GolfBindings = {
  clubUp: ['KeyW'], clubDown: ['KeyS'], aimLeft: ['KeyA', 'ArrowLeft'], aimRight: ['KeyD', 'ArrowRight'], swing: ['Space'], view: ['Tab'],
}
/** Human-readable labels for tutorials and overlays, generated from the same table. */
export const GOLF_HELP: { action: keyof GolfBindings; label: string; hint: string }[] = [
  { action: 'clubUp', label: 'Longer club', hint: 'driver, 3 wood, 5 iron, 7 iron, wedge, putter' },
  { action: 'clubDown', label: 'Shorter club', hint: 'putter only on the green, no putter from sand' },
  { action: 'aimLeft', label: 'Aim left (hold)', hint: 'the preview shows a 60% shot in this wind' },
  { action: 'aimRight', label: 'Aim right (hold)', hint: 'compass heading; you start aimed at the cup' },
  { action: 'swing', label: 'Swing (3 presses)', hint: 'start, stop at full power, stop inside the green window for a straight shot' },
  { action: 'view', label: 'Top view', hint: 'toggle a map view over your ball while aiming' },
]
export const keyLabel = (code: string): string => code.replace('Key', '').replace('Arrow', '').replace('Space', 'Space')

/** One frame of golf input. club/swing/view are press edges (fire once per press); aim is held. */
export interface GolfInput { club: -1 | 0 | 1; aim: -1 | 0 | 1; swing: boolean; view: boolean }

export function golfInput(k: KeyState, b: GolfBindings = GOLF_KEYS): GolfInput {
  const up = k.justPressed(...b.clubUp), down = k.justPressed(...b.clubDown)
  const l = k.isDown(...b.aimLeft), r = k.isDown(...b.aimRight)
  return { club: up === down ? 0 : up ? 1 : -1, aim: l === r ? 0 : l ? -1 : 1, swing: k.justPressed(...b.swing), view: k.justPressed(...b.view) }
}

export type MeterState = 'idle' | 'armed' | 'power' | 'accuracy' | 'done'
export const POWER_SWEEP_S = 1.6
export const ACC_SWEEP_S = 1.0
/** Half-width of the forgiving green window on the accuracy sweep (-1..1): a stop inside it counts as a perfect, straight shot. */
export const ACC_SWEET = 0.07

/**
 * Three-press swing meter. idle -press-> power (value ping-pongs 0→1→0 over 1.6 s) -press-> captures power,
 * accuracy (value ping-pongs -1→1→-1 over 1.0 s) -press-> captures accuracy (0 = perfect), done.
 * Pure and frame-rate independent: drive it with update(dtSeconds).
 */
export class SwingMeter {
  state: MeterState = 'idle'
  /** Current sweep value: 0..1 while charging power, -1..1 while timing accuracy. */
  value = 0
  power = 0
  accuracy = 0
  private t = 0

  update(dtS: number): void {
    if (this.state !== 'power' && this.state !== 'accuracy') return
    this.t += Math.max(0, dtS)
    const period = this.state === 'power' ? POWER_SWEEP_S : ACC_SWEEP_S
    const u = (this.t % period) / period
    const pp = u < 0.5 ? u * 2 : 2 - u * 2 // ping-pong 0→1→0
    this.value = this.state === 'power' ? pp : pp * 2 - 1
  }

  press(): void {
    switch (this.state) {
      case 'idle': case 'armed': this.state = 'power'; this.t = 0; this.value = 0; break
      case 'power': this.power = this.value; this.state = 'accuracy'; this.t = 0; this.value = -1; break
      case 'accuracy': this.accuracy = Math.abs(this.value) <= ACC_SWEET ? 0 : this.value; this.state = 'done'; break
      default: break // extra presses once done are ignored
    }
  }

  result(): { power: number; accuracy: number } | null {
    return this.state === 'done' ? { power: this.power, accuracy: this.accuracy } : null
  }

  reset(): void { this.state = 'idle'; this.value = 0; this.power = 0; this.accuracy = 0; this.t = 0 }

  /** Phone path. A arms the swing; the swing itself then carries the power, and accuracy is taken as
   *  perfect because a real swing has no second timing window to hit. Both meter paths end in `done`,
   *  so the scene fires the shot the same way whichever one was used. */
  arm(): void { if (this.state === 'idle') this.state = 'armed' }
  cancel(): void { if (this.state === 'armed' || this.state === 'power' || this.state === 'accuracy') this.reset() }
  fromSwing(power: number): boolean {
    if (this.state !== 'armed' && this.state !== 'power' && this.state !== 'accuracy') return false
    this.power = Math.max(0.05, Math.min(1, power)); this.accuracy = 0; this.state = 'done'
    return true
  }
}

// ---- phone controller ----
import type { ControllerEvent, ControllerStick } from '../../input/controller'

export interface GolfControllerState { clubArmed: boolean }
export const golfControllerState = (): GolfControllerState => ({ clubArmed: true })
/** One frame of phone input for golf. aim is held; club, arm, cancel, stopOscillation and swing are one-shots. */
export interface GolfPhoneCommand { aim: -1 | 0 | 1; club: -1 | 0 | 1; arm: boolean; cancel: boolean; swingPower: number | null; stopOscillation: boolean }
const AIM_DEADZONE = 0.5, CLUB_FIRE = 0.6, CLUB_REARM = 0.3

/**
 * Left/right on the D-pad turn the aim/spin while held. Up/down step the club once per flick.
 * The bottom button arms the meter and starts the timer. The blue button stops oscillation (or steps the meter).
 * A phone swing carries power directly into the shot.
 */
export function controllerGolfCommand(stick: ControllerStick, events: readonly ControllerEvent[], state: GolfControllerState): { command: GolfPhoneCommand; clubArmed: boolean } {
  const x = stick.fresh ? stick.x : 0, y = stick.fresh ? stick.y : 0
  const aim: GolfPhoneCommand['aim'] = Math.abs(x) > AIM_DEADZONE ? (x < 0 ? -1 : 1) : 0
  let clubArmed = state.clubArmed, club: GolfPhoneCommand['club'] = 0
  if (Math.abs(y) < CLUB_REARM) clubArmed = true
  else if (clubArmed && Math.abs(y) > CLUB_FIRE) { club = y < 0 ? 1 : -1; clubArmed = false } // screen-Y is positive downward
  let arm = false, cancel = false, stopOscillation = false, swingPower: number | null = null
  for (const event of events) {
    if (event.kind === 'action') {
      if (event.action === 'placeholder_primary' || event.action === 'block_start') { stopOscillation = true; arm = true }
      else if (event.action === 'placeholder_secondary') arm = true
      else if (event.action === 'emergency_power') cancel = true
    } else if (swingPower === null) swingPower = Math.max(0, Math.min(1, event.power / 100))
  }
  return { clubArmed, command: { aim, club, arm, cancel, swingPower, stopOscillation } }
}
