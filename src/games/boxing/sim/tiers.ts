import type { BotParams } from './types'

export const TIERS: Record<'rookie' | 'pro' | 'champ' | 'boss', BotParams> = {
  rookie: { reactionTicks: 50, reactionJitter: 10, blockP: 0.22, dodgeP: 0.06, duckP: 0.2, counterP: 0.05, aggression: 0.17, comboGap: 42, patterns: [['jab'], ['jab'], ['jab', 'cross']], circleP: 0.1, stepInP: 0.3, comboRest: 240 },
  pro: { reactionTicks: 34, reactionJitter: 8, blockP: 0.4, dodgeP: 0.16, duckP: 0.35, counterP: 0.25, aggression: 0.32, comboGap: 34, patterns: [['jab'], ['jab', 'jab'], ['jab', 'cross'], ['cross', 'jab'], ['jab', 'jab', 'cross']], circleP: 0.3, stepInP: 0.6, comboRest: 150 },
  champ: { reactionTicks: 22, reactionJitter: 5, blockP: 0.52, dodgeP: 0.28, duckP: 0.45, counterP: 0.55, aggression: 0.46, comboGap: 22, patterns: [['jab', 'cross'], ['cross', 'jab'], ['jab', 'jab', 'cross'], ['jab', 'cross', 'cross']], circleP: 0.5, stepInP: 0.85, comboRest: 100 },
  boss: { reactionTicks: 18, reactionJitter: 4, blockP: 0.62, dodgeP: 0.36, duckP: 0.5, counterP: 0.65, aggression: 0.52, comboGap: 20, patterns: [['jab', 'cross'], ['cross', 'jab', 'cross'], ['jab', 'jab', 'cross']], circleP: 0.55, stepInP: 0.9, comboRest: 90 },
}
