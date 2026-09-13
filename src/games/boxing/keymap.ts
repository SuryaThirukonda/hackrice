import type { KeyState } from '../../input/keys'
import { phonePunchKind, type ControllerEvent, type ControllerStick } from '../../input/controller'
import { cmd, type Command } from './sim/types'

export interface BoxingBindings { jab: string[]; cross: string[]; block: string[]; left: string[]; right: string[]; swayL: string[]; swayR: string[]; duck: string[]; in: string[]; out: string[] }
export const BOXING_KEYS: BoxingBindings = {
  jab: ['KeyJ'], cross: ['KeyK'], block: ['Space', 'KeyS'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  swayL: ['KeyQ'], swayR: ['KeyE'], duck: ['KeyW'], in: ['ArrowUp'], out: ['ArrowDown'],
}
/** Human-readable labels for tutorials and overlays, generated from the same table. */
export const BOXING_HELP: { action: keyof BoxingBindings; label: string; hint: string }[] = [
  { action: 'jab', label: 'Left jab', hint: 'fast, low damage, safe; the slim bar under health is stamina (punches and blocks spend it)' },
  { action: 'cross', label: 'Right cross', hint: 'slow, heavy, step in for momentum' },
  { action: 'block', label: 'Block (hold)', hint: 'absorbs punches, costs stamina per hit and while held; at zero the guard breaks' },
  { action: 'left', label: 'Step left', hint: 'circle the House' },
  { action: 'right', label: 'Step right', hint: 'circle the House' },
  { action: 'swayL', label: 'Sway left', hint: 'dodge: invulnerable for a moment' },
  { action: 'swayR', label: 'Sway right', hint: 'dodge: invulnerable for a moment' },
  { action: 'duck', label: 'Duck', hint: 'dodge under a cross' },
  { action: 'in', label: 'Step in', hint: 'close distance, adds momentum to punches' },
  { action: 'out', label: 'Step out', hint: 'leave reach' },
]
export const keyLabel = (code: string): string => code.replace('Key', '').replace('Arrow', '').replace('Space', 'Space')

/** Build this frame's command. One-shot actions use press edges so a held key fires once. */
export function boxingCommand(k: KeyState, b: BoxingBindings = BOXING_KEYS): Command {
  const punch = k.justPressed(...b.jab) ? 'jab' : k.justPressed(...b.cross) ? 'cross' : null
  const dodge = k.justPressed(...b.swayL) ? 'swayL' : k.justPressed(...b.swayR) ? 'swayR' : k.justPressed(...b.duck) ? 'duck' : null
  const l = k.isDown(...b.left), r = k.isDown(...b.right), i = k.isDown(...b.in), o = k.isDown(...b.out)
  return cmd({ punch, dodge, block: k.isDown(...b.block), strafe: l === r ? 0 : l ? -1 : 1, forward: i === o ? 0 : i ? 1 : -1 })
}
/** Same command with the one-shot parts removed, for extra sim steps inside one frame. */
export const heldOnly = (c: Command): Command => ({ ...c, punch: null, dodge: null })

/** Every key player 2 uses in a two-player match. Fixed, so player 1's bindings are filtered against them. */
export const P2_BOXING_CODES: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyU', 'Numpad4', 'Numpad1', 'KeyI', 'Numpad5', 'Numpad2', 'KeyL', 'KeyO', 'Numpad0', 'Digit0']
/** Player 2 in a two-player match: arrows step in, out and slip; U jabs; I or L crosses; O holds the guard (numpad too). */
export function boxingCommandP2(k: KeyState): Command {
  const forward = k.isDown('ArrowUp') ? 1 : k.isDown('ArrowDown') ? -1 : 0
  const dodge = k.isDown('ArrowLeft') ? 'swayL' : k.isDown('ArrowRight') ? 'swayR' : null
  const punch = k.justPressed('KeyU', 'Numpad4', 'Numpad1') ? 'jab' : k.justPressed('KeyI', 'Numpad5', 'Numpad2', 'KeyL') ? 'cross' : null
  return cmd({ forward, dodge, punch, block: k.isDown('KeyO', 'Numpad0', 'Digit0') })
}
/** Player 1's bindings in a two-player match, without any key player 2 uses. Without this an arrow moved both
 *  fighters at once, because player 1's defaults step and strafe on the arrows too. Settings rebinds are kept. */
export function playerOneBindings(b: BoxingBindings): BoxingBindings {
  const out = { ...b }
  for (const action of Object.keys(out) as (keyof BoxingBindings)[]) out[action] = b[action].filter((code) => !P2_BOXING_CODES.includes(code))
  return out
}

/** Carried across frames by the scene: the phone's block is a latch, and a slip must re-arm at centre. */
export interface BoxingControllerState { blocking: boolean; slipArmed: boolean }
export const boxingControllerState = (): BoxingControllerState => ({ blocking: false, slipArmed: true })

const SLIP_FIRE = 0.6, SLIP_REARM = 0.3, STEP_DEADZONE = 0.5

/**
 * Phone input in the same Command shape the keyboard produces.
 *
 * A (block_start / block_end) holds the guard, B (emergency_power) ducks, and the D-pad left/right flicks a
 * slip to that side. The slip is edge-triggered off `slipArmed` because the stick is HELD state: without it a
 * leaning D-pad would re-request a dodge every frame and just sit on the sim's dodge cooldown.
 * Punch strength rides on the swing: `power` 0..100 from the phone becomes `punchPower` 0..1, which the sim
 * turns into a 0.35x..1.0x damage multiplier.
 */
export function controllerBoxingCommand(
  stick: ControllerStick,
  events: readonly ControllerEvent[],
  state: BoxingControllerState,
  connected = true,
): { command: Command; blocking: boolean; slipArmed: boolean } {
  // The guard latches on the CONNECTION, not on stick traffic: a phone resting on the D-pad still has its
  // guard up. It drops only when the phone actually goes away, so a disconnect cannot leave it stuck on.
  let blocking = connected ? state.blocking : false
  let punch: Command['punch'] = null
  let punchPower: number | undefined
  let dodge: Command['dodge'] = null
  for (const event of events) {
    if (event.kind === 'action') {
      if (event.action === 'block_start') blocking = true
      else if (event.action === 'block_end') blocking = false
      else if (event.action === 'emergency_power' || event.action === 'placeholder_secondary') dodge ??= 'duck'
    } else if (event.gesture === 'punch' && punch === null) {
      punch = phonePunchKind(event)
      punchPower = event.power / 100
    }
  }
  const x = stick.fresh ? stick.x : 0, y = stick.fresh ? stick.y : 0
  let slipArmed = state.slipArmed
  if (Math.abs(x) < SLIP_REARM) slipArmed = true
  else if (slipArmed && Math.abs(x) > SLIP_FIRE) { dodge ??= x < 0 ? 'swayL' : 'swayR'; slipArmed = false }
  // phone screen-Y is positive downward, so up on the D-pad is a step in
  const forward: Command['forward'] = Math.abs(y) > STEP_DEADZONE ? (y < 0 ? 1 : -1) : 0
  const power = punchPower === undefined ? {} : { punchPower }
  return { blocking, slipArmed, command: cmd({ punch, ...power, dodge, block: blocking, forward }) }
}
