import { FRAMES } from './constants'
import type { FrameScore, Scoreboard } from './types'

const sum = (r: number[]): number => r.reduce((a, b) => a + b, 0)

/** Standard ten-pin scoring. `rolls[f]` holds the pin counts of frame f (0-based). Scores are cumulative; null until known. */
export function scoreFrames(rolls: number[][]): Scoreboard {
  const flat = rolls.flat()
  const frames: FrameScore[] = []
  let idx = 0, total = 0, open = true
  for (let f = 0; f < FRAMES; f++) {
    const r = rolls[f] ?? []
    let score: number | null = null
    if (f < FRAMES - 1) {
      if (r[0] === 10) score = flat.length > idx + 2 ? 10 + flat[idx + 1] + flat[idx + 2] : null
      else if (r.length >= 2 && r[0] + r[1] === 10) score = flat.length > idx + 2 ? 10 + flat[idx + 2] : null
      else if (r.length >= 2) score = r[0] + r[1]
    } else {
      const need = r[0] === 10 || (r.length >= 2 && r[0] + r[1] === 10) ? 3 : 2
      score = r.length >= need ? sum(r) : null
    }
    idx += r.length
    if (score === null || !open) { open = false; frames.push({ rolls: [...r], score: null }); continue }
    total += score
    frames.push({ rolls: [...r], score: total })
  }
  return { frames, total }
}

/** True when this frame is finished after the given rolls (10th frame allows a fill ball). */
export function frameDone(frame: number, rolls: number[]): boolean {
  if (frame < FRAMES) return rolls[0] === 10 || rolls.length >= 2
  if (rolls.length >= 3) return true
  if (rolls.length < 2) return false
  return !(rolls[0] === 10 || rolls[0] + rolls[1] === 10)
}
