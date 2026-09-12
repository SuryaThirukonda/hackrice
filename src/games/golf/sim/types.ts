export interface V2 { x: number; z: number }
export interface V3 { x: number; y: number; z: number }
export type Player = 'a' | 'b'
export type Surface = 'green' | 'fairway' | 'rough' | 'bunker' | 'water' | 'ob'
export type Club = 'driver' | 'wood3' | 'iron5' | 'iron7' | 'wedge' | 'putter'
export const CLUB_LIST: readonly Club[] = ['driver', 'wood3', 'iron5', 'iron7', 'wedge', 'putter']

/** aimDeg is an absolute compass heading (0 = +z north, 90 = +x east). accuracy -1..1 adds side deviation and a small distance loss. */
export interface Shot { club: Club; aimDeg: number; power: number; accuracy: number }

export type Theme = 'meadow' | 'canyon' | 'neon'
export type PropKind = 'rock' | 'cactus' | 'tower' | 'lamp' | 'boulder' | 'palm'
/** Decorative scenery (no collision): position in hole metres and an optional scale multiplier. */
export interface Prop { kind: PropKind; p: V2; s?: number }

export interface Hole {
  par: number; tee: V2; cup: V2; greenR: number
  fairway: V2[]; course: V2[]; bunkers: { c: V2; r: number }[]; water: V2[][]; trees: V2[]
  windSeedOffset: number
  theme: Theme
  props?: Prop[]
}

export type Phase = 'aim' | 'flying' | 'rolling' | 'settled' | 'hole_end' | 'round_end'

export interface BotParams { distNoise: number; aimNoiseDeg: number; greenSkill: number; riskiness: number }

export type ShotEvent =
  | { kind: 'bounce'; surface: Surface; pos: V3 }
  | { kind: 'in_water'; pos: V3 }
  | { kind: 'out_of_bounds'; pos: V3 }
  | { kind: 'settle'; surface: Surface; pos: V3 }
  | { kind: 'cup' }

export interface HoleScore { a: number; b: number }
export interface Scorecard { holes: { hole: number; par: number; strokes: HoleScore; toPar: HoleScore }[]; totals: HoleScore; toPar: HoleScore }
export interface RoundResult { winner: Player | 'draw'; totals: HoleScore }

export type GolfEvent =
  | { kind: 'shot'; player: Player; club: Club; power: number }
  | { kind: 'bounce'; player: Player; surface: Surface; pos: V3 }
  | { kind: 'in_water'; player: Player; pos: V3 }
  | { kind: 'out_of_bounds'; player: Player; pos: V3 }
  | { kind: 'on_green'; player: Player }
  | { kind: 'holed'; player: Player; strokes: number }
  | { kind: 'pick_up'; player: Player; strokes: number }
  | { kind: 'hole_end'; hole: number; scores: HoleScore }
  | { kind: 'round_end'; winner: Player | 'draw'; totals: HoleScore }
  | { kind: 'wind'; x: number; z: number }

export interface BallView { pos: V3; vel: V3; inFlight: boolean; holed: boolean; strokes: number; surface: Surface }
export interface GolfSnapshot {
  phase: Phase; hole: number; holeData: Hole; current: Player; wind: V2
  balls: Record<Player, BallView>; scorecard: Scorecard; lastShotTrail?: V3[]
}
