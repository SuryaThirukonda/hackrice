import { describe, expect, it } from 'vitest'
import { BowlingGame } from './game'
import { aimShot, pocketShot, releaseSpeed, TIERS } from './bot'
import { scoreFrames } from './scoring'
import { pinRadius } from './physics'
import { BALL_R, DECK_END_Z, DECK_HALF, FRAMES, OIL_Z } from './constants'
import { Rng } from '../../boxing/sim/rng'
import type { BowlingEvent, GameConfig, Phase, Shot } from './types'

const straight = (lanePos: number, power = 0.75): Shot => ({ lanePos, angleDeg: 0, power, hook: 0 })
const kinds = (ev: BowlingEvent[]): string[] => ev.map((e) => e.kind)
/** Reads phase through a call so TS does not narrow it across step(). */
const phaseOf = (g: BowlingGame): Phase => g.phase
/** Roll one ball on a fresh game and step until the pins are counted. */
function rollOnce(seed: number, shot: Shot): { g: BowlingGame; ev: BowlingEvent[] } {
  const g = new BowlingGame({ seed })
  expect(g.startRoll(shot)).toBe(true)
  const ev: BowlingEvent[] = [...g.events]
  while (g.phase === 'rolling' || g.phase === 'settle') { g.step(); ev.push(...g.events) }
  return { g, ev }
}
/** Play to game_end; human sides get shots from shotFor. */
function playGame(cfg: GameConfig, shotFor: (g: BowlingGame) => Shot = () => pocketShot()): { g: BowlingGame; ev: BowlingEvent[] } {
  const g = new BowlingGame(cfg)
  const ev: BowlingEvent[] = []
  for (let i = 0; i < 400_000 && g.phase !== 'game_end'; i++) {
    if (g.phase === 'aim' && !g.bot()) g.startRoll(shotFor(g))
    g.step(); ev.push(...g.events)
  }
  expect(g.phase).toBe('game_end')
  return { g, ev }
}

describe('ball flight', () => {
  it('a straight pocket ball (x = 0.09, power 0.75) strikes often and rarely leaves more than two pins', () => {
    let strikes = 0, le2 = 0
    for (let seed = 1; seed <= 10; seed++) {
      const n = rollOnce(seed, straight(0.09)).g.standingPins().length
      if (n === 0) strikes++
      if (n <= 2) le2++
    }
    expect(le2).toBeGreaterThanOrEqual(8)
    expect(strikes).toBeGreaterThanOrEqual(3)
  })
  it('a ball aimed at the gutter drops in, rolls straight and hits nothing', () => {
    const { g, ev } = rollOnce(3, { lanePos: 0.45, angleDeg: 4, power: 0.8, hook: 0 })
    expect(kinds(ev)).toContain('gutter')
    expect(kinds(ev)).not.toContain('pin_hit')
    expect(ev.find((e) => e.kind === 'pins_down')).toEqual({ kind: 'pins_down', count: 0 })
    expect(g.standingPins().length).toBe(10)
  })
  it('hook curves toward its sign and only after the oil line', () => {
    const xAt = (hook: number): { at11: number; at16: number } => {
      const g = new BowlingGame({ seed: 5 })
      g.startRoll({ lanePos: 0, angleDeg: 0, power: 0.75, hook })
      let at11 = NaN, at16 = NaN
      while (g.phase === 'rolling' && Number.isNaN(at16)) {
        g.step()
        if (Number.isNaN(at11) && g.ballBody.z >= OIL_Z - 1) at11 = g.ballBody.x
        if (g.ballBody.z >= 16) at16 = g.ballBody.x
      }
      return { at11, at16 }
    }
    const neg = xAt(-1), zero = xAt(0), pos = xAt(1)
    expect(pos.at11).toBeCloseTo(zero.at11, 12)
    expect(neg.at11).toBeCloseTo(zero.at11, 12)
    expect(pos.at16 - zero.at16).toBeGreaterThan(0.2)
    expect(zero.at16 - neg.at16).toBeGreaterThan(0.2)
  })
  it('power maps monotonically to release speed', () => {
    let last = -1
    for (let p = 0; p <= 1.0001; p += 0.1) {
      expect(releaseSpeed(p)).toBeGreaterThan(last); last = releaseSpeed(p)
      const g = new BowlingGame({ seed: 9 }); g.startRoll(straight(0, p))
      expect(Math.hypot(g.ballBody.vx, g.ballBody.vz)).toBeCloseTo(last, 0)
    }
    expect(releaseSpeed(0)).toBe(5); expect(releaseSpeed(1)).toBe(9)
  })
})

describe('pin physics', () => {
  it('discs never overlap after a tick and standing pins stay on the deck (20 fuzzed shots)', () => {
    const r = new Rng(77)
    for (let n = 0; n < 20; n++) {
      const g = new BowlingGame({ seed: 100 + n })
      g.startRoll({ lanePos: r.range(-0.45, 0.45), angleDeg: r.range(-4, 4), power: r.next(), hook: r.range(-1, 1) })
      let gap = Infinity, offDeck = 0 // smallest (distance - radii) seen; standing pins outside the deck
      while (g.phase === 'rolling' || g.phase === 'settle') {
        g.step()
        const live = g.pins.filter((p) => !p.removed)
        for (let i = 0; i < live.length; i++) {
          const a = live[i]
          if (!g.ballBody.gutter) gap = Math.min(gap, Math.hypot(a.x - g.ballBody.x, a.z - g.ballBody.z) - BALL_R - pinRadius(a))
          for (let j = i + 1; j < live.length; j++) gap = Math.min(gap, Math.hypot(a.x - live[j].x, a.z - live[j].z) - pinRadius(a) - pinRadius(live[j]))
          if (!a.down && (Math.abs(a.x) > DECK_HALF || a.z > DECK_END_Z)) offDeck++
        }
      }
      expect(gap).toBeGreaterThanOrEqual(-1e-6)
      expect(offDeck).toBe(0)
      expect(g.phase).toMatch(/aim|frame_end/)
    }
  })
  it('emits pin_hit once per pin and pins_down matches the standing count', () => {
    const { g, ev } = rollOnce(2, straight(0.09))
    const hits = ev.filter((e) => e.kind === 'pin_hit').map((e) => (e as { pin: number }).pin)
    expect(new Set(hits).size).toBe(hits.length)
    expect(hits).toContain(0)
    const down = ev.find((e) => e.kind === 'pins_down') as { count: number }
    expect(down.count).toBe(10 - g.standingPins().length)
  })
})

describe('scoring', () => {
  const frames = (n: number, r: number[]): number[][] => Array.from({ length: n }, () => [...r])
  it('twelve strikes score 300', () => { expect(scoreFrames([...frames(9, [10]), [10, 10, 10]]).total).toBe(300) })
  it('a spare followed by 5 scores 15 in the first frame', () => {
    const s = scoreFrames([[5, 5], [5]])
    expect(s.frames[0].score).toBe(15); expect(s.frames[1].score).toBeNull(); expect(s.total).toBe(15)
  })
  it('all gutters score 0 and an open frame sums', () => {
    expect(scoreFrames(frames(10, [0, 0])).total).toBe(0)
    expect(scoreFrames([[3, 4]]).frames[0].score).toBe(7)
  })
  it('handles the three balls of the tenth frame', () => {
    const nine = frames(9, [0, 0])
    expect(scoreFrames([...nine, [10, 10, 10]]).total).toBe(30)
    expect(scoreFrames([...nine, [5, 5, 5]]).total).toBe(15)
    expect(scoreFrames([...nine, [10, 3, 4]]).total).toBe(17)
    expect(scoreFrames([...nine, [10, 3]]).frames[9].score).toBeNull()
    expect(scoreFrames([...nine, [3, 4]]).total).toBe(7)
  })
})

describe('game flow', () => {
  it('players alternate after each frame_end and the game ends after ten frames each', () => {
    const g = new BowlingGame({ seed: 11 })
    let ends = 0
    for (let i = 0; i < 400_000 && g.phase !== 'game_end'; i++) {
      if (g.phase === 'aim') g.startRoll(pocketShot())
      g.step()
      const fe = g.events.find((e) => e.kind === 'frame_end') as { player: 'a' | 'b'; frame: number } | undefined
      if (!fe) continue
      ends++
      expect(fe.player).toBe(g.current)
      while (phaseOf(g) === 'frame_end') g.step()
      if (phaseOf(g) === 'game_end') break
      expect(g.current).not.toBe(fe.player)
      expect(g.frame).toBe(fe.player === 'b' ? fe.frame + 1 : fe.frame)
      expect(g.ball).toBe(1)
    }
    expect(ends).toBe(2 * FRAMES)
    const end = g.events.find((e) => e.kind === 'game_end') as { winner: string; totals: { a: number; b: number } }
    expect(['a', 'b', 'draw']).toContain(end.winner)
    expect(g.winner()).toBe(end.winner)
    expect(g.rolls.a.length).toBe(FRAMES); expect(g.rolls.b.length).toBe(FRAMES)
    expect(g.scoreboard().a.total).toBe(end.totals.a)
    expect(g.startRoll(pocketShot())).toBe(false)
  })
  it('the second ball keeps the standing pins and a strike re-racks', () => {
    const g = new BowlingGame({ seed: 4 })
    g.startRoll(straight(0.4)) // clips the right side only
    while (g.phase === 'rolling' || g.phase === 'settle') g.step()
    const left = g.standingPins().length
    expect(left).toBeGreaterThan(0); expect(g.ball).toBe(2); expect(g.phase).toBe('aim')
    expect(g.snapshot().pins.length).toBe(left)
  })
  it('is deterministic: same seed and shots give identical events and snapshots', () => {
    const play = (): string => {
      const r = new Rng(3)
      const { g, ev } = playGame({ seed: 21, botB: TIERS.pro }, () => ({ lanePos: r.range(-0.3, 0.3), angleDeg: r.range(-1, 1), power: r.range(0.4, 1), hook: r.range(-0.8, 0.8) }))
      return ev.map((e) => JSON.stringify(e)).join('\n') + JSON.stringify(g.snapshot())
    }
    expect(play()).toBe(play())
  })
})

describe('bots', () => {
  it('bot vs bot completes with totals in 0..300 and rolls automatically', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { g, ev } = playGame({ seed, botA: TIERS.pro, botB: TIERS.rookie })
      const sb = g.scoreboard()
      for (const s of [sb.a.total, sb.b.total]) { expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(300) }
      expect(ev.filter((e) => e.kind === 'roll_start').length).toBeGreaterThanOrEqual(2 * FRAMES)
    }
  })
  it('champ averages higher than rookie over six seeds', () => {
    const avg = (p: typeof TIERS.champ): number => {
      let t = 0
      for (let seed = 1; seed <= 6; seed++) { const sb = playGame({ seed, botA: p, botB: p }).g.scoreboard(); t += sb.a.total + sb.b.total }
      return t / 12
    }
    const champ = avg(TIERS.champ), rookie = avg(TIERS.rookie)
    expect(champ).toBeGreaterThan(rookie + 30)
    expect(champ).toBeGreaterThan(150); expect(rookie).toBeLessThan(160)
  })
  it('pocketShot compensates the hook so the ball arrives at the pocket; aimShot stays inside the lane', () => {
    const s = pocketShot(0.6, 0.75)
    expect(s.lanePos).toBeLessThan(0)
    const g = new BowlingGame({ seed: 1 }); g.startRoll(s)
    while (g.phase === 'rolling' && g.ballBody.z < 17.2) g.step()
    expect(g.ballBody.x).toBeGreaterThan(0.02); expect(g.ballBody.x).toBeLessThan(0.16)
    expect(Math.abs(aimShot(-0.46).lanePos) + BALL_R).toBeLessThan(0.525)
  })
})

describe('aim sway', () => {
  it('the aim line sways sinusoidally and the release inherits it', async () => {
    const { AIM_SWAY, swayDeg } = await import('./constants')
    expect(swayDeg(0)).toBeCloseTo(0, 9)
    expect(swayDeg(AIM_SWAY.periodTicks / 4)).toBeCloseTo(AIM_SWAY.ampDeg, 6)
    expect(swayDeg(AIM_SWAY.periodTicks / 2)).toBeCloseTo(0, 6)
    const g = new BowlingGame({ seed: 1, botA: null, botB: null })
    for (let i = 0; i < AIM_SWAY.periodTicks / 4; i++) g.step()
    expect(g.snapshot().sway).toBeCloseTo(AIM_SWAY.ampDeg, 6)
    g.startRoll({ lanePos: 0, angleDeg: 0, power: 0.7, hook: 0 })
    const e = g.events.find((x) => x.kind === 'roll_start') as { sway: number } | undefined
    expect(e?.sway).toBeCloseTo(AIM_SWAY.ampDeg, 6)
    expect(g.snapshot().ballVel.x).toBeGreaterThan(0.1) // the ball really heads right
  })
  it('a champ waits for the centre of the sway; a rookie releases almost anywhere', async () => {
    const { AIM_SWAY } = await import('./constants')
    const meanAbs = (tier: 'rookie' | 'champ') => {
      let sum = 0, n = 0
      for (let seed = 1; seed <= 6; seed++) {
        const g = new BowlingGame({ seed, botA: TIERS[tier], botB: TIERS[tier] })
        let k = 0
        while (g.phase !== 'game_end' && k++ < 120 * 600) {
          g.step()
          for (const e of g.events) if (e.kind === 'roll_start') { sum += Math.abs(e.sway); n++ }
        }
      }
      return sum / n
    }
    const champ = meanAbs('champ'), rookie = meanAbs('rookie')
    expect(champ).toBeLessThan(0.25)
    expect(rookie).toBeGreaterThan(champ * 2)
    expect(rookie).toBeLessThanOrEqual(AIM_SWAY.ampDeg)
  })
})

describe('sway lock and path preview', () => {
  it('locking freezes the sway; the release later uses the locked value, and a bot locks then charges before rolling', async () => {
    const { AIM_SWAY, BOT_CHARGE } = await import('./constants')
    const g = new BowlingGame({ seed: 3, botA: null, botB: null })
    for (let i = 0; i < AIM_SWAY.periodTicks / 4; i++) g.step()
    expect(g.lockSway()).toBe(true)
    expect(g.lockSway()).toBe(false) // once per turn
    const locked = g.snapshot().sway
    for (let i = 0; i < AIM_SWAY.periodTicks / 2; i++) g.step()
    expect(g.snapshot().sway).toBeCloseTo(locked, 9)
    expect(g.snapshot().swayLocked).toBe(true)
    g.startRoll({ lanePos: 0, angleDeg: 0, power: 0.7, hook: 0 })
    const e = g.events.find((x) => x.kind === 'roll_start') as { sway: number }
    expect(e.sway).toBeCloseTo(locked, 9)
    const bot = new BowlingGame({ seed: 3, botA: TIERS.champ, botB: TIERS.champ })
    let lockTick = -1, rollTick = -1, k = 0
    while (rollTick < 0 && k++ < 120 * 20) { bot.step(); if (lockTick < 0 && bot.locked) lockTick = bot.tick; if (bot.events.some((x) => x.kind === 'roll_start')) rollTick = bot.tick }
    expect(lockTick).toBeGreaterThan(0)
    expect(rollTick - lockTick).toBe(BOT_CHARGE)
  })
  it('the preview is straight without hook and only bends after the oil line with hook', async () => {
    const { previewPath } = await import('./preview')
    const { OIL_Z } = await import('./constants')
    const straight = previewPath({ lanePos: 0.1, angleDeg: 0, power: 0.75, hook: 0 }, 0)
    expect(straight.length).toBeGreaterThan(20)
    for (const p of straight) expect(p.x).toBeCloseTo(0.1, 6)
    const hooked = previewPath({ lanePos: 0.1, angleDeg: 0, power: 0.75, hook: 0.8 }, 0)
    for (const p of hooked) if (p.z <= OIL_Z) expect(p.x).toBeCloseTo(0.1, 6)
    expect(hooked[hooked.length - 1].x).toBeGreaterThan(0.2)
    const swayed = previewPath({ lanePos: 0, angleDeg: 0, power: 0.75, hook: 0 }, 1.5)
    expect(swayed[swayed.length - 1].x).toBeGreaterThan(0.3)
  })
})
