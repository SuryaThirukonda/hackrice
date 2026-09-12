// House boxer: plays the same physics as the human. Closes to reach, telegraphs by winding up, backs off, guards,
// and reacts to the opponent's windup after reaction_ms (block / dodge / parry at higher tiers).
import type { Rng } from './rng'
import type { BoxingSim, Fighter } from './boxing'
import { JAB } from './boxing'

export class BoxerAI {
  p: Record<string, unknown>
  mods: Record<string, number> = {}
  adjust: Record<string, number> = {}
  counterPending = false
  private reactT = -1
  private reactAction = ''
  private planT = 0
  retreatT = 0
  pattern: string[]
  private pi = 0
  private rng: Rng
  constructor(params: Record<string, unknown>, rng: Rng) {
    this.rng = rng
    this.p = { ...params }
    this.pattern = Array.isArray(params.pattern) ? [...(params.pattern as string[])] : ['jab', 'jab', 'hook']
  }
  setMods(m: Record<string, number>): void { this.mods = { ...m } }
  param(k: string, d: number): number {
    let v = Number(this.p[k] ?? d) + (this.adjust[k] ?? 0)
    if (k === 'aggression' || k === 'block_p' || k === 'dodge_p') v *= this.mods[k] ?? 1
    return v
  }
  nextPunch(): string {
    let k = this.pattern[this.pi % this.pattern.length]; this.pi++
    if (this.rng.next() < (this.mods.hook_bias ?? 0)) k = 'hook'
    return k
  }
  onOpponentWindup(me: Fighter, opp: Fighter, _sim: BoxingSim): void {
    const react = this.param('reaction_ms', 400) / 1000
    if (react > opp.stateT + 0.12) return
    const r = this.rng.next()
    const dodgeP = this.param('dodge_p', 0.1), blockP = this.param('block_p', 0.3), parryP = Number(this.p.parry_p ?? 0)
    if (parryP > 0 && r < parryP) this.reactAction = 'parry'
    else if (r < dodgeP) this.reactAction = 'dodge'
    else if (r < dodgeP + blockP) this.reactAction = 'block'
    else return
    this.reactT = Math.max(0.05, Math.min(react, Math.max(0.05, opp.stateT - 0.02)))
    void me
  }
  think(me: Fighter, opp: Fighter, sim: BoxingSim, dt: number): void {
    if (['down', 'stunned', 'stagger', 'windup', 'active', 'victory'].includes(me.state)) return
    if (this.reactT >= 0) {
      this.reactT -= dt
      if (this.reactT <= 0) {
        this.reactT = -1
        if (this.reactAction === 'block') { me.wantsGuard = true; this.retreatT = 0.45; if (this.p.counter) this.counterPending = true }
        else if (this.reactAction === 'dodge') sim.dodge(me, (-me.facing) as 1 | -1)
        else if (this.reactAction === 'parry') sim.parry(me)
        return
      }
    }
    const dist = Math.abs(opp.x - me.x), reach = JAB.reach
    this.planT -= dt
    if (this.retreatT > 0) {
      this.retreatT -= dt; me.moveDir = -me.facing
      if (this.retreatT <= 0) { me.wantsGuard = false; me.moveDir = 0; if (this.counterPending && dist <= reach + 0.05) sim.startPunch(me, 'jab', 0.9) }
      return
    }
    if (this.planT > 0) return
    this.planT = this.rng.range(0.15, 0.4)
    const aggression = this.param('aggression', 0.5)
    if (dist > reach - 0.05) { me.moveDir = me.facing; me.wantsGuard = this.rng.next() < 0.3 }
    else {
      me.moveDir = 0
      if (me.stamina > 20 && this.rng.next() < aggression * 0.55) { sim.startPunch(me, this.nextPunch(), this.rng.range(0.5, 1)); this.retreatT = 0 }
      else if (this.rng.next() < 0.35) { me.wantsGuard = true; this.retreatT = this.rng.range(0.3, 0.8) }
      else me.wantsGuard = false
    }
  }
}
