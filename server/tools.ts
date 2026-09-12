// Tool definitions the agents call. Kept tiny so responses are fast.
export type Sport = 'boxing' | 'bowling' | 'golf'
export type BoxAction = 'jab' | 'cross' | 'block_on' | 'block_off' | 'swayL' | 'swayR' | 'duck' | 'in' | 'out' | 'left' | 'right' | 'idle'
export const BOX_ACTIONS: BoxAction[] = ['jab', 'cross', 'block_on', 'block_off', 'swayL', 'swayR', 'duck', 'in', 'out', 'left', 'right', 'idle']
export interface BoxStep { at_ms: number; do: BoxAction }
export interface BoxScript { steps: BoxStep[]; taunt?: string }
export interface BowlShot { lane_pos: number; angle_deg: number; power: number; hook: number; taunt?: string }
export interface GolfShot { club: 'driver' | 'wood3' | 'iron5' | 'iron7' | 'wedge' | 'putter'; aim_deg: number; power: number; risk: number; taunt?: string }
export type AgentOutput = { sport: 'boxing'; script: BoxScript } | { sport: 'bowling'; shot: BowlShot } | { sport: 'golf'; shot: GolfShot } | { sport: Sport; strategy: { plan: string; taunt?: string } }

/** Between-round strategy call (slow, high reasoning): a short plan the fast calls read back. */
export const STRATEGY_TOOL: FnTool = { type: 'function', name: 'strategy', strict: true, description: 'Set your game plan for the next round in one or two sentences.', parameters: { type: 'object', additionalProperties: false, required: ['plan', 'taunt'], properties: { plan: { type: 'string', description: 'max 200 chars' }, taunt: { type: ['string', 'null'] } } } }

export const INTERVAL_MS = 2500 // scripts cover the next 2.5 s; live calls take ~2 s
export const TAUNT_MAX = 60

interface FnTool { type: 'function'; name: string; description: string; strict: boolean; parameters: Record<string, unknown> }
const num = (min: number, max: number, description: string) => ({ type: 'number', minimum: min, maximum: max, description })

export const TOOLS: Record<Sport, FnTool> = {
  boxing: {
    type: 'function', name: 'act', strict: true,
    description: 'Script your boxer for the next 2.5 seconds. Steps run in order at at_ms. Keep it short and decisive.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['steps', 'taunt'],
      properties: {
        steps: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['at_ms', 'do'], properties: { at_ms: { type: 'integer', minimum: 0, maximum: INTERVAL_MS }, do: { type: 'string', enum: BOX_ACTIONS } } } },
        taunt: { type: ['string', 'null'], description: 'optional trash talk, max 60 chars' },
      },
    },
  },
  bowling: {
    type: 'function', name: 'bowl', strict: true, description: 'Roll one ball.',
    parameters: { type: 'object', additionalProperties: false, required: ['lane_pos', 'angle_deg', 'power', 'hook', 'taunt'], properties: { lane_pos: num(-0.45, 0.45, 'start position across the lane in metres'), angle_deg: num(-4, 4, 'aim angle, positive = right'), power: num(0, 1, '0 slow .. 1 max'), hook: num(-1, 1, 'curve after the oil line, positive curves right'), taunt: { type: ['string', 'null'] } } },
  },
  golf: {
    type: 'function', name: 'golf_shot', strict: true, description: 'Play one shot.',
    parameters: { type: 'object', additionalProperties: false, required: ['club', 'aim_deg', 'power', 'risk', 'taunt'], properties: { club: { type: 'string', enum: ['driver', 'wood3', 'iron5', 'iron7', 'wedge', 'putter'] }, aim_deg: num(-180, 180, 'absolute heading, 0 = toward the hole line north'), power: num(0, 1, ''), risk: num(0, 1, 'how much to gamble over hazards'), taunt: { type: ['string', 'null'] } } },
  },
}

const clamp = (x: unknown, min: number, max: number, d: number): number => { const n = typeof x === 'number' && Number.isFinite(x) ? x : d; return Math.min(max, Math.max(min, n)) }
const taunt = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, TAUNT_MAX) : undefined)

/** Validate and clamp raw tool arguments. Returns null when the shape is unusable. */
export function parseOutput(sport: Sport, raw: unknown, tool?: string): AgentOutput | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (tool === 'strategy') { if (typeof o.plan !== 'string') return null; return { sport, strategy: { plan: o.plan.trim().slice(0, 200), taunt: taunt(o.taunt) } } }
  if (sport === 'boxing') {
    if (!Array.isArray(o.steps)) return null
    const steps: BoxStep[] = []
    for (const s of o.steps.slice(0, 6)) {
      if (!s || typeof s !== 'object') continue
      const st = s as Record<string, unknown>
      if (!BOX_ACTIONS.includes(st.do as BoxAction)) continue
      steps.push({ at_ms: Math.round(clamp(st.at_ms, 0, INTERVAL_MS, 0)), do: st.do as BoxAction })
    }
    steps.sort((a, b) => a.at_ms - b.at_ms)
    return { sport, script: { steps, taunt: taunt(o.taunt) } }
  }
  if (sport === 'bowling') return { sport, shot: { lane_pos: clamp(o.lane_pos, -0.45, 0.45, 0.1), angle_deg: clamp(o.angle_deg, -4, 4, 0), power: clamp(o.power, 0, 1, 0.7), hook: clamp(o.hook, -1, 1, 0), taunt: taunt(o.taunt) } }
  const clubs = ['driver', 'wood3', 'iron5', 'iron7', 'wedge', 'putter']
  const club = clubs.includes(o.club as string) ? (o.club as GolfShot['club']) : 'iron7'
  return { sport, shot: { club, aim_deg: clamp(o.aim_deg, -180, 180, 0), power: clamp(o.power, 0, 1, 0.8), risk: clamp(o.risk, 0, 1, 0.5), taunt: taunt(o.taunt) } }
}
