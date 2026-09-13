import { describe, expect, it } from 'vitest'
import { ControllerInput } from './controller'

describe('activity reports on the client', () => {
  it('queues the phone\'s movement summaries per controller and hands them over once', () => {
    const input = new ControllerInput()
    input.ingest({ type: 'activity', controllerId: 'controller_1', epochs: [{ t: 0, mean: 2.5, peak: 8, swings: 1, rotation: 90 }, { t: 1000, mean: 0.2, peak: 1, swings: 0, rotation: 5 }], roms: [110] })
    input.ingest({ type: 'activity', controllerId: 'controller_2', epochs: [{ t: 0, mean: 1, peak: 2, swings: 0, rotation: 0 }], roms: [] })
    const one = input.drainActivity('controller_1')
    expect(one.epochs).toHaveLength(2); expect(one.epochs[0]).toEqual({ t: 0, mean: 2.5, peak: 8, swings: 1, rotation: 90 }); expect(one.roms).toEqual([110])
    expect(input.drainActivity('controller_1').epochs).toEqual([]) // drained
    expect(input.drainActivity('controller_2').epochs).toHaveLength(1)
  })
  it('sanitises garbage and forgets a phone that disconnects', () => {
    const input = new ControllerInput()
    input.ingest({ type: 'activity', controllerId: 'controller_1', epochs: [{ t: -5, mean: 'x', peak: Number.NaN, swings: 2.6, rotation: -3 }], roms: ['bad', 40] })
    const got = input.drainActivity('controller_1')
    expect(got.epochs[0]).toEqual({ t: 0, mean: 0, peak: 0, swings: 3, rotation: 0 }); expect(got.roms).toEqual([0, 40])
    input.ingest({ type: 'activity', controllerId: 'controller_1', epochs: [{ t: 0, mean: 1, peak: 1, swings: 0, rotation: 0 }], roms: [] })
    input.ingest({ type: 'controller_status', controllerId: 'controller_1', connected: false })
    expect(input.drainActivity('controller_1').epochs).toEqual([])
  })
})
