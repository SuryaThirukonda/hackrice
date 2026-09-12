import { bezier2, clamp01, easeInOut, easeOutCubic, type V3, v3 } from '../../../engine3d/springs'
import type { FighterView } from '../sim/types'

/** Opponent target pose in its root-local frame: -Z points at the player, feet at y = 0. */
export interface OpponentPose { x: number; y: number; z: number; pitch: number; roll: number; twist: number; headPitch: number; gloveL: V3; gloveR: V3; kL: number; kR: number; squash: number }

const GUARD_L = v3(-0.2, 1.36, -0.3), GUARD_R = v3(0.22, 1.33, -0.28)
const BLOCK_L = v3(-0.12, 1.52, -0.26), BLOCK_R = v3(0.12, 1.5, -0.26)
/** Knocked-down pose: +pitch tips the head away from the player, the hips (pivot at 0.95 m) fall to 0.18 m so the back rests on the canvas. */
const DOWN_PITCH = 86, DOWN_Y = -0.77, DOWN_Z = 0.3

/** Glove path for a punch given phase (state) and progress 0..1. target = player's head in opponent-local coords. */
function punchGlove(kind: 'jab' | 'cross', state: string, progress: number, target: V3, guard: V3): V3 {
  const side = kind === 'jab' ? -1 : 1
  const back = v3(guard.x + side * 0.12, guard.y - 0.05, guard.z + 0.22)
  const mid = v3(target.x + side * (kind === 'cross' ? 0.35 : 0.1), target.y + 0.1, (target.z + back.z) / 2)
  if (state === 'windup') {
    if (progress < 0.45) { const u = easeInOut(progress / 0.45); return v3(guard.x + (back.x - guard.x) * u, guard.y + (back.y - guard.y) * u, guard.z + (back.z - guard.z) * u) }
    const u = easeOutCubic((progress - 0.45) / 0.55)
    return bezier2(back, mid, target, u)
  }
  if (state === 'active') return target
  if (state === 'recover') { const u = easeInOut(clamp01(progress / 0.55)); return v3(target.x + (guard.x - target.x) * u, target.y + (guard.y - target.y) * u, target.z + (guard.z - target.z) * u) }
  return guard
}

export function opponentPose(f: FighterView, t: number, playerHead: V3): OpponentPose {
  const p: OpponentPose = { x: 0, y: 0, z: 0, pitch: 0, roll: 0, twist: 0, headPitch: 0, gloveL: { ...GUARD_L }, gloveR: { ...GUARD_R }, kL: 0, kR: 0, squash: 1 }
  const bobY = Math.sin(t * 2.4) * 0.02, bobR = Math.sin(t * 1.7) * 2
  p.y = bobY; p.roll = bobR
  p.gloveL.y += Math.sin(t * 3) * 0.02; p.gloveR.y += Math.cos(t * 3) * 0.02
  const target = v3(playerHead.x, playerHead.y - 0.05, playerHead.z + 0.1) // glove centre sits a glove radius inside the head surface: a visible contact
  switch (f.state) {
    case 'windup': case 'active': case 'recover': {
      const g = punchGlove(f.punch, f.state, f.progress, target, f.punch === 'jab' ? GUARD_L : GUARD_R)
      if (f.punch === 'jab') p.gloveL = g; else p.gloveR = g
      const ext = f.state === 'active' ? 1 : f.state === 'windup' ? Math.max(0, (f.progress - 0.45) / 0.55) : 1 - clamp01(f.progress / 0.55)
      // shoulder drives forward with the punch so the fully extended arm reaches the opponent
      p.twist = (f.punch === 'jab' ? -18 : 30) * ext; p.pitch = 14 * ext; p.z = -0.24 * ext
      // anticipation crouch on the windup, stretch through the extension
      p.squash = f.state === 'windup' && f.progress < 0.45 ? 1 - 0.06 * (f.progress / 0.45) : 1 + 0.05 * ext
      break
    }
    case 'dodge': {
      const u = f.progress < 0.7 ? easeOutCubic(f.progress / 0.7) : 1 - easeInOut((f.progress - 0.7) / 0.3)
      if (f.dodge === 'duck') { p.y = -0.35 * u; p.pitch = 22 * u; p.headPitch = 10 * u; p.squash = 1 - 0.12 * u } else { const s = f.dodge === 'swayL' ? -1 : 1; p.x = s * 0.32 * u; p.roll = -s * 14 * u }
      break
    }
    case 'hitstun': { const u = 1 - f.progress; p.pitch = -14 * u; p.z = 0.08 * u; p.headPitch = -18 * u; p.squash = 1 - 0.08 * u; break }
    case 'stagger': { const u = 1 - f.progress; p.pitch = -16 * u; p.roll = Math.sin(f.progress * Math.PI * 3) * 12 * u; p.z = 0.18 * u; p.gloveL.y -= 0.35 * u; p.gloveR.y -= 0.35 * u; p.headPitch = -10 * u; break }
    case 'down': { // topple backward: hips drop to the canvas (pivot is at hip height) and the body slides back a touch
      const u = easeOutCubic(clamp01(f.progress / 0.1)); p.pitch = DOWN_PITCH * u; p.y = DOWN_Y * u; p.z = DOWN_Z * u; p.headPitch = -14 * u
      p.gloveL = v3(-0.62, 1.2, -0.22); p.gloveR = v3(0.62, 1.15, -0.2); p.roll = Math.sin(t * 3) * 2 * u; break }
    case 'getup': { const u = 1 - easeInOut(f.progress); p.pitch = DOWN_PITCH * u; p.y = DOWN_Y * u; p.z = DOWN_Z * u; p.headPitch = -14 * u; p.roll = Math.sin(f.progress * Math.PI * 2) * 8 * u; break }
    default: break
  }
  if (f.guard && (f.state === 'idle' || f.state === 'recover')) { p.gloveL = { ...BLOCK_L }; p.gloveR = { ...BLOCK_R }; p.headPitch = 10; p.pitch = 4 }
  if (f.hp <= 0 && f.state !== 'down') { p.pitch = DOWN_PITCH; p.y = DOWN_Y; p.z = DOWN_Z; p.headPitch = -14; p.gloveL = v3(-0.62, 1.2, -0.22); p.gloveR = v3(0.62, 1.15, -0.2) }
  return p
}
