
import { Engine3D } from '../../../engine3d/Engine3D'
import { ChaseRig } from '../../../engine3d/ChaseRig'
import { v3 } from '../../../engine3d/springs'
import { P } from '../../../theme'
import { EYE_H, RING_HALF } from '../sim/constants'
import type { Entity } from 'playcanvas'
import type { Snapshot } from '../sim/types'
import { OpponentRig } from './OpponentRig'
import { RingScene } from './RingScene'
import { opponentPose } from './poses'
import { Fx } from '../../../engine3d/fx'

const RAD = 180 / Math.PI

/** Everything 3D for one boxing match: ring, both fighter rigs, and a three-quarter chase camera behind the player (orbiting ringside in Fight Night). */
export class BoxingWorld {
  root: Entity
  ring: RingScene
  opp: OpponentRig
  rigA: OpponentRig
  cam: ChaseRig
  spectator = false
  fx: Fx
  private focusT = 0
  private t = 0
  private engine: Engine3D
  constructor(engine: Engine3D, oppColor = P.red, spectator = false) {
    this.engine = engine
    this.spectator = spectator
    this.root = engine.newWorld('boxing')
    const batch = { stat: engine.batchGroup('ring-static', false, 60) }
    this.ring = new RingScene(this.root, engine.app.graphicsDevice, batch)
    this.fx = new Fx(this.root)
    const rigB = engine.batchGroup('rig-b', true, 6), rigA = engine.batchGroup('rig-a', true, 6)
    this.opp = new OpponentRig(this.root, oppColor, P.blue, engine.app.graphicsDevice, rigB)
    this.rigA = new OpponentRig(this.root, P.blue, P.red, engine.app.graphicsDevice, rigA)
    engine.camera.parent?.removeChild(engine.camera)
    this.cam = new ChaseRig(this.root, engine.camera)
    engine.generateBatches([batch.stat, rigA, rigB])
  }
  show(w: number, h: number): void {
    this.engine.show(this.root, w, h)
    this.engine.applyLook('boxing', { sky: { top: '#10163a', horizon: '#6b4a3a', ground: '#0a0812', sun: { x: 0.5, y: 0.35, color: 'rgba(255,220,170,0.9)' } }, fog: { color: 0x13112c, start: 12, end: 60 }, tint: 0xfff3e8, saturation: 1.1, exposure: 1.2, ambient: 0x222a48 })
    this.fovS = this.spectator ? 52 : 50
    this.engine.camera.camera!.nearClip = 0.2 // the chase camera never gets closer than this; a larger near plane keeps depth precision for the floor decals
    this.cam.snap()
  }
  hide(): void { this.engine.hide() }
  resize(w: number, h: number): void { this.engine.resize(w, h) }
  cheer(): void { this.ring.cheer() }
  /** World position of a fighter's head for particle bursts. */
  headOf(v: Snapshot, side: 'a' | 'b'): { x: number; y: number; z: number } { const f = side === 'a' ? v.a : v.b; return { x: f.pos.x, y: EYE_H - 0.1 + f.head.y, z: f.pos.z } }
  hitFx(v: Snapshot, side: 'a' | 'b', heavy: boolean): void { const h = this.headOf(v, side); this.fx.burst('sweat', h.x, h.y, h.z); if (heavy) this.ring.flash() }
  knockdownFx(v: Snapshot, side: 'a' | 'b'): void { const f = side === 'a' ? v.a : v.b; this.fx.burst('dust', f.pos.x, 0.1, f.pos.z); this.ring.flash(); this.focusOn(v, side, 2.6); if (side === 'b') this.cam.push(2.6, 0.4) }
  guardBreakFx(v: Snapshot, side: 'a' | 'b'): void { const h = this.headOf(v, side); this.fx.burst('sparks', h.x, h.y - 0.3, h.z) }
  confetti(): void { for (const x of [-1.5, 0, 1.5]) this.fx.burst('confetti', x, 2.6, 0) }
  /** Drama focus (DOF, high quality only) on a fighter for a while. */
  focusOn(v: Snapshot, side: 'a' | 'b', seconds: number): void { const f = side === 'a' ? v.a : v.b; const cp = this.engine.camera.getPosition(); this.engine.post.focus(Math.hypot(cp.x - f.pos.x, cp.z - f.pos.z)); this.focusT = seconds }
  shake(power: number): void { this.cam.kick(power) }
  punchKick(): void { this.cam.punchKick() }

  private fovS = 0
  /** Drive every rig from an (interpolated) snapshot and render. */
  apply(v: Snapshot, dt: number, playerDown: boolean): void {
    this.t += dt
    // camera drama: a slow push during the countdown, a slight pull during the count, base lens otherwise
    const base = this.spectator ? 44 : 42
    const want = v.phase === 'countdown' ? base + 8 * Math.max(0, 1 - this.t / 4) : v.phase === 'count' ? base - 4 : base
    this.fovS += (want - this.fovS) * Math.min(1, dt * 2.5)
    const d = v.dir
    const yawA = Math.atan2(-d.x, -d.z) * RAD, yawB = Math.atan2(d.x, d.z) * RAD
    const aDown = playerDown || v.a.state === 'down' || v.a.state === 'getup' || v.a.hp <= 0
    const bDown = v.b.state === 'down' || v.b.state === 'getup' || v.b.hp <= 0
    const mx = (v.a.pos.x + v.b.pos.x) / 2, mz = (v.a.pos.z + v.b.pos.z) / 2
    if (this.spectator) {
      // ringside camera: slow orbit around the action, always framing both fighters
      const ang = this.t * 0.08
      const r = 6.0 + Math.min(1.6, v.dist * 0.6)
      this.cam.update(dt, v3(mx + Math.cos(ang) * r, 2.1, mz + Math.sin(ang) * r), v3(mx, aDown || bDown ? 0.6 : 1.0, mz), this.fovS)
    } else {
      // three-quarter chase: behind and above the player's shoulder, offset to the right so the fighters are not stacked
      const fx = d.x, fz = d.z, rx = -fz, rz = fx // fwd = a -> b (unit), right = fwd x up
      const downed = aDown ? v.a : bDown ? v.b : null
      const side = downed ? 2.6 : 2.0 // swing further round when someone is on the canvas so the standing fighter does not hide them
      const eye = v3(v.a.pos.x - fx * 3.8 + rx * side, 2.25, v.a.pos.z - fz * 3.8 + rz * side)
      // stay inside the ropes so they never cut across the fighters; when the ideal spot is outside, rise instead
      const lim = RING_HALF + 0.15, ex = Math.max(-lim, Math.min(lim, eye.x)), ez = Math.max(-lim, Math.min(lim, eye.z))
      const lost = Math.hypot(eye.x - ex, eye.z - ez)
      eye.x = ex; eye.z = ez; eye.y += lost * 0.35
      const look = downed ? v3(downed.pos.x, 0.45, downed.pos.z) : v3(v.a.pos.x + fx * v.dist * 0.6, 1.05, v.a.pos.z + fz * v.dist * 0.6)
      this.cam.update(dt, eye, look, this.fovS)
    }
    // each rig is posed against the other fighter's head in its own local frame (each faces -Z toward its opponent)
    const targetB = v3(-v.a.head.x, EYE_H + v.a.head.y, -v.dist)
    const targetA = v3(-v.b.head.x, EYE_H + v.b.head.y, -v.dist)
    const pb = opponentPose(v.b, this.t, targetB), pa = opponentPose(v.a, this.t + 1.3, targetA)
    this.opp.apply(pb, v.b.pos, yawB, dt, v.b.moving, pb.squash, this.t)
    this.rigA.apply(pa, v.a.pos, yawA, dt, v.a.moving, pa.squash, this.t + 1.3)
    const cp = this.engine.camera.getPosition()
    this.engine.aimLights({ x: (v.a.pos.x + v.b.pos.x) / 2, y: 1.1, z: (v.a.pos.z + v.b.pos.z) / 2 }, { x: cp.x, z: cp.z })
    if (this.focusT > 0) { this.focusT -= dt; if (this.focusT <= 0) this.engine.post.focus(null) }
    this.ring.update(this.t, dt, { x: cp.x, y: cp.y, z: cp.z })
    this.engine.renderFrame()
  }
}
