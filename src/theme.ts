// Comic night-city palette: vibrant, saturated, thick ink outlines.
export const P = { sky1: 0x6fd6ff, sky2: 0x1f8ff0, plum: 0x1b2a6b, magenta: 0xff2e88, pink: 0xff7ad9, cyan: 0x2ad4ff, teal: 0x22c6a5, gold: 0xffd50a, orange: 0xff8c1a, lime: 0x9dff3a, purple: 0x7c5cff, ink: 0x141414, paper: 0xfff1cf, red: 0xff3a3a, blue: 0x2f6cf6, green: 0x35d06b }
export const HEX = (n: number) => '#' + n.toString(16).padStart(6, '0')
export const FONT = 'ui-monospace, "Courier New", monospace'
export const DISPLAY = 'ui-monospace, "Courier New", monospace'
export const ACCENTS = [P.red, P.gold, P.blue, P.cyan, P.magenta, P.green, P.orange, P.purple]

export interface GameDef { id: string; name: string; tagline: string; color: number; ready: boolean }
export const GAMES: GameDef[] = [
  { id: 'boxing', name: 'Boxing', tagline: 'Jab, hook, parry. Three rounds vs the House.', color: P.red, ready: true },
  { id: 'bowling', name: 'Bowling', tagline: 'Aim, charge, hook. Ten frames vs the House.', color: P.blue, ready: true },
  { id: 'golf', name: 'Golf', tagline: 'Three holes, wind, one swing meter.', color: P.green, ready: true },
  { id: 'card', name: 'Fight Night', tagline: 'House vs House. The room bets.', color: P.orange, ready: true },
]
