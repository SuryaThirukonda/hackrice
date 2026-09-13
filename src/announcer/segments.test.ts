import { describe, expect, it } from 'vitest'
import { FRAME_S, assignCuts, audibleSpan, findPauses, frameLevels, lineWindows } from './segments'

/** Frame levels for a pattern of speech (-20 dBFS) and quiet (-70 dBFS) stretches, in seconds. */
function levels(pattern: [kind: 's' | 'q', seconds: number][]): Float32Array {
  const out: number[] = []
  for (const [kind, s] of pattern) for (let i = 0; i < Math.round(s / FRAME_S); i++) out.push(kind === 's' ? -20 : -70)
  return Float32Array.from(out)
}
const within = (w: [number, number], a: number, b: number) => w[0] <= a + 1e-9 && w[1] >= b - 1e-9

describe('frameLevels', () => {
  it('measures loudness per frame in dBFS', () => {
    const tone = new Float32Array(441).fill(0.5), quiet = new Float32Array(441)
    const [loud, silent] = frameLevels(Float32Array.from([...tone, ...quiet]), 44100)
    expect(loud).toBeCloseTo(-6.02, 1)
    expect(silent).toBeLessThan(-100)
  })
})

describe('findPauses', () => {
  it('finds pauses between sounds, ignoring short gaps and the silence at either end', () => {
    const p = findPauses(levels([['q', 0.3], ['s', 0.5], ['q', 0.1], ['s', 0.4], ['q', 0.6], ['s', 0.5], ['q', 0.4]]))
    expect(p).toHaveLength(1)
    expect(p[0].start).toBeCloseTo(1.3, 5)
    expect(p[0].end).toBeCloseTo(1.9, 5)
  })
})

describe('assignCuts', () => {
  it('returns null when there are fewer pauses than cuts', () => {
    expect(assignCuts([{ start: 1, end: 1.5 }], [1, 2])).toBeNull()
    expect(assignCuts([], [])).toEqual([])
  })
})

describe('lineWindows', () => {
  it('keeps each line whole when the estimates run early', () => {
    // Eight 0.0-0.4, Nine 1.1-1.7, TEN 2.4-2.9: the estimated cuts sit before the real pauses, the second one before Nine even starts.
    const lv = levels([['s', 0.4], ['q', 0.7], ['s', 0.6], ['q', 0.7], ['s', 0.5]])
    const w = lineWindows(lv, 2.9, [0.45, 1.05])!
    expect(within(w[0], 0, 0.4) && within(w[1], 1.1, 1.7) && within(w[2], 2.4, 2.9)).toBe(true)
    expect(w[1][0]).toBeGreaterThanOrEqual(0.4)
    expect(w[1][1]).toBeLessThanOrEqual(2.4)
  })

  it('cuts in the long pause between lines, not the short pause inside a line', () => {
    // "In the blue corner... Knuckles McGRAW!" then "And in the red corner...": a 0.3 s pause inside line one, 0.9 s between
    // lines. The estimate runs early, a little nearer the short pause's centre than the long one's; the longer pause wins.
    const lv = levels([['s', 1.2], ['q', 0.3], ['s', 0.9], ['q', 0.9], ['s', 1.4]])
    const w = lineWindows(lv, 4.7, [2.05])!
    expect(within(w[0], 0, 2.4)).toBe(true)
    expect(within(w[1], 3.3, 4.7)).toBe(true)
  })

  it('gives up when the audio has too few pauses', () => {
    expect(lineWindows(levels([['s', 2]]), 2, [0.5, 1.5])).toBeNull()
  })
})

describe('audibleSpan', () => {
  it('trims quiet edges with a little padding, and ignores a faint click', () => {
    const lv = Float32Array.from([...levels([['q', 0.5], ['s', 0.6], ['q', 0.2]]), -60, ...levels([['q', 0.2]])])
    const [a, b] = audibleSpan(lv, lv.length * FRAME_S, 0, null)
    expect(a).toBeCloseTo(0.47, 5)
    expect(b).toBeCloseTo(1.13, 5)
  })

  it('ignores a lone loud click after the words', () => {
    const lv = Float32Array.from([...levels([['q', 0.5], ['s', 0.6], ['q', 0.6]]), -30, ...levels([['q', 0.05]])])
    const [a, b] = audibleSpan(lv, lv.length * FRAME_S, 0, null)
    expect(a).toBeCloseTo(0.47, 5)
    expect(b).toBeCloseTo(1.13, 5)
  })

  it('returns an empty span for a silent window', () => {
    expect(audibleSpan(levels([['q', 1]]), 1, 0.2, 0.8)).toEqual([0.2, 0.2])
  })
})
