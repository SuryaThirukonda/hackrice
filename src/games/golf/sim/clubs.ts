import { carryFor } from './flight'
import type { Club } from './types'

export interface ClubSpec { carry: number; angle: number; speed: number }
/** Full-power, no-wind carry on flat ground (m) and launch angle (deg). speed is solved at module load. */
export const CLUBS: Record<Club, ClubSpec> = {
  driver: { carry: 230, angle: 11, speed: 0 },
  wood3: { carry: 200, angle: 13, speed: 0 },
  iron5: { carry: 160, angle: 18, speed: 0 },
  iron7: { carry: 135, angle: 22, speed: 0 },
  wedge: { carry: 90, angle: 32, speed: 0 },
  putter: { carry: 0, angle: 0, speed: 0 },
}
export const carryTable: Record<Club, number> = { driver: 230, wood3: 200, iron5: 160, iron7: 135, wedge: 90, putter: 0 }
export const FULL_CLUBS: readonly Club[] = ['driver', 'wood3', 'iron5', 'iron7', 'wedge']

/** Bisection on launch speed so the same integrator carries each club its table distance. */
for (const club of FULL_CLUBS) {
  const c = CLUBS[club]
  let lo = 5, hi = 200
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (carryFor(mid, c.angle) < c.carry) lo = mid; else hi = mid }
  c.speed = (lo + hi) / 2
}
