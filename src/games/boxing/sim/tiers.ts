import type { BotParams } from './types'

export const TIERS: Record<'rookie' | 'pro' | 'champ', BotParams> = {
  rookie: { reactionTicks: 50, reactionJitter: 10, blockP: 0.22, dodgeP: 0.06, duckP: 0.2, counterP: 0.05, aggression: 0.17, comboGap: 42, patterns: [['jab'], ['jab'], ['jab', 'cross']], retreatStamina: 14, circleP: 0.1, stepInP: 0.3, retreatTicks: 180, comboRest: 240 },
  pro: { reactionTicks: 34, reactionJitter: 8, blockP: 0.4, dodgeP: 0.16, duckP: 0.35, counterP: 0.25, aggression: 0.32, comboGap: 34, patterns: [['jab'], ['jab', 'jab'], ['jab', 'cross'], ['cross', 'jab'], ['jab', 'jab', 'cross']], retreatStamina: 16, circleP: 0.3, stepInP: 0.6, retreatTicks: 144, comboRest: 150 },
  champ: { reactionTicks: 22, reactionJitter: 5, blockP: 0.52, dodgeP: 0.28, duckP: 0.45, counterP: 0.55, aggression: 0.46, comboGap: 22, patterns: [['jab', 'cross'], ['cross', 'jab'], ['jab', 'jab', 'cross'], ['jab', 'cross', 'cross']], retreatStamina: 18, circleP: 0.5, stepInP: 0.85, retreatTicks: 108, comboRest: 100 },
}
