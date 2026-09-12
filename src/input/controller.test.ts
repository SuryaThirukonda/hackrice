import { describe, expect, it } from 'vitest'
import { ControllerInput, phonePunchKind, type ControllerGesture } from './controller'
import { BowlingGame } from '../games/bowling/sim/game'

const gesture = (eventId: string, peakRotation = 100): Record<string, unknown> => ({
  type: 'gesture', controllerId: 'controller_1', sport: 'bowling', gesture: 'bowling_swing',
  eventId, power: 82, direction: [0, 3, 0], peakAcceleration: 30, peakRotation, duration: 140,
})

describe('ControllerInput', () => {
  it('keeps only fresh, normalized latest stick state', () => {
    const input = new ControllerInput()
    input.ingest({ type: 'stick', controllerId: 'controller_1', stick: [2, 2] }, 1_000)
    const fresh = input.stick('controller_1', 1_200)
    expect(fresh.fresh).toBe(true)
    expect(Math.hypot(fresh.x, fresh.y)).toBeCloseTo(1)
    expect(input.stick('controller_1', 1_251)).toEqual({ x: 0, y: 0, fresh: false })
  })

  it('deduplicates discrete events and drains them once', () => {
    const input = new ControllerInput()
    input.ingest(gesture('one'))
    input.ingest(gesture('one'))
    expect(input.drain('controller_1', 'bowling')).toHaveLength(1)
    expect(input.drain('controller_1', 'bowling')).toEqual([])
  })

  it('clears held state and queued events on disconnect', () => {
    const input = new ControllerInput()
    input.ingest({ type: 'stick', controllerId: 'controller_1', stick: [1, 0] }, 100)
    input.ingest(gesture('two'))
    input.ingest({ type: 'controller_status', controllerId: 'controller_1', connected: false }, 110)
    expect(input.stick('controller_1', 120).fresh).toBe(false)
    expect(input.drain('controller_1', 'bowling')).toEqual([])
  })

  it('maps phone rotation to a deterministic punch kind', () => {
    const base = { kind: 'gesture', controllerId: 'controller_1', sport: 'boxing', gesture: 'punch', power: 70,
      direction: [0, 1, 0], peakAcceleration: 20, duration: 100, eventId: 'p' } as const
    expect(phonePunchKind({ ...base, peakRotation: 80 } as ControllerGesture)).toBe('jab')
    expect(phonePunchKind({ ...base, peakRotation: 320 } as ControllerGesture)).toBe('cross')
  })

  it('turns one accepted bowling swing into one normalized roll and cannot replay it', () => {
    const input = new ControllerInput()
    input.ingest({ ...gesture('roll'), power: 150 })
    input.ingest({ ...gesture('roll'), power: 150 })
    const [event] = input.drain('controller_1', 'bowling')
    expect(event?.kind).toBe('gesture')
    if (!event || event.kind !== 'gesture') return
    expect(event.power).toBe(100)
    const game = new BowlingGame({ seed: 17 })
    expect(game.startRoll({ lanePos: 0, angleDeg: 0, hook: 0, power: event.power / 100 })).toBe(true)
    expect(input.drain('controller_1', 'bowling')).toEqual([])
    expect(game.startRoll({ lanePos: 0, angleDeg: 0, hook: 0, power: event.power / 100 })).toBe(false)
  })
})
