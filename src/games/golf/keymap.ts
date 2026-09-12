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

export type MeterState = 'idle' | 'power' | 'accuracy' | 'done'
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
      case 'idle': this.state = 'power'; this.t = 0; this.value = 0; break
      case 'power': this.power = this.value; this.state = 'accuracy'; this.t = 0; this.value = -1; break
      case 'accuracy': this.accuracy = Math.abs(this.value) <= ACC_SWEET ? 0 : this.value; this.state = 'done'; break
      default: break // extra presses once done are ignored
    }
  }

  result(): { power: number; accuracy: number } | null {
    return this.state === 'done' ? { power: this.power, accuracy: this.accuracy } : null
  }

  reset(): void { this.state = 'idle'; this.value = 0; this.power = 0; this.accuracy = 0; this.t = 0 }
}
