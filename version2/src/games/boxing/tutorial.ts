import { BOXING_HELP, BOXING_KEYS, keyLabel, type BoxingBindings } from './keymap'
import type { SimEvent, Snapshot } from './sim/types'

export interface TutorialRow { keys: string; label: string; hint: string }
export interface TutorialPage { heading: string; rows: TutorialRow[]; note?: string }
export interface PracticeStep { text: string; done: (e: SimEvent | null, s: Snapshot) => boolean }

export function boxingPages(b: BoxingBindings = BOXING_KEYS): TutorialPage[] {
  const row = (a: keyof BoxingBindings): TutorialRow => { const h = BOXING_HELP.find((x) => x.action === a)!; return { keys: b[a].map(keyLabel).join(' / '), label: h.label, hint: h.hint } }
  return [
    { heading: 'PUNCH', rows: [row('jab'), row('cross'), row('in'), row('out')], note: 'A punch in reach always lands unless the House dodges or blocks. Step in first for extra damage and knockback.' },
    { heading: 'DEFEND', rows: [row('block'), row('swayL'), row('swayR'), row('duck')], note: 'Blocking absorbs the hit but costs stamina; at zero stamina your guard breaks. A dodge is invulnerable for a moment and has a cooldown.' },
    { heading: 'MOVE', rows: [row('left'), row('right')], note: 'Circle to reset the range. Three rounds, knockdowns at 60 and 30 health, get up before the count of ten.' },
  ]
}

/** Guided practice: each step completes on a sim event or snapshot condition. */
export function boxingPractice(b: BoxingBindings = BOXING_KEYS): PracticeStep[] {
  const k = (a: keyof BoxingBindings) => b[a].map(keyLabel).join(' or ')
  let guardTicks = 0
  return [
    { text: `Press ${k('jab')} to throw a jab`, done: (e) => e?.kind === 'punch' && e.who === 'a' && e.punch === 'jab' },
    { text: `Press ${k('cross')} to throw a cross`, done: (e) => e?.kind === 'punch' && e.who === 'a' && e.punch === 'cross' },
    { text: `Hold ${k('block')} to block for a second`, done: (_e, s) => { guardTicks = s.a.guard ? guardTicks + 1 : 0; return guardTicks > 50 } },
    { text: `Press ${k('swayL')} or ${k('swayR')} to sway`, done: (e) => e?.kind === 'dodge' && e.who === 'a' && e.dodge !== 'duck' },
    { text: `Press ${k('duck')} to duck`, done: (e) => e?.kind === 'dodge' && e.who === 'a' && e.dodge === 'duck' },
    { text: `Hold ${k('in')} and land a cross with momentum`, done: (e) => e?.kind === 'punch' && e.who === 'a' && e.result === 'hit' && e.punch === 'cross' && e.momentum > 0.5 },
  ]
}
