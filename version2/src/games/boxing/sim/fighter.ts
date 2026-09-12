import { FATIGUE_KNEE, HP_MAX, KD_MARKS, STAMINA_MAX } from './constants'
import type { Fighter, FighterState, Side, V2 } from './types'

export function createFighter(id: Side, pos: V2): Fighter {
  return {
    id, pos: { ...pos }, vMove: { x: 0, z: 0 }, vKnock: { x: 0, z: 0 }, headOffset: { x: 0, y: 0 }, headTarget: { x: 0, y: 0 },
    hp: HP_MAX, stamina: STAMINA_MAX, state: 'idle', stateT: 0, stateTotal: 1, fresh: false, guard: false, guardBroken: false,
    punch: 'jab', punchId: 0, resolved: true, momentum: 0, dodgeKind: 'swayL', dodgeCd: 0, marks: [...KD_MARKS],
    kdRound: 0, kdTotal: 0, thrown: 0, landed: 0, blocked: 0, dealtRound: 0, dealtTotal: 0, moving: 0,
  }
}

export function setState(f: Fighter, s: FighterState, t: number): void { f.state = s; f.stateT = t; f.stateTotal = Math.max(1, t); f.fresh = true }

/** Below the knee, windup and recovery stretch (1 .. 1.6x). */
export function fatigueTime(f: Fighter): number { return f.stamina >= FATIGUE_KNEE ? 1 : 1.6 - 0.6 * (f.stamina / FATIGUE_KNEE) }
/** Below the knee, damage scales (0.6 .. 1). */
export function fatigueDmg(f: Fighter): number { return f.stamina >= FATIGUE_KNEE ? 1 : 0.6 + 0.4 * (f.stamina / FATIGUE_KNEE) }

export const BUSY: ReadonlySet<FighterState> = new Set(['windup', 'active', 'recover', 'dodge', 'hitstun', 'stagger', 'down', 'getup'])
export function canMove(f: Fighter): boolean { return f.state === 'idle' || f.state === 'recover' }
export function isDodgingIframes(f: Fighter, iframes: number): boolean { return f.state === 'dodge' && f.stateTotal - f.stateT < iframes }
