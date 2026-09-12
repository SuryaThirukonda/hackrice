import { lightSport } from '../../../engine3d/environment'

import { Engine3D } from '../../../engine3d/Engine3D'
import { CameraRig } from '../../../engine3d/CameraRig'
import { v3 } from '../../../engine3d/springs'
import { P } from '../../../theme'
import { EYE_H } from '../sim/constants'
import { Entity } from 'playcanvas'
import type { Snapshot } from '../sim/types'
import { OpponentRig } from './OpponentRig'
import { PlayerArms } from './PlayerArms'
import { RingScene } from './RingScene'
import { opponentPose, playerArmPose } from './poses'
import { Fx } from '../../../engine3d/fx'

const RAD = 180 / Math.PI

/** Everything 3D for one boxing match: ring, the opponent, the player's camera and arms. */
export class BoxingWorld {
  root: Entity
  ring: RingScene
  opp: OpponentRig
  rigA: OpponentRig | null = null
  cam: CameraRig
  arms: PlayerArms
  spectator = false
  fx: Fx
  private ringside: Entity | null = null
  private focusT = 0
  private stepPhase = 0
  private t = 0
  private engine: Engine3D
  constructor(engine: Engine3D, oppColor = P.red, spectator = false) {
    this.engine = engine
    this.spectator = spectator
    this.root = engine.newWorld('boxing')
    const batch = { stat: engine.batchGroup('ring-static', false, 60), crowd: engine.batchGroup('ring-crowd', true, 60) }
    this.ring = new RingScene(this.root, engine.app.graphicsDevice, batch)
    this.fx = new Fx(this.root)
    this.opp = new OpponentRig(this.root, oppColor, P.blue, engine.app.graphicsDevice)
    engine.camera.parent?.removeChild(engine.camera)
    this.cam = new CameraRig(this.root, engine.camera, EYE_H)
    this.arms = new PlayerArms(engine.camera, P.blue, engine.app.graphicsDevice)
    if (spectator) {
      this.arms.root.enabled = false
      this.rigA = new OpponentRig(this.root, P.blue, P.red, engine.app.graphicsDevice)
      engine.camera.parent?.removeChild(engine.camera)
      this.ringside = new Entity('ringside')
      this.root.addChild(this.ringside)
      this.ringside.addChild(engine.camera)
      engine.camera.setLocalPosition(0, 0, 0); engine.camera.setLocalEulerAngles(0, 0, 0)
    }
    engine.generateBatches([batch.stat, batch.crowd])
  }
  show(w: number, h: number): void {
    lightSport(this.engine, 'boxing')
    this.engine.show(this.root, w, h)
    this.engine.applyLook('boxing', { sky: { top: '#e7e8e4', horizon: '#f7edda', ground: '#8d9caa' }, tint: 0xffffff, saturation: 1.02, exposure: 1.05, ambient: 0xabb7c0 })
    this.engine.camera.camera!.fov = this.spectator ? 44 : 62
    this.fovS = this.spectator ? 52 : 70
  }
  hide(): void { this.engine.hide() }
  resize(w: number, h: number): void { this.engine.resize(w, h) }
  cheer(): void { this.ring.cheer() }
  /** World position of a fighter's head for particle bursts. */
  headOf(v: Snapshot, side: 'a' | 'b'): { x: number; y: number; z: number } { const f = side === 'a' ? v.a : v.b; return { x: f.pos.x, y: EYE_H - 0.1 + f.head.y, z: f.pos.z } }
  hitFx(v: Snapshot, side: 'a' | 'b', heavy: boolean): void { const h = this.headOf(v, side); this.fx.burst('sweat', h.x, h.y, h.z); if (heavy) this.ring.flash() }
  knockdownFx(v: Snapshot, side: 'a' | 'b'): void { const f = side === 'a' ? v.a : v.b; this.fx.burst('dust', f.pos.x, 0.1, f.pos.z); this.ring.flash(); this.focusOn(v, side, 2.6) }
  guardBreakFx(v: Snapshot, side: 'a' | 'b'): void { const h = this.headOf(v, side); this.fx.burst('sparks', h.x, h.y - 0.3, h.z) }
  confetti(): void { for (const x of [-1.5, 0, 1.5]) this.fx.burst('confetti', x, 2.6, 0) }
  /** Drama focus (DOF) on a fighter for a while; spectator camera only. */
  focusOn(v: Snapshot, side: 'a' | 'b', seconds: number): void { if (!this.spectator) return; const f = side === 'a' ? v.a : v.b; const cp = this.engine.camera.getPosition(); this.engine.post.focus(Math.hypot(cp.x - f.pos.x, cp.z - f.pos.z)); this.focusT = seconds }
  shake(power: number): void { this.cam.kick(power) }
  punchKick(): void { this.cam.punchKick() }

  private fovS = 0
  /** Drive every rig from an (interpolated) snapshot and render. */
  apply(v: Snapshot, dt: number, playerDown: boolean): void {
    this.t += dt
    // camera drama: a slow push during the countdown, a slight pull during the count, base lens otherwise
    const base = this.spectator ? 44 : 62
    const want = v.phase === 'countdown' ? base + 8 * (v.count === 0 ? 1 : 1) * Math.max(0, 1 - this.t / 4) : v.phase === 'count' ? base - 6 : base
    this.fovS += (want - this.fovS) * Math.min(1, dt * 2.5)
    if (this.spectator) this.engine.camera.camera!.fov = this.fovS
    else this.cam.setBaseFov(this.fovS)
    const d = v.dir
    const yawA = Math.atan2(-d.x, -d.z) * RAD, yawB = Math.atan2(d.x, d.z) * RAD
    if (this.spectator && this.ringside && this.rigA) {
      // ringside camera: slow orbit around the action, always framing both fighters
      const mx = (v.a.pos.x + v.b.pos.x) / 2, mz = (v.a.pos.z + v.b.pos.z) / 2
      const ang = this.t * 0.08
      const r = 6.0 + Math.min(1.6, v.dist * 0.6)
      this.ringside.setPosition(mx + Math.cos(ang) * r, 2.1, mz + Math.sin(ang) * r)
      this.ringside.lookAt(mx, 1.0, mz)
      const targetB = v3(-v.a.head.x, EYE_H + v.a.head.y, -v.dist)
      const targetA = v3(-v.b.head.x, EYE_H + v.b.head.y, -v.dist)
      const pb = opponentPose(v.b, this.t, targetB), pa = opponentPose(v.a, this.t + 1.3, targetA)
      this.opp.apply(pb, v.b.pos, yawB, dt, v.b.moving, pb.squash, this.t)
      this.rigA.apply(pa, v.a.pos, yawA, dt, v.a.moving, pa.squash, this.t + 1.3)
    } else {
      this.stepPhase += v.a.moving * dt * 0.9
      const duck = playerDown ? -1.1 : v.a.head.y
      this.cam.update(dt, v.a.pos, yawA, v.a.head.x, duck, this.stepPhase, EYE_H)
      // player's head in the opponent's local frame (opponent faces -Z toward the player)
      const target = v3(-v.a.head.x, EYE_H + v.a.head.y, -v.dist)
      const pb = opponentPose(v.b, this.t, target)
      this.opp.apply(pb, v.b.pos, yawB, dt, v.b.moving, pb.squash, this.t)
      this.arms.apply(playerArmPose(v.a, this.t), dt)
    }
    const cp = this.engine.camera.getPosition()
    this.engine.aimLights({ x: (v.a.pos.x + v.b.pos.x) / 2, y: 1.1, z: (v.a.pos.z + v.b.pos.z) / 2 }, { x: cp.x, z: cp.z })
    if (this.focusT > 0) { this.focusT -= dt; if (this.focusT <= 0) this.engine.post.focus(null) }
    this.ring.update(this.t, dt, { x: cp.x, y: cp.y, z: cp.z })
    this.engine.renderFrame()
  }
}
