/**
 * Where to cut a take into its lines, from the audio itself. The timestamps ElevenLabs returns place each line only
 * roughly (near the end of a long take they can run most of a second early), so the player moves every cut between
 * two lines into a real pause: one pause per cut, in order, as close to the timestamp estimate as possible, preferring
 * longer pauses. Pure, so it runs in tests and in the browser on a decoded buffer.
 */

export const FRAME_S = 0.01
export const SILENCE_DB = -45
/** Quiet stretches shorter than this are gaps between words, not pauses between lines. */
export const MIN_PAUSE_S = 0.15

export interface Pause { start: number; end: number }

/** Loudness of each 10 ms frame, in dBFS. */
export function frameLevels(samples: Float32Array, sampleRate: number, frameS = FRAME_S): Float32Array {
  const n = Math.max(1, Math.round(sampleRate * frameS))
  const out = new Float32Array(Math.ceil(samples.length / n))
  for (let f = 0; f < out.length; f++) {
    const a = f * n, b = Math.min(samples.length, a + n)
    let sum = 0
    for (let i = a; i < b; i++) sum += samples[i] * samples[i]
    out[f] = 10 * Math.log10(sum / Math.max(1, b - a) + 1e-12)
  }
  return out
}

/** Quiet stretches of at least `minS` between sounds. Silence at the very start or end of the take is not a pause. */
export function findPauses(levels: ArrayLike<number>, frameS = FRAME_S, thresholdDb = SILENCE_DB, minS = MIN_PAUSE_S): Pause[] {
  const out: Pause[] = []
  let run = -1
  for (let f = 0; f <= levels.length; f++) {
    const quiet = f < levels.length && levels[f] < thresholdDb
    if (quiet && run < 0) run = f
    if (!quiet && run >= 0) {
      if (run > 0 && f < levels.length && (f - run) * frameS >= minS) out.push({ start: run * frameS, end: f * frameS })
      run = -1
    }
  }
  return out
}

/**
 * One pause for each estimated cut, in order, minimising the total distance from each estimate to its pause's centre
 * less a bonus for longer pauses. Returns each cut's time, or null when the take has fewer pauses than cuts.
 */
export function assignCuts(pauses: readonly Pause[], estimates: readonly number[], lengthBonus = 0.5): number[] | null {
  const K = estimates.length, M = pauses.length
  if (K === 0) return []
  if (M < K) return null
  const centre = pauses.map((p) => (p.start + p.end) / 2)
  const cost = (k: number, j: number): number => Math.abs(centre[j] - estimates[k]) - lengthBonus * Math.min(pauses[j].end - pauses[j].start, 1.2)
  // best[k][j]: the lowest total for cuts 0..k with cut k in pause j; from[k][j]: the pause cut k-1 used.
  const best: number[][] = [], from: number[][] = []
  for (let k = 0; k < K; k++) {
    best.push(new Array<number>(M).fill(Infinity))
    from.push(new Array<number>(M).fill(-1))
    let low = Infinity, arg = -1
    for (let j = k; j <= M - (K - k); j++) {
      if (k === 0) { best[0][j] = cost(0, j); continue }
      if (best[k - 1][j - 1] < low) { low = best[k - 1][j - 1]; arg = j - 1 }
      if (arg >= 0) { best[k][j] = low + cost(k, j); from[k][j] = arg }
    }
  }
  let j = -1, low = Infinity
  for (let c = 0; c < M; c++) if (best[K - 1][c] < low) { low = best[K - 1][c]; j = c }
  if (j < 0) return null
  const cuts = new Array<number>(K)
  for (let k = K - 1; k >= 0; k--) { cuts[k] = centre[j]; j = from[k][j] }
  return cuts
}

/**
 * Each line's window in a take of `estimates.length + 1` lines: from the previous cut (or the start of the take) to
 * the next cut (or its end). Null when the audio has too few pauses; the caller then keeps the manifest's segments.
 */
export function lineWindows(levels: ArrayLike<number>, duration: number, estimates: readonly number[], frameS = FRAME_S): [number, number][] | null {
  const cuts = assignCuts(findPauses(levels, frameS), estimates)
  if (!cuts) return null
  return Array.from({ length: estimates.length + 1 }, (_, i): [number, number] => [i === 0 ? 0 : cuts[i - 1], i === estimates.length ? duration : cuts[i]])
}

/** Frames quieter than this count as silence when trimming a line; room tone in these clips sits near -65 dBFS. */
export const TRIM_DB = -55
/** Kept either side of the audible span so a soft onset or a trailing consonant survives trimming. */
export const EDGE_PAD_S = 0.03

/**
 * The audible part of a window, in seconds: from the first to the last run of sound, plus a little padding. Sound is
 * two 10 ms frames in a row louder than `TRIM_DB`: every word is, a lone click at the end of a file is not.
 */
export function audibleSpan(levels: ArrayLike<number>, duration: number, start: number | null, end: number | null, frameS = FRAME_S): [number, number] {
  const a = Math.max(0, start ?? 0), b = Math.min(duration, end ?? duration)
  const fa = Math.max(0, Math.floor(a / frameS)), fb = Math.min(levels.length, Math.ceil(b / frameS))
  let first = -1, last = -1
  for (let f = fa; f < fb - 1; f++) if (levels[f] > TRIM_DB && levels[f + 1] > TRIM_DB) { first = f; break }
  for (let f = fb - 1; f > fa; f--) if (levels[f] > TRIM_DB && levels[f - 1] > TRIM_DB) { last = f; break }
  if (first < 0) return [a, a]
  return [Math.max(a, first * frameS - EDGE_PAD_S), Math.min(b, (last + 1) * frameS + EDGE_PAD_S)]
}
