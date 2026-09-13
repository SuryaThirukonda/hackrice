import { describe, expect, it } from 'vitest'
import { isSplit } from './maps/bowling'

/** Pin numbers as bowlers say them (1 is the head pin) to the sim's 0-based indices. */
const leave = (...pins: number[]): number[] => pins.map((n) => n - 1)

describe('isSplit', () => {
  it('finds the classic splits', () => {
    for (const pins of [[7, 10], [4, 6], [5, 7], [2, 7], [3, 10], [4, 7, 10], [6, 7, 10]]) {
      expect(isSplit(leave(...pins)), pins.join('-')).toBe(true)
    }
  })

  it('ignores leaves that are not splits', () => {
    for (const pins of [[2, 4, 5], [10], [1, 7, 10], [3, 6, 10], [2, 3], [4, 7], []]) {
      expect(isSplit(leave(...pins)), pins.join('-') || 'no pins').toBe(false)
    }
  })
})
