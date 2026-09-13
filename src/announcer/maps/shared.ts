import type { NameKey, PersonaKey, SideKey } from '../lines'

export type Side = 'a' | 'b'
/** Who the two sides are, which decides every name the announcer says. */
export type Perspective =
  | { mode: '1p' }
  | { mode: '2p' }
  | { mode: 'card'; a: PersonaKey | null; b: PersonaKey | null }

/** One spoken call: a single cue, or cues played back to back. */
export type Say = readonly string[]

/** A sport's event map: turns scene events and snapshots into calls, with its own per-match memory. */
export interface SportMap<E, C, V> {
  /** Calls when the match is on screen. */
  start(): Say[]
  /** Calls for one sim event; `ctx` is read only when the event needs it. */
  event(e: E, ctx: () => C): Say[]
  /** Calls derived from the latest snapshot, once per rendered frame while play runs. */
  frame(view: V): Say[]
  /** True while play is live enough for a colour line. */
  live(view: V): boolean
  /** The sport's colour cue. */
  readonly colour: string
}

const PERSONA_BY_NAME: Readonly<Record<string, PersonaKey>> = {
  'knuckles mcgraw': 'knuckles', 'the professor': 'professor', 'lucky lou': 'lou', 'iron maggie': 'maggie',
}

/** The persona key for a Fight Night fighter's name, or null for a name the catalogue has no lines for. */
export function personaKey(name: string | undefined): PersonaKey | null {
  return PERSONA_BY_NAME[(name ?? '').trim().toLowerCase()] ?? null
}

export const otherSide = (s: Side): Side => (s === 'a' ? 'b' : 'a')

/** The name key for a side, or null when that side has no named lines. */
export function nameKey(p: Perspective, side: Side): NameKey | null {
  if (p.mode === '1p') return side === 'a' ? 'you' : 'house'
  if (p.mode === '2p') return side === 'a' ? 'p1' : 'p2'
  return p[side]
}

/** Like `nameKey`, for sports that only have 1P and 2P lines. */
export function sideKey(p: Perspective, side: Side): SideKey | null {
  const k = nameKey(p, side)
  return k === 'you' || k === 'house' || k === 'p1' || k === 'p2' ? k : null
}

/** The shared winner call, or the draw call. */
export function winnerCue(p: Perspective, winner: Side | 'draw'): string {
  if (winner === 'draw') return 'draw'
  const k = nameKey(p, winner)
  return k ? `win.${k}` : 'win.generic'
}
