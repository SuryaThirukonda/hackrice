import { describe, expect, it } from 'vitest'
import { projectGolf, projectLane } from './proj'
import { CourseRaster } from './mode7'
import { HOLES } from '../games/golf/sim/holes'

describe('retro projection', () => {
  it('shrinks and lifts lane objects with distance', () => {
    const near = projectLane(0, 0), far = projectLane(0, 18)
    expect(near.x).toBe(192)
    expect(far.x).toBe(192)
    expect(far.scale).toBeLessThan(near.scale)
    expect(far.y).toBeLessThan(near.y)
  })

  it('keeps the golf aim line centred and mirrors lateral points', () => {
    const camera = { x: 0, y: 1.6, z: -3, heading: 0 }
    const centre = projectGolf({ x: 0, y: 0, z: 10 }, camera)
    const left = projectGolf({ x: -2, y: 0, z: 10 }, camera)
    const right = projectGolf({ x: 2, y: 0, z: 10 }, camera)
    expect(centre.x).toBe(192)
    expect(centre.visible).toBe(true)
    expect(left.x).toBeLessThan(centre.x)
    expect(right.x).toBeGreaterThan(centre.x)
  })

  it('culls points behind the golf camera', () => {
    expect(projectGolf({ x: 0, y: 0, z: -4 }, { x: 0, y: 1.6, z: 0, heading: 0 }).visible).toBe(false)
  })

  it('keeps relative bowling depth stable under a chase camera', () => {
    expect(projectLane(0, 10, 6)).toEqual(projectLane(0, 3, -1))
  })

  it('rasterizes golf hazards from the same hole data used by physics', () => {
    const map = new CourseRaster(HOLES[2])
    expect(map.sample(0, 100)).toBe(2) // fairway
    expect(map.sample(0, 195)).toBe(5) // water crossing
    expect(map.sample(100, 100)).toBe(0) // out of bounds
  })
})
