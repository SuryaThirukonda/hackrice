/**
 * The committed manifest `npm run announcer -- generate` writes to `public/announcer/manifest.json` and the game
 * reads: one MP3 per take (or per line for takes generated with `--per-line`), and each line's segment in it.
 */
export const MANIFEST_VERSION = 1

export interface ManifestTake {
  file: string
  /** sha1 of voice, model, settings, seed, format and text; unchanged hashes are skipped on the next run. */
  hash: string
  seed: number
  stability: number
  chars: number
  bytes: number
  requestId?: string
  /** Generated one request per line; each line then has its own file. */
  perLine?: boolean
}

export interface ManifestLine {
  take: string
  /** Set for per-line takes: the line's own file. */
  file?: string
  /**
   * Segment in seconds, from the generation timestamps; null means the start or end of the file. The timestamps are
   * estimates, so the player moves each cut between two lines into the real pause nearby (`segments.ts`).
   */
  start: number | null
  end: number | null
}

export interface Manifest {
  version: typeof MANIFEST_VERSION
  voiceId: string
  modelId: string
  outputFormat: string
  generatedAt: string
  takes: Record<string, ManifestTake>
  lines: Record<string, ManifestLine>
}

/** The file a line plays from, or null when the manifest has no audio for it. */
export function lineFile(m: Manifest, lineId: string): string | null {
  const line = m.lines[lineId]
  if (!line) return null
  return line.file ?? m.takes[line.take]?.file ?? null
}

/** Every file a take needs. */
export function takeFiles(m: Manifest, takeId: string): string[] {
  const take = m.takes[takeId]
  if (!take) return []
  if (!take.perLine) return [take.file]
  return [...new Set(Object.values(m.lines).filter((l) => l.take === takeId && l.file).map((l) => l.file!))]
}
