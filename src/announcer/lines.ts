/**
 * The announcer's preset catalogue: every spoken line in the game.
 *
 * Lines are grouped into takes. A take is one ElevenLabs request (`npm run announcer -- generate`), cut into one
 * clip per line. A line id is its cue id, plus `#n` for variants of the same cue. Delivery lives in the text:
 * capitals for emphasis, ellipses for pauses, `[excited]` on the biggest calls. Numbers are spelled out.
 */
export type Priority = 1 | 2 | 3 | 4 | 5
export type Group = 'shared' | 'card' | 'boxing' | 'bowling' | 'golf'
export type Line = readonly [id: string, text: string]
export interface Take { readonly id: string; readonly group: Group; readonly lines: readonly Line[] }
export interface Cue {
  readonly priority: Priority
  /** Line ids to choose from; variants rotate. */
  readonly lines: readonly string[]
  /** Seconds before this cue may speak again (priority-2 cues default to 15). */
  readonly cooldownS?: number
  /** Seconds a queued call may wait before it is dropped (default 2, or 4 at priority 5). */
  readonly staleS?: number
  /** Plays on its event and never queues (the knockdown count). */
  readonly beat?: boolean
}

/** Names that depend on the mode: 1P is you and the House, 2P is Player One and Player Two. */
export const SIDE_KEYS = ['you', 'house', 'p1', 'p2'] as const
/** The four Fight Night personas. */
export const PERSONA_KEYS = ['knuckles', 'professor', 'lou', 'maggie'] as const
export type SideKey = typeof SIDE_KEYS[number]
export type PersonaKey = typeof PERSONA_KEYS[number]
export type NameKey = SideKey | PersonaKey
export const NAME_KEYS: readonly NameKey[] = [...SIDE_KEYS, ...PERSONA_KEYS]

/** The ElevenLabs v3 audio tags this catalogue uses. */
export const AUDIO_TAGS: readonly string[] = ['[excited]']

export const TAKES: readonly Take[] = [
  { id: 'shared.results', group: 'shared', lines: [
    ['win.you', '[excited] And the winner is... YOU!'],
    ['win.house', 'And the winner is... the House!'],
    ['win.p1', '[excited] And the winner is... Player ONE!'],
    ['win.p2', '[excited] And the winner is... Player TWO!'],
    ['win.knuckles', '[excited] And the winner is... Knuckles McGRAW!'],
    ['win.professor', '[excited] And the winner is... The PROFESSOR!'],
    ['win.lou', '[excited] And the winner is... Lucky LOU!'],
    ['win.maggie', '[excited] And the winner is... Iron MAGGIE!'],
    ['win.generic', 'And we have a WINNER!'],
    ['draw', "It's a DRAW! Nobody takes this one!"],
  ] },
  { id: 'shared.menu', group: 'shared', lines: [
    ['menu.welcome#1', 'Ladies and gentlemen... welcome to TEMPO!'],
    ['menu.welcome#2', "[excited] Welcome to TEMPO! Pick a game and let's GO!"],
    ['card.lobby', "It's FIGHT NIGHT! Pick two fighters... and bet your chips!"],
  ] },
  { id: 'card.corners', group: 'card', lines: [
    ['corner.blue.knuckles', 'In the blue corner... Knuckles McGRAW!'],
    ['corner.blue.professor', 'In the blue corner... The PROFESSOR!'],
    ['corner.blue.lou', 'In the blue corner... Lucky LOU!'],
    ['corner.blue.maggie', 'In the blue corner... Iron MAGGIE!'],
    ['corner.red.knuckles', 'And in the red corner... Knuckles McGRAW!'],
    ['corner.red.professor', 'And in the red corner... The PROFESSOR!'],
    ['corner.red.lou', 'And in the red corner... Lucky LOU!'],
    ['corner.red.maggie', 'And in the red corner... Iron MAGGIE!'],
  ] },
  { id: 'card.betting', group: 'card', lines: [
    ['card.bets.open', 'The betting window is OPEN! Place your bets!'],
    ['card.bets.next', 'Bets are open for the next round!'],
    ['card.bets.closing', 'Five seconds! Get those bets in!'],
    ['card.payout.won', 'Cha-ching! That bet PAYS!'],
    ['card.payout.lost', 'Ooh... that bet is gone.'],
  ] },
  { id: 'boxing.rounds', group: 'boxing', lines: [
    ['boxing.round.1', 'Round ONE!'],
    ['boxing.round.2', 'Round TWO!'],
    ['boxing.round.3', 'FINAL round! Leave it all in the ring!'],
    ['boxing.fight#1', "Let's get it ON!"],
    ['boxing.fight#2', 'Touch gloves... and FIGHT!'],
    ['boxing.last10', 'Ten seconds left in the round!'],
    ['boxing.round.end#1', "There's the bell! Back to your corners!"],
    ['boxing.round.end#2', "Ding ding! That's the round!"],
  ] },
  { id: 'boxing.verdicts', group: 'boxing', lines: [
    ['round.won.you', 'You took that round!'],
    ['round.won.house', 'The House takes that round.'],
    ['round.won.p1', 'Player One takes the round!'],
    ['round.won.p2', 'Player Two takes the round!'],
    ['round.won.knuckles', 'Knuckles McGraw takes the round!'],
    ['round.won.professor', 'The Professor takes the round!'],
    ['round.won.lou', 'Lucky Lou takes the round!'],
    ['round.won.maggie', 'Iron Maggie takes the round!'],
    ['round.even', 'Too close to call!'],
    ['boxing.colour#1', 'Hands up, chin down!'],
    ['boxing.colour#2', 'The crowd is on its FEET tonight!'],
    ['boxing.colour#3', 'Nobody wants to give an inch!'],
    ['boxing.colour#4', 'Smart boxing... waiting for the opening.'],
  ] },
  { id: 'boxing.knockdowns', group: 'boxing', lines: [
    ['down.you', "[excited] You're DOWN!"],
    ['down.house', '[excited] DOWN goes the House!'],
    ['down.p1', '[excited] Player ONE is down!'],
    ['down.p2', '[excited] Player TWO is down!'],
    ['down.knuckles', '[excited] Knuckles McGraw is DOWN!'],
    ['down.professor', '[excited] The Professor is DOWN!'],
    ['down.lou', '[excited] Lucky Lou is DOWN!'],
    ['down.maggie', '[excited] Iron Maggie is DOWN!'],
    ['down.generic', "[excited] We've got a fighter DOWN!"],
    ['count.1', 'One!'],
    ['count.2', 'Two!'],
    ['count.3', 'Three!'],
    ['count.4', 'Four!'],
    ['count.5', 'Five!'],
    ['count.6', 'Six!'],
    ['count.7', 'Seven!'],
    ['count.8', 'EIGHT!'],
    ['count.9', 'Nine!'],
    ['count.10', 'TEN!'],
  ] },
  { id: 'boxing.finish', group: 'boxing', lines: [
    ['boxing.getup#1', "They beat the count! We've still got a FIGHT!"],
    ['boxing.getup#2', 'Back on their feet!'],
    ['boxing.ko#1', "It's OVER! KNOCKOUT!"],
    ['boxing.ko#2', 'KNOCKOUT! Lights out!'],
    ['boxing.decision', "That's the final bell! We go to the scorecards..."],
  ] },
  { id: 'boxing.action', group: 'boxing', lines: [
    ['boxing.guardbreak#1', 'GUARD BREAK! Wide open!'],
    ['boxing.guardbreak#2', 'The guard is GONE!'],
    ['boxing.stagger#1', 'Ooh, that one HURT!'],
    ['boxing.stagger#2', "Rocked! They're wobbling!"],
    ['boxing.cross#1', 'What a CROSS!'],
    ['boxing.cross#2', 'BIG right hand!'],
    ['boxing.combo#1', 'Putting the combination together!'],
    ['boxing.combo#2', 'One-two... and ANOTHER!'],
    ['boxing.defense', "Great defense! Nothing's getting through!"],
    ['boxing.gassed#1', 'Running on FUMES!'],
    ['boxing.gassed#2', 'The gas tank is empty!'],
  ] },
  { id: 'bowling.calls', group: 'bowling', lines: [
    ['bowling.intro#1', "Ten frames. Let's BOWL!"],
    ['bowling.intro#2', 'Welcome to the lanes! Grab a ball!'],
    ['bowling.tenth', "Tenth frame! This is where it's WON!"],
    ['bowling.up.p1', "Player One, you're up!"],
    ['bowling.up.p2', "Player Two, you're up!"],
    ['bowling.strike#1', 'STRIKE! Right in the pocket!'],
    ['bowling.strike#2', 'Boom! All ten DOWN!'],
    ['bowling.strike#3', 'STRIKE!'],
    ['bowling.double', "Back to back! That's a DOUBLE!"],
    ['bowling.turkey', "THREE in a row! That's a TURKEY!"],
    ['bowling.hot', 'ANOTHER strike! Somebody stop this!'],
    ['bowling.spare#1', 'Picked up the SPARE!'],
    ['bowling.spare#2', 'Spare! Nice clean-up!'],
    ['bowling.split#1', "Ooh... that's a SPLIT."],
    ['bowling.split#2', "A split! This one's tough!"],
    ['bowling.split.made', 'They picked up the SPLIT! Unbelievable!'],
    ['bowling.gutter#1', 'Gutter ball!'],
    ['bowling.gutter#2', 'Straight into the gutter...'],
    ['bowling.onepin', 'Just ONE pin left standing!'],
    ['bowling.final', "That's the final frame!"],
    ['bowling.colour#1', 'Find your line... and trust it.'],
    ['bowling.colour#2', 'Nice and smooth on the release.'],
  ] },
  { id: 'golf.holes', group: 'golf', lines: [
    ['golf.hole.1', 'Hole one.'],
    ['golf.hole.2', 'Hole two.'],
    ['golf.hole.3', 'Hole three.'],
    ['golf.hole.last', 'The FINAL hole.'],
    ['golf.par.3', 'Par three.'],
    ['golf.par.4', 'Par four.'],
    ['golf.par.5', 'Par five.'],
    ['golf.wind', 'And watch that wind!'],
    ['golf.final', "And that's the round!"],
    ['golf.colour#1', 'Nice easy tempo on this swing.'],
    ['golf.colour#2', 'Pick your target... and commit.'],
  ] },
  { id: 'golf.shots', group: 'golf', lines: [
    ['golf.water#1', "SPLASH! That one's in the water."],
    ['golf.water#2', "Wet ball! That's a penalty stroke."],
    ['golf.ob#1', "That's gone... OUT of bounds!"],
    ['golf.ob#2', "Out of bounds! That'll cost a stroke."],
    ['golf.bunker#1', 'In the SAND!'],
    ['golf.bunker#2', 'Found the bunker...'],
    ['golf.green#1', 'On the green!'],
    ['golf.green#2', 'Safely on the dance floor!'],
    ['golf.putt.eagle', 'On the green... putting for EAGLE!'],
    ['golf.putt.birdie', 'On the green... putting for BIRDIE!'],
    ['golf.pickup', "That's a pick-up. On to the next one."],
  ] },
  { id: 'golf.scores', group: 'golf', lines: [
    ['golf.ace', '[excited] HOLE IN ONE! Are you KIDDING me?!'],
    ['golf.eagle', 'EAGLE! What a hole!'],
    ['golf.birdie#1', "That's a BIRDIE!"],
    ['golf.birdie#2', 'Birdie! Beautiful golf!'],
    ['golf.par#1', 'Par. Solid golf.'],
    ['golf.par#2', 'In for par.'],
    ['golf.bogey', 'Bogey. It happens.'],
    ['golf.double', 'Double bogey... ouch.'],
    ['golf.worse', "Let's just forget that hole."],
    ['golf.won.you', 'You take the hole!'],
    ['golf.won.house', 'The House takes the hole.'],
    ['golf.won.p1', 'Player One takes the hole!'],
    ['golf.won.p2', 'Player Two takes the hole!'],
    ['golf.halved', 'The hole is halved.'],
    ['golf.away.p1', 'Player One is away.'],
    ['golf.away.p2', 'Player Two is away.'],
  ] },
  // More variants for the calls heard most, so a session repeats less. Separate takes, so the takes above keep their audio.
  { id: 'shared.more', group: 'shared', lines: [
    ['win.you#2', '[excited] YOU did it! Take a bow, champ!'],
    ['win.you#3', '[excited] Victory is YOURS tonight!'],
    ['win.house#2', 'The House takes this one. Better luck next time!'],
    ['win.house#3', 'And the House wins again... the House always wins!'],
    ['win.p1#2', '[excited] Player ONE takes the victory!'],
    ['win.p2#2', '[excited] Player TWO takes the victory!'],
    ['win.knuckles#2', '[excited] Knuckles McGRAW takes the night!'],
    ['win.professor#2', '[excited] Class dismissed! The PROFESSOR wins!'],
    ['win.lou#2', '[excited] Lucky LOU does it again!'],
    ['win.maggie#2', '[excited] Iron MAGGIE outlasts them all!'],
    ['draw#2', "We've got a DEAD heat! It's a draw!"],
  ] },
  { id: 'boxing.more', group: 'boxing', lines: [
    ['boxing.fight#3', 'Here we GO!'],
    ['boxing.fight#4', "The bell rings... let's box!"],
    ['boxing.round.end#3', "That's time! Catch your breath!"],
    ['boxing.round.end#4', 'End of the round! What a battle!'],
    ['boxing.last10#2', 'Ten seconds! Finish strong!'],
    ['round.won.you#2', 'That round belongs to YOU!'],
    ['round.won.house#2', 'The House edges that round.'],
    ['round.won.p1#2', 'Player One wins that round!'],
    ['round.won.p2#2', 'Player Two wins that round!'],
    ['round.even#2', 'Dead even after that round!'],
    ['down.you#2', "[excited] You're on the canvas!"],
    ['down.house#2', '[excited] The House hits the canvas!'],
    ['down.p1#2', '[excited] Player ONE hits the canvas!'],
    ['down.p2#2', '[excited] Player TWO hits the canvas!'],
    ['boxing.getup#3', 'Up at the count! Still in this!'],
    ['boxing.ko#3', "[excited] Down and OUT! That's a knockout!"],
    ['boxing.decision#2', "It goes the distance! Let's check the scorecards..."],
    ['boxing.guardbreak#3', 'Smashed right through the guard!'],
    ['boxing.stagger#3', 'They felt THAT one!'],
    ['boxing.cross#3', 'Right down the middle!'],
    ['boxing.cross#4', 'Oh, that CROSS landed clean!'],
    ['boxing.combo#3', 'What a flurry!'],
    ['boxing.defense#2', 'Blocked, blocked, and BLOCKED again!'],
    ['boxing.gassed#3', 'Those arms are getting heavy!'],
    ['boxing.colour#5', 'What a night of boxing!'],
    ['boxing.colour#6', 'Keep those hands moving!'],
  ] },
  { id: 'card.more', group: 'card', lines: [
    ['down.knuckles#2', '[excited] Knuckles McGraw hits the canvas!'],
    ['down.professor#2', '[excited] The Professor hits the canvas!'],
    ['down.lou#2', '[excited] Lucky Lou hits the canvas!'],
    ['down.maggie#2', '[excited] Iron Maggie hits the canvas!'],
    ['round.won.knuckles#2', 'Knuckles McGraw wins that round!'],
    ['round.won.professor#2', 'The Professor wins that round!'],
    ['round.won.lou#2', 'Lucky Lou wins that round!'],
    ['round.won.maggie#2', 'Iron Maggie wins that round!'],
    ['card.bets.open#2', 'Step right up and place your bets, folks!'],
    ['card.bets.next#2', 'New round, new odds! Get your bets down!'],
    ['card.bets.closing#2', 'Last call for bets! Five seconds!'],
    ['card.payout.won#2', '[excited] Winner winner! Collect those chips!'],
    ['card.payout.lost#2', 'The House thanks you for that bet.'],
  ] },
  { id: 'bowling.more', group: 'bowling', lines: [
    ['bowling.intro#3', "Lanes are open! Let's roll!"],
    ['bowling.tenth#2', 'Last frame! Make it count!'],
    ['bowling.up.p1#2', 'Player One, step up to the lane!'],
    ['bowling.up.p2#2', 'Player Two, step up to the lane!'],
    ['bowling.strike#4', '[excited] Pins EVERYWHERE! Strike!'],
    ['bowling.strike#5', 'Right on the money... STRIKE!'],
    ['bowling.strike#6', "That's how you do it! STRIKE!"],
    ['bowling.double#2', 'Two strikes in a row! Keep it rolling!'],
    ['bowling.turkey#2', "[excited] Gobble gobble! That's a TURKEY!"],
    ['bowling.hot#2', "They're on FIRE! Another strike!"],
    ['bowling.spare#3', "Cleaned up! That's a spare!"],
    ['bowling.spare#4', 'Spare! Every pin counts!'],
    ['bowling.split#3', 'Uh oh... a wide open split!'],
    ['bowling.gutter#3', 'Ooh, found the gutter.'],
    ['bowling.onepin#2', 'So close! One pin still standing!'],
    ['bowling.onepin#3', 'Just ONE left! Go get it!'],
    ['bowling.final#2', "And that's the last ball of the game!"],
    ['bowling.colour#3', 'Line it up... and let it fly.'],
    ['bowling.colour#4', 'Deep breath... smooth release.'],
  ] },
  { id: 'golf.more', group: 'golf', lines: [
    ['golf.wind#2', 'Mind the wind out there!'],
    ['golf.final#2', "That's a wrap on the round!"],
    ['golf.water#3', 'Into the drink! Penalty stroke.'],
    ['golf.ob#3', "That's out of play! Add a stroke."],
    ['golf.bunker#3', 'Sand trap! Tricky lie.'],
    ['golf.green#3', 'Right on the green!'],
    ['golf.green#4', "Nice approach! That's on the green!"],
    ['golf.putt.birdie#2', "Here's a putt for BIRDIE!"],
    ['golf.ace#2', '[excited] Straight in from the tee! Hole in ONE!'],
    ['golf.eagle#2', '[excited] An EAGLE! Two under par!'],
    ['golf.birdie#3', '[excited] Birdie! One under par!'],
    ['golf.par#3', "That's a par. Right on target."],
    ['golf.bogey#2', 'One over. Bogey.'],
    ['golf.bogey#3', 'A bogey on that hole.'],
    ['golf.double#2', 'Double bogey. Shake it off.'],
    ['golf.worse#2', 'That hole got away from us.'],
    ['golf.pickup#2', 'Pick it up. On to the next hole.'],
    ['golf.halved#2', 'All square on that hole.'],
    ['golf.won.you#2', 'That hole is YOURS!'],
    ['golf.won.house#2', 'The House wins the hole.'],
    ['golf.won.p1#2', 'Player One wins the hole!'],
    ['golf.won.p2#2', 'Player Two wins the hole!'],
    ['golf.away.p1#2', 'Player One, your shot.'],
    ['golf.away.p2#2', 'Player Two, your shot.'],
    ['golf.colour#3', 'Easy does it... smooth swing.'],
    ['golf.colour#4', 'Read the wind... pick your club.'],
  ] },
]

type CueOptions = Omit<Cue, 'lines'>
const pri = (priority: Priority, extra: Omit<CueOptions, 'priority'> = {}): CueOptions => ({ priority, ...extra })

const OPTIONS: Record<string, CueOptions> = {
  'win.generic': pri(5), draw: pri(5),
  'menu.welcome': pri(3), 'card.lobby': pri(3),
  'card.bets.open': pri(3), 'card.bets.next': pri(3, { staleS: 4 }), 'card.bets.closing': pri(2),
  'card.payout.won': pri(3, { staleS: 3 }), 'card.payout.lost': pri(3, { staleS: 3 }),
  'boxing.round.1': pri(4), 'boxing.round.2': pri(4), 'boxing.round.3': pri(4), 'boxing.fight': pri(3), 'boxing.last10': pri(2),
  'boxing.round.end': pri(3), 'round.even': pri(3), 'boxing.colour': pri(1), 'down.generic': pri(5),
  'boxing.getup': pri(4), 'boxing.ko': pri(5), 'boxing.decision': pri(5),
  'boxing.guardbreak': pri(3), 'boxing.stagger': pri(2), 'boxing.cross': pri(2), 'boxing.combo': pri(2), 'boxing.defense': pri(2), 'boxing.gassed': pri(2),
  'bowling.intro': pri(3), 'bowling.tenth': pri(3), 'bowling.up.p1': pri(2), 'bowling.up.p2': pri(2),
  'bowling.strike': pri(4), 'bowling.double': pri(4), 'bowling.turkey': pri(4), 'bowling.hot': pri(4),
  'bowling.spare': pri(3), 'bowling.split': pri(3), 'bowling.split.made': pri(4), 'bowling.gutter': pri(2), 'bowling.onepin': pri(2),
  'bowling.final': pri(5), 'bowling.colour': pri(1),
  'golf.hole.1': pri(3), 'golf.hole.2': pri(3), 'golf.hole.3': pri(3), 'golf.hole.last': pri(3),
  'golf.par.3': pri(3), 'golf.par.4': pri(3), 'golf.par.5': pri(3), 'golf.wind': pri(3), 'golf.final': pri(5), 'golf.colour': pri(1),
  'golf.water': pri(4), 'golf.ob': pri(4), 'golf.bunker': pri(2), 'golf.green': pri(2), 'golf.putt.eagle': pri(3), 'golf.putt.birdie': pri(3), 'golf.pickup': pri(2),
  'golf.ace': pri(5), 'golf.eagle': pri(4), 'golf.birdie': pri(4), 'golf.par': pri(3), 'golf.bogey': pri(3), 'golf.double': pri(3), 'golf.worse': pri(3),
  'golf.halved': pri(3), 'golf.away.p1': pri(2), 'golf.away.p2': pri(2),
}
for (const k of NAME_KEYS) { OPTIONS[`win.${k}`] = pri(5); OPTIONS[`down.${k}`] = pri(5); OPTIONS[`round.won.${k}`] = pri(3) }
for (const k of PERSONA_KEYS) { OPTIONS[`corner.blue.${k}`] = pri(4); OPTIONS[`corner.red.${k}`] = pri(4) }
for (const k of SIDE_KEYS) OPTIONS[`golf.won.${k}`] = pri(3)
for (let n = 1; n <= 10; n++) OPTIONS[`count.${n}`] = pri(5, { beat: n < 10 }) // count ten only speaks inside the KO call

/** The cue a line belongs to: its id without the `#n` variant suffix. */
export const cueOf = (lineId: string): string => lineId.split('#')[0]

/** Every cue by id, with its line ids gathered from the takes. */
export const CUES: Readonly<Record<string, Cue>> = (() => {
  const lines: Record<string, string[]> = {}
  for (const t of TAKES) for (const [id] of t.lines) (lines[cueOf(id)] ??= []).push(id)
  const out: Record<string, Cue> = {}
  for (const [id, o] of Object.entries(OPTIONS)) out[id] = { ...o, lines: lines[id] ?? [] }
  return out
})()

const LINE_INDEX: ReadonlyMap<string, { take: Take; text: string }> = new Map(TAKES.flatMap((t) => t.lines.map(([id, text]) => [id, { take: t, text }] as const)))

/** The text of a line, or undefined for an unknown id. */
export function lineText(lineId: string): string | undefined { return LINE_INDEX.get(lineId)?.text }
/** The take a line is generated in. */
export function takeOfLine(lineId: string): Take | undefined { return LINE_INDEX.get(lineId)?.take }
/** A line's text as a caption: audio tags removed. */
export function captionText(text: string): string { return text.replace(/\[[^\]]*\]\s*/g, '').trim() }
/** All line ids in catalogue order. */
export function allLineIds(): string[] { return TAKES.flatMap((t) => t.lines.map(([id]) => id)) }
