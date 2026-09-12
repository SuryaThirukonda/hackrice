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
  { action: 'jab', label: 'Left jab', hint: 'fast, low damage, safe' },
  { action: 'cross', label: 'Right cross', hint: 'slow, heavy, step in for momentum' },
  { action: 'block', label: 'Block (hold)', hint: 'absorbs punches, costs stamina per hit' },
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

export interface BoxingControllerState { blocking: boolean }

/** Convert normalized remote input to the same command shape used by keyboard input. */
export function controllerBoxingCommand(
  stick: ControllerStick,
  events: readonly ControllerEvent[],
  state: BoxingControllerState,
): { command: Command; blocking: boolean } {
  let blocking = stick.fresh ? state.blocking : false
  let punch: Command['punch'] = null
  let punchPower: number | undefined
  for (const event of events) {
    if (event.kind === 'action' && event.action === 'block_start') blocking = true
    else if (event.kind === 'action' && event.action === 'block_end') blocking = false
    else if (event.kind === 'gesture' && event.gesture === 'punch' && punch === null) {
      punch = phonePunchKind(event)
      punchPower = event.power / 100
    }
  }
  const strafe = Math.abs(stick.x) > 0.1 ? (stick.x < 0 ? -1 : 1) : 0
  const forward = Math.abs(stick.y) > 0.5 ? (stick.y < 0 ? 1 : -1) : 0
  const power = punchPower === undefined ? {} : { punchPower }
  return { blocking, command: cmd({ punch, ...power, block: blocking, strafe, forward }) }
}
