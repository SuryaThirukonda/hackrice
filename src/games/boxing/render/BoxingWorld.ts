import { lightSport } from '../../../engine3d/environment'

import { Engine3D } from '../../../engine3d/Engine3D'
import { CameraRig } from '../../../engine3d/CameraRig'
import { v3 } from '../../../engine3d/springs'
import { P } from '../../../theme'
import { EYE_H } from '../sim/constants'
import { Color, Entity, Layer, LAYERID_WORLD, TONEMAP_ACES, Vec4 } from 'playcanvas'
import type { Snapshot } from '../sim/types'
import { OpponentRig, type BoxerModel } from './OpponentRig'
import { PlayerArms } from './PlayerArms'
import { RingScene } from './RingScene'
import { opponentPose, playerArmPose } from './poses'
import { Fx } from '../../../engine3d/fx'

const RAD = 180 / Math.PI
const LAYER_P1 = 1001
const LAYER_P2 = 1002

function setSubtreeLayers(root: Entity, layerId: number): void {
  if (root.render) {
    root.render.layers = [layerId]
  }
  for (const child of root.children) {
    setSubtreeLayers(child as Entity, layerId)
  }
}

/** Everything 3D for one boxing match: ring, opponent(s), camera(s) and arms. Supports 1P, spectator, and 2P split-screen. */
export class BoxingWorld {
  root: Entity
  ring: RingScene
  opp: OpponentRig
  rigA: OpponentRig | null = null
  cam: CameraRig
  camB: CameraRig | null = null
  camBEntity: Entity | null = null
  arms: PlayerArms
  armsB: PlayerArms | null = null
  spectator = false
  is2p = false
  fx: Fx
  private ringside: Entity | null = null
  private focusT = 0
  private stepPhase = 0
  private stepPhaseB = 0
  private t = 0
  private engine: Engine3D
  private fovS = 0
  /** The shared camera's layers before a two-player match narrowed them; put back on hide so other sports keep theirs. */
  private savedCameraLayers: number[] | null = null

  constructor(engine: Engine3D, oppColor = P.red, spectator = false, model: BoxerModel = 'beginner', fighters?: [{ model?: BoxerModel; color: number }, { model?: BoxerModel; color: number }], is2p = false) {
    this.engine = engine
    this.spectator = spectator
    this.is2p = is2p
    this.root = engine.newWorld('boxing')
    const batch = { stat: engine.batchGroup('ring-static', false, 60), crowd: engine.batchGroup('ring-crowd', true, 60) }
    this.ring = new RingScene(this.root, engine.app.graphicsDevice, batch)
    this.fx = new Fx(this.root)

    if (is2p) {
      // 2-Player Split Screen:
      // P1 (blue gloves, red trunks) on the left screen, facing P2
      // P2 (red gloves, blue trunks) on the right screen, facing P1
      this.opp = new OpponentRig(this.root, P.red, P.blue, engine.app.graphicsDevice, fighters?.[1].model ?? model) // P2 3D body
      this.rigA = new OpponentRig(this.root, P.blue, P.red, engine.app.graphicsDevice, fighters?.[0].model ?? model) // P1 3D body

      // Camera A (P1)
      engine.camera.parent?.removeChild(engine.camera)
      this.cam = new CameraRig(this.root, engine.camera, EYE_H)
      this.arms = new PlayerArms(engine.camera, P.blue, engine.app.graphicsDevice)

      // Camera B (P2)
      this.camBEntity = new Entity('cameraB')
      this.camBEntity.addComponent('camera', {
        clearColor: new Color(0, 0, 0, 0),
        clearColorBuffer: true,
        clearDepthBuffer: true,
        fov: 62,
        nearClip: 0.05,
        farClip: 80,
        toneMapping: TONEMAP_ACES,
        priority: 1,
        rect: new Vec4(0.5, 0, 0.5, 1),
      })
      this.root.addChild(this.camBEntity)
      this.camB = new CameraRig(this.root, this.camBEntity, EYE_H)
      this.armsB = new PlayerArms(this.camBEntity, P.red, engine.app.graphicsDevice)

      // Layer setup: separate P1 view and P2 view so neither clips through their own body
      let l1 = engine.app.scene.layers.getLayerById(LAYER_P1)
      if (!l1) {
        l1 = new Layer({ id: LAYER_P1, name: 'P1' })
        engine.app.scene.layers.push(l1)
      }
      let l2 = engine.app.scene.layers.getLayerById(LAYER_P2)
      if (!l2) {
        l2 = new Layer({ id: LAYER_P2, name: 'P2' })
        engine.app.scene.layers.push(l2)
      }

      this.savedCameraLayers = [...engine.camera.camera!.layers]
      engine.camera.camera!.rect = new Vec4(0, 0, 0.5, 1)
      engine.camera.camera!.priority = 0
      engine.camera.camera!.layers = [LAYERID_WORLD, LAYER_P1]
      this.camBEntity.camera!.layers = [LAYERID_WORLD, LAYER_P2]

      engine.key.light!.layers = [LAYERID_WORLD, LAYER_P1, LAYER_P2]
      engine.fill.light!.layers = [LAYERID_WORLD, LAYER_P1, LAYER_P2]
      engine.rim.light!.layers = [LAYERID_WORLD, LAYER_P1, LAYER_P2]

      // P1 view sees P1 arms and P2 body
      setSubtreeLayers(this.arms.root, LAYER_P1)
      setSubtreeLayers(this.opp.root, LAYER_P1)

      // P2 view sees P2 arms and P1 body
      setSubtreeLayers(this.armsB.root, LAYER_P2)
      setSubtreeLayers(this.rigA.root, LAYER_P2)
    } else {
      this.opp = new OpponentRig(this.root, fighters?.[1].color ?? oppColor, fighters?.[1].color ?? P.red, engine.app.graphicsDevice, fighters?.[1].model ?? model)
      engine.camera.parent?.removeChild(engine.camera)
      this.cam = new CameraRig(this.root, engine.camera, EYE_H)
      this.arms = new PlayerArms(engine.camera, P.blue, engine.app.graphicsDevice)
      if (spectator) {
        this.arms.root.enabled = false
        this.rigA = new OpponentRig(this.root, fighters?.[0].color ?? P.blue, fighters?.[0].color ?? P.red, engine.app.graphicsDevice, fighters?.[0].model ?? 'pro')
        engine.camera.parent?.removeChild(engine.camera)
        this.ringside = new Entity('ringside')
        this.root.addChild(this.ringside)
        this.ringside.addChild(engine.camera)
        engine.camera.setLocalPosition(0, 0, 0); engine.camera.setLocalEulerAngles(0, 0, 0)
      }
    }
    engine.generateBatches([batch.stat, batch.crowd])
  }

  show(w: number, h: number): void {
    lightSport(this.engine, 'boxing')
    this.engine.show(this.root, w, h)
    this.engine.applyLook('boxing', { sky: { top: '#e7e8e4', horizon: '#f7edda', ground: '#8d9caa' }, tint: 0xffffff, saturation: 1.02, exposure: 1.05, ambient: 0xabb7c0 })
    this.engine.camera.camera!.fov = this.spectator ? 44 : 62
    this.fovS = this.spectator ? 52 : 62
    if (this.is2p) {
      // Disable full-screen post composite pass so both split viewports render directly
      this.engine.post.frame.enabled = false
      this.engine.camera.camera!.rect = new Vec4(0, 0, 0.5, 1)
    }
  }

  hide(): void {
    this.arms.detach()
    if (this.armsB) this.armsB.detach()
    if (this.camBEntity) {
      this.camBEntity.destroy()
      this.camBEntity = null
      this.camB = null
    }
    if (this.engine.camera.camera) {
      this.engine.camera.camera.rect = new Vec4(0, 0, 1, 1)
      if (this.savedCameraLayers) { this.engine.camera.camera.layers = this.savedCameraLayers; this.savedCameraLayers = null }
    }
    this.engine.key.light!.layers = [LAYERID_WORLD]
    this.engine.fill.light!.layers = [LAYERID_WORLD]
    this.engine.rim.light!.layers = [LAYERID_WORLD]
    this.engine.post.frame.enabled = this.engine.quality !== 'low'
    this.engine.hide()
  }

  resize(w: number, h: number): void { this.engine.resize(w, h) }
  cheer(): void { this.ring.cheer() }

  /** World position of a fighter's head for particle bursts. */
  headOf(v: Snapshot, side: 'a' | 'b'): { x: number; y: number; z: number } {
    const f = side === 'a' ? v.a : v.b
    return { x: f.pos.x, y: EYE_H - 0.1 + f.head.y, z: f.pos.z }
  }

  hitFx(v: Snapshot, side: 'a' | 'b', heavy: boolean): void {
    const h = this.headOf(v, side)
    this.fx.burst('sweat', h.x, h.y, h.z)
    if (heavy) this.ring.flash()
  }

  knockdownFx(v: Snapshot, side: 'a' | 'b'): void {
    const f = side === 'a' ? v.a : v.b
    this.fx.burst('dust', f.pos.x, 0.1, f.pos.z)
    this.ring.flash()
    this.focusOn(v, side, 2.6)
  }

  guardBreakFx(v: Snapshot, side: 'a' | 'b'): void {
    const h = this.headOf(v, side)
    this.fx.burst('sparks', h.x, h.y - 0.3, h.z)
  }

  confetti(): void {
    for (const x of [-1.5, 0, 1.5]) this.fx.burst('confetti', x, 2.6, 0)
  }

  /** Drama focus (DOF) on a fighter for a while; spectator camera only. */
  focusOn(v: Snapshot, side: 'a' | 'b', seconds: number): void {
    if (!this.spectator) return
    const f = side === 'a' ? v.a : v.b
    const cp = this.engine.camera.getPosition()
    this.engine.post.focus(Math.hypot(cp.x - f.pos.x, cp.z - f.pos.z))
    this.focusT = seconds
  }

  shake(power: number, side?: 'a' | 'b'): void {
    if (!side || side === 'a') this.cam.kick(power)
    if ((!side || side === 'b') && this.camB) this.camB.kick(power)
  }

  punchKick(side?: 'a' | 'b'): void {
    if (!side || side === 'a') this.cam.punchKick()
    if ((!side || side === 'b') && this.camB) this.camB.punchKick()
  }

  /** Drive every rig from an (interpolated) snapshot and render. */
  apply(v: Snapshot, dt: number, playerDown: boolean): void {
    this.t += dt
    const base = this.spectator ? 44 : 62
    const want = v.phase === 'countdown' ? base + 8 * (v.count === 0 ? 1 : 1) * Math.max(0, 1 - this.t / 4) : v.phase === 'count' ? base - 6 : base
    this.fovS += (want - this.fovS) * Math.min(1, dt * 2.5)

    if (this.spectator) this.engine.camera.camera!.fov = this.fovS
    else {
      this.cam.setBaseFov(this.fovS)
      if (this.camB) this.camB.setBaseFov(this.fovS)
    }

    const d = v.dir
    // yawA faces towards B; yawB faces towards A
    const yawA = Math.atan2(-d.x, -d.z) * RAD
    const yawB = Math.atan2(d.x, d.z) * RAD

    if (this.is2p && this.camB && this.armsB && this.rigA) {
      // --- 2-PLAYER SPLIT SCREEN MODE ---
      this.stepPhase += v.a.moving * dt * 0.9
      this.stepPhaseB += v.b.moving * dt * 0.9

      const p1Down = playerDown || v.a.state === 'down' || v.a.state === 'getup' || v.a.hp <= 0
      const p2Down = v.b.state === 'down' || v.b.state === 'getup' || v.b.hp <= 0

      // Left Camera (P1): eye at v.a.pos, looking across at v.b
      const duckA = p1Down ? -1.35 : v.a.head.y
      const lookDownA = p2Down && !p1Down ? Math.atan2(EYE_H - 0.25, v.dist + 0.9) * RAD : 0
      this.cam.update(dt, v.a.pos, yawA, v.a.head.x, duckA, this.stepPhase, EYE_H, lookDownA)

      // Right Camera (P2): eye at v.b.pos, looking across at v.a
      const duckB = p2Down ? -1.35 : v.b.head.y
      const lookDownB = p1Down && !p2Down ? Math.atan2(EYE_H - 0.25, v.dist + 0.9) * RAD : 0
      this.camB.update(dt, v.b.pos, yawB, v.b.head.x, duckB, this.stepPhaseB, EYE_H, lookDownB)

      // 3D Boxer Models:
      // pb is P2's body, facing P1 at yawB
      const targetB = v3(-v.a.head.x, EYE_H + v.a.head.y, -v.dist)
      const pb = opponentPose(v.b, this.t, targetB)
      this.opp.apply(pb, v.b.pos, yawB, dt, v.b.moving, pb.squash, this.t)

      // pa is P1's body, facing P2 at yawA
      const targetA = v3(-v.b.head.x, EYE_H + v.b.head.y, -v.dist)
      const pa = opponentPose(v.a, this.t, targetA)
      this.rigA.apply(pa, v.a.pos, yawA, dt, v.a.moving, pa.squash, this.t)

      // First-person arms
      this.arms.apply(playerArmPose(v.a, this.t), dt)
      this.armsB.apply(playerArmPose(v.b, this.t), dt)
    } else if (this.spectator && this.ringside && this.rigA) {
      // Ringside camera: slow orbit around the action, framing both fighters
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
      const duck = playerDown ? -1.35 : v.a.head.y
      const oppDown = v.b.state === 'down' || v.b.state === 'getup' || v.b.hp <= 0
      const lookDown = oppDown && !playerDown ? Math.atan2(EYE_H - 0.25, v.dist + 0.9) * RAD : 0
      this.cam.update(dt, v.a.pos, yawA, v.a.head.x, duck, this.stepPhase, EYE_H, lookDown)
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
