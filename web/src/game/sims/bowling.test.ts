import { describe, expect, it } from 'vitest'
import { BowlingSim, scoreFrames } from './bowling'
import { BaseballSim } from './baseball'
import type { StartPayload } from './types'

const game = { bowling: { quick_frames: 5, k_hook: 0.8, gutter: 0.92, pocket: 0.28, roll_animation_s: 2.5, input_window_s: 20 }, baseball: { innings: 3, outs_per_half: 3, at_bat_window_s: 45, pitch_gap_s: 2.5, pitches: { fastball: { travel_ms: 900, brk: 0, height: 0.5 }, changeup: { travel_ms: 1250, brk: 0, height: 0.5 } } } }
const mk = (sport: 'bowling' | 'baseball', seed: number, params: Record<string, unknown>): StartPayload => ({ match_id: 'm', sport, seed, mode: '1p', card: false, tier: { id: 'rookie', name: 'Rookie', params }, tier_b: null, players: { P1: 'Sim' }, seats: [{ seat_id: 'P1' }], scenario: {}, adjustments: {}, game, betting_s: 12, between_s: 2 })
const bowlP = { speed_mean: 0.45, speed_sigma: 0.15, spin_mean: 60, spin_sigma: 80, lane_sigma: 0.42 }
const baseP = { W_ms: 100, pitches: ['fastball', 'changeup'], speed_mult: 0.9, house_dt_sigma_ms: 65, read_strength: 0 }

describe('bowling', () => {
  it('scores like ten-pin', () => {
    expect(scoreFrames([...Array(9).fill({ rolls: [10] }), { rolls: [10, 10, 10] }], 10).total).toBe(300)
    expect(scoreFrames([{ rolls: [5, 5] }, { rolls: [5, 0] }], 10).total).toBe(20)
    expect(scoreFrames([{ rolls: [10] }, { rolls: [3, 4] }], 10).total).toBe(24)
  })
  it('plays five frames deterministically against the House', () => {
    const play = () => { const s = new BowlingSim(); s.setup(mk('bowling', 42, bowlP)); let turns = 0
      while (s.planTurn()) { turns++; let n = 0; while (!s.inputDone() && n++ < 3) s.onGesture('P1', { seat_id: 'P1', kind: 'release', power: 0.7, t_server: 0, duration_ms: 100, extra: { lane: 0.5, speed: 0.7, spin_dps: 150 } }); for (const r of s.decisionsBefore('resolving')) s.applyDecision(r, r.default); s.resolve() }
      return { turns, sum: s.summary(), w: s.winner() } }
    const a = play(), b = play()
    expect(a).toEqual(b); expect(a.turns).toBe(5); expect((a.sum.house as { frames: number[][] }).frames.length).toBe(5); expect(['human', 'house', 'tie']).toContain(a.w)
    const p = new BowlingSim(); p.setup(mk('bowling', 1, bowlP)); expect(p.ballPath(0.5, 0.6, 300, 1).at(-1)![1]).toBeLessThan(0.5)
  })
})
describe('baseball', () => {
  it('well-timed swing hits, no swing strikes out looking', () => {
    const s = new BaseballSim(); s.setup(mk('baseball', 5, baseP)); s.planTurn(); for (const r of s.decisionsBefore('input')) s.applyDecision(r, r.default)
    let now = 1000, swungFor = -1, res = null as ReturnType<BaseballSim['resolve']> | null
    for (let i = 0; i < 600 && !res; i++) { s.step(0.1, now); if (s.pitch && swungFor !== s.pitchNo && now >= s.actualArrival) { swungFor = s.pitchNo; s.onGesture('P1', { seat_id: 'P1', kind: 'swing', power: 0.9, t_server: s.actualArrival + 5, duration_ms: 80, extra: { pitch_angle: 0.5 } }) } if (s.inputDone()) res = s.resolve(); now += 100 }
    expect(res?.outcome).toBe('hit')
    const t = new BaseballSim(); t.setup(mk('baseball', 6, baseP)); t.planTurn(); now = 1000; let r2 = null as ReturnType<BaseballSim['resolve']> | null
    for (let i = 0; i < 900 && !r2; i++) { t.step(0.1, now); if (t.inputDone()) r2 = t.resolve(); now += 100 }
    expect(r2?.outcome).toBe('out'); expect((r2?.detail.at_bat as { reason: string }).reason).toBe('looking')
  })
})
