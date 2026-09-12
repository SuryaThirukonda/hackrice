import type { PinView, Snapshot } from '../sim/types'

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Build a presentation-only view between fixed simulation ticks.
 * Discrete gameplay fields always come from the current authoritative snapshot.
 */
export function lerpBowlingView(previous: Snapshot, current: Snapshot, alpha: number): Snapshot {
  if (previous.phase !== current.phase || previous.current !== current.current) return current

  const priorPins = new Map(previous.pins.map((pin) => [pin.index, pin]))
  const pins: PinView[] = current.pins.map((pin) => {
    const prior = priorPins.get(pin.index)
    if (!prior) return pin
    return { ...pin, x: lerp(prior.x, pin.x, alpha), z: lerp(prior.z, pin.z, alpha) }
  })

  return {
    ...current,
    ballPos: {
      x: lerp(previous.ballPos.x, current.ballPos.x, alpha),
      z: lerp(previous.ballPos.z, current.ballPos.z, alpha),
    },
    ballVel: {
      x: lerp(previous.ballVel.x, current.ballVel.x, alpha),
      z: lerp(previous.ballVel.z, current.ballVel.z, alpha),
    },
    pins,
  }
}
