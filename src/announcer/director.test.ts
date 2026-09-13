import { describe, expect, it } from 'vitest'
import type { SimEvent, Snapshot } from '../games/boxing/sim/types'
import type { BowlingEvent, Snapshot as BowlingSnapshot } from '../games/bowling/sim/types'
import type { GolfEvent, GolfSnapshot, Phase, Player, Surface } from '../games/golf/sim/types'
import { createMap, type BoxingCtx, type BowlingCtx, type GolfCtx, type Perspective } from './director'

const ONE_P: Perspective = { mode: '1p' }
const TWO_P: Perspective = { mode: '2p' }
const CARD: Perspective = { mode: 'card', a: 'knuckles', b: 'professor' }
const flat = (calls: readonly (readonly string[])[]): string[][] => calls.map((c) => [...c])

describe('boxing map', () => {
  const box = (p: Perspective) => {
    const m = createMap('boxing', p)
    return (e: SimEvent, ctx: Partial<BoxingCtx> = {}) => flat(m.event(e, () => ({ tick: 0, round: 1, rounds: 3, ...ctx })))
  }
  const count = (who: 'a' | 'b', n: number): SimEvent => ({ kind: 'count', who, n })

  it('calls a knockdown, counts on the beat, and calls the getup', () => {
    const say = box(ONE_P)
    expect(say({ kind: 'knockdown', who: 'b', ko: false })).toEqual([['down.house']])
    for (let n = 1; n <= 8; n++) expect(say(count('b', n))).toEqual([[`count.${n}`]])
    expect(say({ kind: 'getup', who: 'b' })).toEqual([['boxing.getup']])
  })

  it('ends a Fight Night knockout with count ten, the KO call and the other corner winning', () => {
    const say = box(CARD)
    expect(say({ kind: 'knockdown', who: 'a', ko: true })).toEqual([['down.knuckles']])
    expect(say(count('a', 9))).toEqual([['count.9']])
    expect(say(count('a', 10))).toEqual([])
    expect(say({ kind: 'ko', who: 'a' })).toEqual([['count.10', 'boxing.ko', 'win.professor']])
  })

  it('names the right side in every mode, with fallbacks for unknown personas', () => {
    expect(box(ONE_P)({ kind: 'knockdown', who: 'a', ko: false })).toEqual([['down.you']])
    expect(box(TWO_P)({ kind: 'decision', winner: 'a' })).toEqual([['boxing.decision', 'win.p1']])
    expect(box(TWO_P)({ kind: 'decision', winner: 'draw' })).toEqual([['boxing.decision', 'draw']])
    const unknown: Perspective = { mode: 'card', a: null, b: 'lou' }
    expect(box(unknown)({ kind: 'knockdown', who: 'a', ko: false })).toEqual([['down.generic']])
    expect(box(unknown)({ kind: 'ko', who: 'b' })).toEqual([['count.10', 'boxing.ko', 'win.generic']])
  })

  it('introduces Fight Night corners with the betting call, and says nothing at the start of 1P', () => {
    expect(flat(createMap('boxing', CARD).start())).toEqual([['corner.blue.knuckles', 'corner.red.professor', 'card.bets.open']])
    expect(flat(createMap('boxing', { mode: 'card', a: null, b: 'maggie' }).start())).toEqual([['corner.red.maggie', 'card.bets.open']])
    expect(createMap('boxing', ONE_P).start()).toEqual([])
  })

  it('calls rounds, the opening bell and round verdicts, but not the last round', () => {
    const say = box(ONE_P)
    expect(say({ kind: 'countdown', n: 3 }, { round: 1 })).toEqual([['boxing.round.1']])
    expect(say({ kind: 'countdown', n: 2 }, { round: 1 })).toEqual([])
    expect(say({ kind: 'countdown', n: 3 }, { round: 2 })).toEqual([['boxing.round.2']])
    expect(say({ kind: 'countdown', n: 3 }, { round: 3 })).toEqual([['boxing.round.3']])
    expect(say({ kind: 'bell', round: 1, end: false })).toEqual([['boxing.fight']])
    expect(say({ kind: 'bell', round: 2, end: false })).toEqual([])
    expect(say({ kind: 'bell', round: 1, end: true }, { roundWinner: 'b' })).toEqual([['boxing.round.end', 'round.won.house']])
    expect(say({ kind: 'bell', round: 2, end: true }, { round: 2, roundWinner: 'draw' })).toEqual([['boxing.round.end', 'round.even']])
    expect(say({ kind: 'bell', round: 3, end: true }, { round: 3, roundWinner: 'a' })).toEqual([])
  })

  it('calls an unanswered three-punch combination and a run of blocks', () => {
    const say = box(ONE_P)
    const hit = (who: 'a' | 'b', tick: number, punch: 'jab' | 'cross' = 'jab'): string[][] =>
      say({ kind: 'punch', who, punch, result: 'hit', dmg: 5, momentum: 0 }, { tick })
    expect(hit('a', 0)).toEqual([])
    expect(hit('a', 100)).toEqual([])
    expect(hit('b', 150)).toEqual([]) // answered: the run restarts
    expect(hit('a', 200)).toEqual([])
    expect(hit('a', 250)).toEqual([])
    expect(hit('a', 300)).toEqual([['boxing.combo']])
    const block = (tick: number) => say({ kind: 'punch', who: 'b', punch: 'jab', result: 'blocked', dmg: 0, momentum: 0 }, { tick })
    expect([block(1000), block(1200), block(1400)]).toEqual([[], [], [['boxing.defense']]])
    expect(say({ kind: 'punch', who: 'a', punch: 'cross', result: 'hit', dmg: 12, momentum: 0.8 }, { tick: 5000 })).toEqual([['boxing.cross']])
  })

  it('calls your own fatigue in 1P only, at most every thirty seconds', () => {
    const say = box(ONE_P)
    expect(say({ kind: 'gassed', who: 'b' }, { tick: 0 })).toEqual([])
    expect(say({ kind: 'gassed', who: 'a' }, { tick: 0 })).toEqual([['boxing.gassed']])
    expect(say({ kind: 'gassed', who: 'a' }, { tick: 120 * 10 })).toEqual([])
    expect(say({ kind: 'gassed', who: 'a' }, { tick: 120 * 31 })).toEqual([['boxing.gassed']])
  })

  it('warns once per round when ten seconds remain', () => {
    const m = createMap('boxing', ONE_P)
    const view = (round: number, clock: number, phase: Snapshot['phase'] = 'fighting') => ({ round, clock, phase }) as Snapshot
    expect(m.frame(view(1, 11))).toEqual([])
    expect(flat(m.frame(view(1, 9.9)))).toEqual([['boxing.last10']])
    expect(m.frame(view(1, 9))).toEqual([])
    expect(m.frame(view(2, 5, 'count'))).toEqual([])
    expect(flat(m.frame(view(2, 5)))).toEqual([['boxing.last10']])
    expect(m.live(view(2, 50))).toBe(true)
    expect(m.live(view(2, 50, 'rest'))).toBe(false)
  })
})

describe('bowling map', () => {
  const lane = (p: Perspective) => {
    const m = createMap('bowling', p)
    const say = (e: BowlingEvent, ctx: Partial<BowlingCtx> = {}) => flat(m.event(e, () => ({ batch: [e], standing: [], player: 'a', frame: 1, ...ctx })))
    const turn = (current: 'a' | 'b', frame: number) => flat(m.frame({ phase: 'aim', current, frame } as BowlingSnapshot))
    return { m, say, turn }
  }

  it('builds a strike streak and resets it after a ball that is not a strike', () => {
    const { say } = lane(ONE_P)
    const strike: BowlingEvent = { kind: 'strike', player: 'a' }
    expect([say(strike), say(strike), say(strike), say(strike)]).toEqual([[['bowling.strike']], [['bowling.double']], [['bowling.turkey']], [['bowling.hot']]])
    expect(say({ kind: 'pins_down', count: 7 }, { standing: [1, 3, 4] })).toEqual([]) // 2-4-5 left: no split, streak over
    expect(say(strike)).toEqual([['bowling.strike']])
  })

  it('does not reset the streak on the pins_down of a strike or on a second ball', () => {
    const { say } = lane(ONE_P)
    say({ kind: 'strike', player: 'b' })
    const down: BowlingEvent = { kind: 'pins_down', count: 10 }
    expect(say(down, { player: 'b', batch: [down, { kind: 'strike', player: 'b' }], standing: [] })).toEqual([])
    expect(say({ kind: 'pins_down', count: 2 }, { player: 'b', standing: [6] })).toEqual([]) // leave after ball one: not a full rack
    expect(say({ kind: 'strike', player: 'b' })).toEqual([['bowling.double']])
  })

  it('calls a split, then its conversion; a plain spare; one pin left; a gutter ball', () => {
    const { say } = lane(ONE_P)
    expect(say({ kind: 'pins_down', count: 8 }, { standing: [6, 9], frame: 4 })).toEqual([['bowling.split']])
    expect(say({ kind: 'spare', player: 'a' }, { frame: 4 })).toEqual([['bowling.split.made']])
    expect(say({ kind: 'pins_down', count: 6 }, { standing: [1, 3, 4, 7], frame: 5 })).toEqual([])
    expect(say({ kind: 'spare', player: 'a' }, { frame: 5 })).toEqual([['bowling.spare']])
    expect(say({ kind: 'pins_down', count: 9 }, { standing: [9] })).toEqual([['bowling.onepin']])
    expect(say({ kind: 'gutter' })).toEqual([['bowling.gutter']])
  })

  it('calls 2P turns and the tenth frame, and the result with the winner', () => {
    const { turn, say } = lane(TWO_P)
    expect(turn('a', 1)).toEqual([])
    expect(turn('b', 1)).toEqual([['bowling.up.p2']])
    expect(turn('b', 1)).toEqual([])
    expect(turn('a', 2)).toEqual([['bowling.up.p1']])
    expect(turn('a', 10)).toEqual([['bowling.tenth']])
    expect(turn('b', 10)).toEqual([['bowling.up.p2']])
    expect(say({ kind: 'game_end', winner: 'b', totals: { a: 120, b: 140 } })).toEqual([['bowling.final', 'win.p2']])
    expect(lane(ONE_P).say({ kind: 'game_end', winner: 'draw', totals: { a: 99, b: 99 } })).toEqual([['bowling.final', 'draw']])
  })

  it('treats only a human aiming as live play', () => {
    const one = lane(ONE_P).m, two = lane(TWO_P).m
    expect(one.live({ phase: 'aim', current: 'a' } as BowlingSnapshot)).toBe(true)
    expect(one.live({ phase: 'aim', current: 'b' } as BowlingSnapshot)).toBe(false)
    expect(two.live({ phase: 'aim', current: 'b' } as BowlingSnapshot)).toBe(true)
    expect(two.live({ phase: 'rolling', current: 'b' } as BowlingSnapshot)).toBe(false)
  })
})

describe('golf map', () => {
  const course = (p: Perspective) => {
    const m = createMap('golf', p)
    const say = (e: GolfEvent, ctx: Partial<GolfCtx> = {}) => flat(m.event(e, () => ({ par: 4, hole: 0, nHoles: 3, windMax: 6, strokes: 0, ...ctx })))
    const frame = (phase: Phase, current: Player = 'a', surface: Surface = 'fairway') =>
      flat(m.frame({ phase, current, balls: { a: { surface }, b: { surface } } } as unknown as GolfSnapshot))
    return { m, say, frame }
  }
  const pos = { x: 0, y: 0, z: 0 }

  it('introduces each hole with its number, par and a strong wind', () => {
    const { say } = course(ONE_P)
    expect(say({ kind: 'wind', x: 3, z: 4 }, { hole: 0, par: 4 })).toEqual([['golf.hole.1', 'golf.par.4', 'golf.wind']])
    expect(say({ kind: 'wind', x: 1, z: 1 }, { hole: 1, par: 3 })).toEqual([['golf.hole.2', 'golf.par.3']])
    expect(say({ kind: 'wind', x: 0, z: 0 }, { hole: 2, par: 5 })).toEqual([['golf.hole.last', 'golf.par.5']])
  })

  it('calls the putt that is coming and every score word', () => {
    const { say } = course(ONE_P)
    expect(say({ kind: 'on_green', player: 'a' }, { strokes: 1, par: 4 })).toEqual([['golf.putt.eagle']])
    expect(say({ kind: 'on_green', player: 'a' }, { strokes: 2, par: 4 })).toEqual([['golf.putt.birdie']])
    expect(say({ kind: 'on_green', player: 'b' }, { strokes: 3, par: 4 })).toEqual([['golf.green']])
    const holed = (strokes: number, par: number) => say({ kind: 'holed', player: 'a', strokes }, { par })
    expect([holed(1, 3), holed(3, 5), holed(3, 4), holed(4, 4), holed(5, 4), holed(6, 4), holed(8, 4)])
      .toEqual([[['golf.ace']], [['golf.eagle']], [['golf.birdie']], [['golf.par']], [['golf.bogey']], [['golf.double']], [['golf.worse']]])
    expect(say({ kind: 'in_water', player: 'a', pos })).toEqual([['golf.water']])
    expect(say({ kind: 'out_of_bounds', player: 'b', pos })).toEqual([['golf.ob']])
    expect(say({ kind: 'pick_up', player: 'b', strokes: 8 })).toEqual([['golf.pickup']])
  })

  it('calls who won each hole except the last, then the round result', () => {
    expect(course(ONE_P).say({ kind: 'hole_end', hole: 0, scores: { a: 4, b: 4 } })).toEqual([['golf.halved']])
    expect(course(ONE_P).say({ kind: 'hole_end', hole: 0, scores: { a: 3, b: 4 } })).toEqual([['golf.won.you']])
    expect(course(TWO_P).say({ kind: 'hole_end', hole: 1, scores: { a: 5, b: 4 } })).toEqual([['golf.won.p2']])
    expect(course(ONE_P).say({ kind: 'hole_end', hole: 2, scores: { a: 3, b: 4 } })).toEqual([])
    expect(course(ONE_P).say({ kind: 'round_end', winner: 'a', totals: { a: 12, b: 14 } })).toEqual([['golf.final', 'win.you']])
  })

  it('calls a ball that stops in a bunker, but not after a penalty', () => {
    const { say, frame } = course(ONE_P)
    say({ kind: 'shot', player: 'a', club: 'iron7', power: 0.8 })
    expect([frame('aim'), frame('flying'), frame('settled', 'a', 'bunker')]).toEqual([[], [], [['golf.bunker']]])
    say({ kind: 'shot', player: 'a', club: 'wedge', power: 0.5 })
    frame('flying')
    say({ kind: 'in_water', player: 'a', pos })
    expect(frame('settled', 'a', 'bunker')).toEqual([])
  })

  it('says who is away in 2P, but not on the first shot of a hole', () => {
    const { say, frame } = course(TWO_P)
    say({ kind: 'wind', x: 0, z: 0 })
    expect(frame('aim', 'a')).toEqual([])
    say({ kind: 'shot', player: 'a', club: 'driver', power: 1 })
    frame('flying', 'a'); frame('settled', 'a')
    expect(frame('aim', 'b')).toEqual([['golf.away.p2']])
    say({ kind: 'shot', player: 'b', club: 'driver', power: 1 })
    frame('flying', 'b'); frame('settled', 'b')
    expect(frame('aim', 'b')).toEqual([]) // same player again
    frame('hole_end', 'b')
    say({ kind: 'wind', x: 0, z: 0 }, { hole: 1 })
    expect(frame('aim', 'a')).toEqual([])
  })
})
