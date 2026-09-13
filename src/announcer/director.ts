import type { SimEvent, Snapshot as BoxingSnapshot } from '../games/boxing/sim/types'
import type { BowlingEvent, Snapshot as BowlingSnapshot } from '../games/bowling/sim/types'
import type { GolfEvent, GolfSnapshot } from '../games/golf/sim/types'
import { boxingMap, type BoxingCtx } from './maps/boxing'
import { bowlingMap, type BowlingCtx } from './maps/bowling'
import { golfMap, type GolfCtx } from './maps/golf'
import type { Perspective, SportMap } from './maps/shared'

export type Sport = 'boxing' | 'bowling' | 'golf'

/** The event, context and snapshot types each sport's map works with. */
export interface SportTypes {
  boxing: { event: SimEvent; ctx: BoxingCtx; view: BoxingSnapshot }
  bowling: { event: BowlingEvent; ctx: BowlingCtx; view: BowlingSnapshot }
  golf: { event: GolfEvent; ctx: GolfCtx; view: GolfSnapshot }
}
export type MapFor<S extends Sport> = SportMap<SportTypes[S]['event'], SportTypes[S]['ctx'], SportTypes[S]['view']>

/** A fresh event map for one match of `sport`, seen from `perspective`. */
export function createMap<S extends Sport>(sport: S, perspective: Perspective): MapFor<S> {
  const make = { boxing: boxingMap, bowling: bowlingMap, golf: golfMap }[sport] as unknown as (p: Perspective) => MapFor<S>
  return make(perspective)
}

export type { BoxingCtx, BowlingCtx, GolfCtx }
export { personaKey, type Perspective, type Say, type SportMap } from './maps/shared'
