import { BOWLING_HELP, BOWLING_KEYS, keyLabel, type AimState, type BowlingBindings } from './keymap'
import type { TutorialPage, TutorialRow } from '../boxing/tutorial'
import type { BowlingEvent, Snapshot } from './sim/types'

export type { TutorialPage, TutorialRow }
/** What a practice step can inspect: the sim snapshot plus the player's current aim and whether the meter is charging. */
export interface PracticeView extends Snapshot { aim: AimState; charging: boolean }
export interface PracticeStep { text: string; done: (e: BowlingEvent | null, s: PracticeView) => boolean }

export function bowlingPages(b: BowlingBindings = BOWLING_KEYS): TutorialPage[] {
  const row = (a: keyof BowlingBindings): TutorialRow => { const h = BOWLING_HELP.find((x) => x.action === a)!; return { keys: b[a].map(keyLabel).join(' / '), label: h.label, hint: h.hint } }
  return [
    { heading: 'AIM', rows: [row('left'), row('right'), row('aimL'), row('aimR')], note: 'Slide across the approach and turn the release angle. The gold guide on the lane shows where the ball is headed; the pocket between the head pin and pin 3 is the strike line.' },
    { heading: 'ROLL', rows: [row('hookL'), row('hookR'), row('roll'), row('confirm')], note: 'The aim line sweeps left and right on its own. Tap Space to lock it where you want it, then hold Space to charge and release on the power you want. The dotted path already shows the hook curve after the oil line.' },
    { heading: 'SCORE', rows: [], note: 'Ten frames, two balls each. A strike (all ten on ball one) adds the next two balls; a spare adds the next one. The tenth frame earns fill balls. Highest total after ten frames beats the House.' },
  ]
}

/** Guided practice on a free frame: each step completes on a sim event or a view condition. */
export function bowlingPractice(b: BowlingBindings = BOWLING_KEYS): PracticeStep[] {
  const k = (a: keyof BowlingBindings) => b[a].map(keyLabel).join(' or ')
  return [
    { text: `Hold ${k('left')} or ${k('right')} to move across the approach`, done: (_e, s) => Math.abs(s.aim.lanePos) > 0.15 },
    { text: `Hold ${k('aimL')} or ${k('aimR')} to turn your aim`, done: (_e, s) => Math.abs(s.aim.angleDeg) > 0.8 },
    { text: `Tap ${k('hookL')} or ${k('hookR')} to set a hook`, done: (_e, s) => Math.abs(s.aim.hook) >= 0.2 },
    { text: `Tap ${k('roll')} to lock the sweeping line`, done: (_e, s) => s.swayLocked },
    { text: `Hold ${k('roll')} to charge, release to roll`, done: (e) => e?.kind === 'roll_start' },
    { text: 'Knock some pins down', done: (e) => e?.kind === 'pins_down' && e.count > 0 },
  ]
}
