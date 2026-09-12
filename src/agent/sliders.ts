import { TIERS } from '../games/boxing/sim/tiers'
import type { BotParams } from '../games/boxing/sim/types'
import type { BotParams as BowlingParams } from '../games/bowling/sim/types'
import type { BotParams as GolfParams } from '../games/golf/sim/types'

/** Player-facing difficulty knobs, 0..1 each. Mapped onto the deterministic bot params per sport. */
export interface Difficulty { reaction: number; aggression: number; defense: number; accuracy: number; power: number }
export type Preset = 'rookie' | 'pro' | 'champ' | 'custom'
export const PRESETS: Record<Exclude<Preset, 'custom'>, Difficulty> = {
  rookie: { reaction: 0.2, aggression: 0.35, defense: 0.25, accuracy: 0.3, power: 0.3 },
  pro: { reaction: 0.55, aggression: 0.6, defense: 0.55, accuracy: 0.6, power: 0.55 },
  champ: { reaction: 0.9, aggression: 0.85, defense: 0.85, accuracy: 0.9, power: 0.85 },
}
export const SLIDER_KEYS: (keyof Difficulty)[] = ['reaction', 'aggression', 'defense', 'accuracy', 'power']
const c01 = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * c01(t)

/** Boxing bot params from sliders. Monotonic: more reaction = fewer reaction ticks, more defense = more block/dodge. */
export function boxingParams(d: Difficulty): BotParams {
  const base = TIERS.rookie
  return {
    reactionTicks: Math.round(lerp(48, 12, d.reaction)),
    reactionJitter: Math.round(lerp(10, 3, d.reaction)),
    blockP: lerp(0.25, 0.7, d.defense),
    dodgeP: lerp(0.05, 0.45, d.defense),
    duckP: lerp(0.3, 0.65, d.defense),
    counterP: lerp(0.05, 0.85, d.accuracy),
    aggression: lerp(0.2, 0.65, d.aggression),
    comboGap: Math.round(lerp(44, 16, d.aggression)),
    retreatTicks: Math.round(lerp(200, 100, d.accuracy)),
    comboRest: Math.round(lerp(260, 100, d.aggression)),
    patterns: d.power > 0.66 ? TIERS.champ.patterns : d.power > 0.33 ? TIERS.pro.patterns : base.patterns,
    retreatStamina: Math.round(lerp(22, 36, d.accuracy)),
    circleP: lerp(0.05, 0.5, d.accuracy),
    stepInP: lerp(0.2, 0.9, d.power),
  }
}

/** Bowling bot params from sliders: accuracy tightens aim and power noise, power raises hook skill, defense stands in for spare skill. */
export function bowlingParams(d: Difficulty): BowlingParams {
  return { aimNoiseDeg: lerp(1.2, 0.15, d.accuracy), powerNoise: lerp(0.16, 0.03, d.accuracy), hookSkill: lerp(0.05, 0.95, d.power), spareSkill: lerp(0.25, 0.92, d.defense), timing: lerp(0.1, 0.95, d.reaction) }
}
/** Golf bot params from sliders: accuracy tightens distance and aim noise, defense raises green skill, aggression raises risk taking. */
export function golfParams(d: Difficulty): GolfParams {
  return { distNoise: lerp(0.15, 0.02, d.accuracy), aimNoiseDeg: lerp(6.5, 0.7, d.accuracy), greenSkill: lerp(0.25, 0.97, d.defense), riskiness: lerp(0.2, 0.85, d.aggression) }
}

export interface GameSettings { preset: Preset; difficulty: Difficulty; seed: number | null; sound: boolean; crt: boolean; bindings: Record<string, Record<string, string[]>> }
const KEY = 'hap.v2.settings'
export const DEFAULT_SETTINGS: GameSettings = { preset: 'rookie', difficulty: { ...PRESETS.rookie }, seed: null, sound: true, crt: true, bindings: {} }
export function loadSettings(): GameSettings {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) } } catch { /* fall through */ }
  return { ...DEFAULT_SETTINGS, difficulty: { ...PRESETS.rookie } }
}
export function saveSettings(s: GameSettings): void { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ } }
export const randomSeed = (): number => Math.floor(Math.random() * 1e9)
