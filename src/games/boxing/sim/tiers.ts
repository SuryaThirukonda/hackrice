import type { BotParams } from './types'

export const TIERS: Record<'rookie' | 'pro' | 'champ', BotParams> = {
  rookie: { reactionTicks: 42, reactionJitter: 8, blockP: 0.35, dodgeP: 0.1, duckP: 0.3, counterP: 0.1, aggression: 0.18, comboGap: 40, patterns: [['jab'], ['jab'], ['jab', 'cross']], retreatStamina: 25, circleP: 0.1, stepInP: 0.3, retreatTicks: 180, comboRest: 240 },
  pro: { reactionTicks: 26, reactionJitter: 6, blockP: 0.55, dodgeP: 0.25, duckP: 0.5, counterP: 0.4, aggression: 0.45, comboGap: 28, patterns: [['jab'], ['jab', 'jab'], ['jab', 'cross'], ['cross', 'jab'], ['jab', 'jab', 'cross']], retreatStamina: 30, circleP: 0.3, stepInP: 0.6, retreatTicks: 144, comboRest: 150 },
  champ: { reactionTicks: 16, reactionJitter: 4, blockP: 0.65, dodgeP: 0.4, duckP: 0.6, counterP: 0.8, aggression: 0.6, comboGap: 18, patterns: [['jab', 'cross'], ['cross', 'jab'], ['jab', 'jab', 'cross'], ['jab', 'cross', 'cross']], retreatStamina: 35, circleP: 0.5, stepInP: 0.85, retreatTicks: 108, comboRest: 100 },
}
