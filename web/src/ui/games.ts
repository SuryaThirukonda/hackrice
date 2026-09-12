// The minigame catalog shown on the home channel grid (projector idle screen and host page).
export interface GameDef { id: 'bowling' | 'baseball' | 'boxing' | 'card'; name: string; sub: string; art: string; color: string; sport: 'bowling' | 'baseball' | 'boxing'; card?: boolean; ready: boolean }
export const GAMES: GameDef[] = [
  { id: 'bowling', name: 'Bowling', sub: 'Swing, release, hook. Five frames vs the House.', art: '🎳', color: '#d9efff', sport: 'bowling', ready: true },
  { id: 'baseball', name: 'Baseball', sub: 'The House pitches. Timing decides contact.', art: '⚾', color: '#e6f7e2', sport: 'baseball', ready: true },
  { id: 'boxing', name: 'Boxing', sub: 'Punch, block, dodge. Three short rounds.', art: '🥊', color: '#ffe9e6', sport: 'boxing', ready: true },
  { id: 'card', name: 'Fight Night', sub: 'Two House boxers fight. The room bets.', art: '🎰', color: '#fff4d6', sport: 'boxing', card: true, ready: true },
]
