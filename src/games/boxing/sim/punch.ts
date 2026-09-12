import { BLOCK_DMG_MUL, BLOCK_KNOCK_MUL, DODGE_IFRAMES, FRAME, GUARD_BREAK_STAGGER, HITSTOP, HITSTOP_STAGGER, MOMENTUM_DMG, MOMENTUM_KNOCK, MOVE_FWD, SHAKE, STAGGER_BONUS, STAGGER_DMG, STAGGER_TICKS } from './constants'
import { fatigueDmg, fatigueTime, setState } from './fighter'
import type { Fighter, Flags, PunchKind, SimEvent, V2 } from './types'

/** Frozen view of a defender taken before any resolution in a tick, so same-tick trades are symmetric. */
export interface DefSnap { state: Fighter['state']; guard: boolean; dodgeTick: number; hp: number }
export const snapDefender = (f: Fighter): DefSnap => ({ state: f.state, guard: f.guard, dodgeTick: f.stateTotal - f.stateT, hp: f.hp })

export interface Out { events: SimEvent[]; flags: Flags }

const clampPower = (power: number): number => Math.max(0, Math.min(1, Number.isFinite(power) ? power : 1))

/** Map a normalized phone swing to damage. Keyboard and bot punches pass 1 and are unaffected, so the
 *  existing frame data, bot tiers and replay tests all keep their current values. */
export const punchDamageMultiplier = (power: number): number => 0.35 + 0.65 * clampPower(power)

/** Returns false (and emits gassed) when stamina is too low. */
export function startPunch(f: Fighter, kind: PunchKind, dir: V2, out: Out, power = 1): boolean {
  const fd = FRAME[kind]
  if (f.stamina < fd.stamina) { out.events.push({ kind: 'gassed', who: f.id }); return false }
  const fwd = (f.vMove.x + f.vKnock.x) * dir.x + (f.vMove.z + f.vKnock.z) * dir.z
  f.momentum = Math.min(1, Math.max(0, fwd / MOVE_FWD))
  f.stamina -= fd.stamina
  f.punch = kind; f.punchPower = clampPower(power); f.punchId++; f.resolved = false; f.thrown++; f.guard = false
  const w = Math.round(fd.windup * fatigueTime(f))
  setState(f, 'windup', w)
  out.events.push({ kind: 'windup', who: f.id, punch: kind, ticks: w })
  return true
}

/** Resolve att's active punch against def (already checked: active, in reach, unresolved). */
export function resolvePunch(att: Fighter, def: Fighter, snap: DefSnap, dir: V2, out: Out): void {
  att.resolved = true
  const fd = FRAME[att.punch], m = att.momentum
  if (snap.state === 'down' || snap.state === 'getup') return
  if (snap.state === 'dodge' && snap.dodgeTick < DODGE_IFRAMES) {
    out.events.push({ kind: 'punch', who: att.id, punch: att.punch, result: 'dodged', dmg: 0, momentum: m })
    return
  }
  let dmg = fd.dmg * punchDamageMultiplier(att.punchPower) * (1 + MOMENTUM_DMG * m) * fatigueDmg(att)
  if (snap.state === 'hitstun' || snap.state === 'stagger') dmg *= STAGGER_BONUS
  let knock = fd.knock * (1 + MOMENTUM_KNOCK * m)
  if (snap.guard) {
    dmg *= BLOCK_DMG_MUL; knock *= BLOCK_KNOCK_MUL
    def.blocked++
    def.stamina = Math.max(0, def.stamina - fd.blockCost * (1 + 0.5 * m))
    def.hp = Math.max(0, def.hp - dmg)
    att.dealtRound += dmg; att.dealtTotal += dmg
    def.vKnock.x += dir.x * knock; def.vKnock.z += dir.z * knock
    out.events.push({ kind: 'punch', who: att.id, punch: att.punch, result: 'blocked', dmg, momentum: m })
    out.flags.shake = Math.max(out.flags.shake, 0.15)
    if (def.stamina === 0) {
      def.guard = false; def.guardBroken = true
      setState(def, 'stagger', GUARD_BREAK_STAGGER); def.resolved = true
      out.events.push({ kind: 'guard_break', who: def.id })
      out.flags.hitstop = Math.max(out.flags.hitstop, HITSTOP_STAGGER)
    }
    return
  }
  att.landed++
  def.hp = Math.max(0, def.hp - dmg)
  att.dealtRound += dmg; att.dealtTotal += dmg
  def.guard = false
  def.vKnock.x += dir.x * knock; def.vKnock.z += dir.z * knock
  if (def.state === 'windup' || def.state === 'active') def.resolved = true // interrupted punch never lands
  if (dmg >= STAGGER_DMG) {
    setState(def, 'stagger', STAGGER_TICKS)
    out.events.push({ kind: 'stagger', who: def.id })
    out.flags.hitstop = Math.max(out.flags.hitstop, HITSTOP_STAGGER); out.flags.shake = Math.max(out.flags.shake, 0.6)
  } else {
    setState(def, 'hitstun', fd.hitstun)
    out.flags.hitstop = Math.max(out.flags.hitstop, HITSTOP[att.punch]); out.flags.shake = Math.max(out.flags.shake, SHAKE[att.punch])
  }
  out.events.push({ kind: 'punch', who: att.id, punch: att.punch, result: 'hit', dmg, momentum: m })
}
