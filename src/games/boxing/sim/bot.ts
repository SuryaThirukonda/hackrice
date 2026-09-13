import { FRAME } from './constants'
import type { Rng } from './rng'
import type { BotParams, Command, DodgeKind, Fighter, PunchKind } from './types'
import { cmd } from './types'

type Mode = 'approach' | 'engage' | 'react'

/** Deterministic opponent. Reads public fighter state and emits the same Command a human would. */
export class Bot {
  p: BotParams
  mode: Mode = 'approach'
  combo: PunchKind[] = []
  comboT = 0
  planT = 0
  reactAt = -1
  reactCmd: 'block' | DodgeKind | null = null
  lastOppPunchId = 0
  strafeDir: -1 | 1 = 1
  holdBlockT = 0
  dodged = false
  restT = 0         // ticks of rest after a combo before planning the next
  constructor(p: BotParams) { this.p = p }
  setParams(p: BotParams): void { this.p = p }

  decide(me: Fighter, opp: Fighter, dist: number, now: number, rng: Rng): Command {
    const p = this.p, c = cmd()
    // reaction scheduling on a fresh opponent windup
    if (opp.punchId !== this.lastOppPunchId && opp.state === 'windup') {
      this.lastOppPunchId = opp.punchId
      const r = rng.next()
      if (r < p.dodgeP) this.reactCmd = rng.next() < p.duckP && opp.punch === 'cross' ? 'duck' : rng.next() < 0.5 ? 'swayL' : 'swayR'
      else if (r < p.dodgeP + p.blockP) this.reactCmd = 'block'
      else this.reactCmd = null
      if (this.reactCmd) {
        let at = now + p.reactionTicks + rng.int(-p.reactionJitter, p.reactionJitter)
        const latest = now + opp.stateT - 1
        if (latest >= now + 1) at = Math.min(at, latest)
        this.reactAt = Math.max(now + 1, at)
      }
    }
    if (this.reactCmd && now >= this.reactAt) {
      if (this.reactCmd === 'block') this.holdBlockT = Math.max(this.holdBlockT, opp.stateT + 14)
      else { c.dodge = this.reactCmd; this.mode = 'react'; this.dodged = true }
      this.reactCmd = null
    }
    if (this.holdBlockT > 0) { c.block = true; this.holdBlockT-- }

    if (this.restT > 0) this.restT--
    // There is no retreat mode: a bot dodges, blocks, ducks or punches. Stamina refills fast enough that
    // a breather never needs to be a place to stand.

    const reach = FRAME.jab.reach
    switch (this.mode) {
      case 'approach':
        c.forward = dist > reach - 0.12 ? 1 : 0
        if (rng.next() < p.circleP * 0.05) this.strafeDir = this.strafeDir === 1 ? -1 : 1
        if (rng.next() < p.circleP) c.strafe = this.strafeDir
        if (dist <= reach) { this.mode = 'engage'; this.planT = rng.int(6, 24) }
        break
      case 'engage':
        if (dist > reach + 0.15) { this.mode = 'approach'; break }
        if (dist > reach - 0.08) c.forward = 1 // close the last step so punches land (and gain momentum)
        if (this.combo.length) {
          if (--this.comboT <= 0 && (me.state === 'idle' || (me.state === 'recover' && me.stateT <= 6))) {
            const next = this.combo.shift()!
            c.punch = next; this.comboT = p.comboGap
            if (next === 'cross' && rng.next() < p.stepInP) c.forward = 1
            if (!this.combo.length) this.restT = p.comboRest
          }
        } else if (this.restT === 0 && --this.planT <= 0) {
          this.planT = rng.int(p.comboGap * 2, p.comboGap * 5)
          const r1 = rng.next(), r2 = rng.next()
          if (r1 < p.aggression) { this.combo = [...rng.choice(p.patterns)]; this.comboT = 1 }
          else if (r2 < 0.4) this.holdBlockT = rng.int(18, 60)
          else { this.strafeDir = rng.choice([-1, 1] as const); c.strafe = this.strafeDir }
        }
        break
      case 'react':
        if (me.state !== 'dodge') {
          this.mode = 'engage'; this.planT = 4
          if (this.dodged && rng.next() < p.counterP) { this.combo = ['cross']; this.comboT = 1 }
          this.dodged = false
        }
        break
    }
    return c
  }
}
