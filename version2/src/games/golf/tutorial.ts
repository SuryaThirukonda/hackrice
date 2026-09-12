import type { TutorialPage, TutorialRow } from '../boxing/tutorial'
import { GOLF_HELP, GOLF_KEYS, keyLabel, type GolfBindings } from './keymap'
import type { GolfEvent, GolfSnapshot } from './sim/types'

/** Scene-side counters the sim does not know about (club picks, aim turned, swings started). */
export interface GolfPracticeUi { clubChanges: number; aimTurnedDeg: number; swings: number }
export interface GolfPracticeStep { text: string; done: (e: GolfEvent | null, s: GolfSnapshot, ui: GolfPracticeUi) => boolean }

export function golfPages(b: GolfBindings = GOLF_KEYS): TutorialPage[] {
  const row = (a: keyof GolfBindings): TutorialRow => { const h = GOLF_HELP.find((x) => x.action === a)!; return { keys: b[a].map(keyLabel).join(' / '), label: h.label, hint: h.hint } }
  return [
    { heading: 'CLUBS', rows: [row('clubUp'), row('clubDown')], note: 'Driver 230 m, 3 wood 200, 5 iron 160, 7 iron 135, wedge 90 at full power on a flat lie. Rough loses 15%, sand 40%. On the green you putt; from sand you cannot.' },
    { heading: 'SWING', rows: [row('aimLeft'), row('aimRight'), row('swing')], note: 'Three presses: one starts the meter, the second sets power as it sweeps up and back, the third sets accuracy: stop on the centre mark or the ball pulls or pushes.' },
    { heading: 'COURSE', rows: [row('view')], note: 'Three holes, wind on every hole (watch the sock). Water costs a stroke and a drop short of the hazard; out of bounds costs a stroke and a replay. Farthest from the cup plays next; pick up at par + 4.' },
  ]
}

/** Guided practice for one free shot: pick a club, aim, complete the swing meter, reach the green. */
export function golfPractice(b: GolfBindings = GOLF_KEYS): GolfPracticeStep[] {
  const k = (a: keyof GolfBindings) => b[a].map(keyLabel).join(' or ')
  return [
    { text: `Press ${k('clubUp')} or ${k('clubDown')} to choose a club`, done: (_e, _s, ui) => ui.clubChanges > 0 },
    { text: `Hold ${k('aimLeft')} or ${k('aimRight')} to aim (watch the preview)`, done: (_e, _s, ui) => ui.aimTurnedDeg >= 5 },
    { text: `Press ${k('swing')} three times: start, power, accuracy`, done: (e) => e?.kind === 'shot' },
    { text: 'Reach the green (any number of shots)', done: (e, s) => e?.kind === 'on_green' || e?.kind === 'holed' || s.balls.a.surface === 'green' || s.balls.a.holed },
  ]
}
