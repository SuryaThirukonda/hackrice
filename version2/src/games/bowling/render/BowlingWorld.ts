import type { Entity } from 'playcanvas'
import { Engine3D } from '../../../engine3d/Engine3D'
import { pivot } from '../../../engine3d/primitives'
import { Spring3, type V3 } from '../../../engine3d/springs'
import { BALL_R, PIN_Z } from '../sim/constants'
import type { AimState } from '../keymap'
import type { Snapshot, V2 } from '../sim/types'
import { Fx } from '../../../engine3d/fx'
import { LaneScene, WZ } from './LaneScene'

export type CamMode = 'aim' | 'roll' | 'pins'
const EYE_H = 1.35 // chest height behind the foul line
const FOV: Record<CamMode, number> = { aim: 36, roll: 44, pins: 40 }
const K_SLOW = 14
const K_CHASE = 200

/** Everything 3D for one bowling game: the alley, the pins, the ball and a mode-switching camera. */
export class BowlingWorld {
  root: Entity
  lane: LaneScene
  fx!: Fx
  camRig: Entity
  mode: CamMode = 'aim'
  private posS = new Spring3(K_SLOW)
  private lookS = new Spring3(K_SLOW)
  private first = true
  private shakeA = 0
  private shakeT = 0
  private t = 0
  private fovS = FOV.aim
  private engine: Engine3D

  constructor(engine: Engine3D) {
    this.engine = engine
    this.root = engine.newWorld('bowling')
    const stat = engine.batchGroup('lane-static', false, 80)
    this.lane = new LaneScene(this.root, engine.app.graphicsDevice, stat)
    engine.generateBatches([stat])
    this.fx = new Fx(this.root)
    this.camRig = pivot(this.root, 'camRig')
    // the shared camera may still hang under another game's rig: always re-parent it here
    const cam = engine.camera
    cam.parent?.removeChild(cam)
    cam.setLocalPosition(0, 0, 0); cam.setLocalEulerAngles(0, 0, 0)
    this.camRig.addChild(cam)
  }
  show(w: number, h: number): void {
    this.engine.show(this.root, w, h)
    this.engine.applyLook('bowling', { sky: { top: '#0e1234', horizon: '#3a2a5a', ground: '#0a0812' }, fog: { color: 0x1a1238, start: 14, end: 60 }, tint: 0xf4f0ff, saturation: 1.1, exposure: 1.25, ambient: 0x46507a })
    this.engine.camera.camera!.fov = this.fovS
    this.engine.camera.camera!.nearClip = 0.1
  }
  hide(): void { this.engine.hide() }
  resize(w: number, h: number): void { this.engine.resize(w, h) }
  cheer(): void { this.lane.cheer() }
  shake(power: number): void { this.shakeA = Math.max(this.shakeA, power); this.shakeT = 0 }

  private setK(k: number): void { for (const s of [this.posS, this.lookS]) { s.x.k = k; s.y.k = k; s.z.k = k } }

  /** Drive the lane from a snapshot and the player's aim (null on the House's turn), then render. */
  apply(v: Snapshot, aim: AimState | null, dt: number, path: V2[] | null = null): void {
    this.t += dt
    const mode: CamMode = v.phase === 'rolling' ? 'roll' : v.phase === 'settle' || v.phase === 'frame_end' ? 'pins' : 'aim'
    if (mode !== this.mode) { this.mode = mode; this.setK(mode === 'roll' ? K_CHASE : K_SLOW) }
    const aiming = v.phase === 'aim' && aim !== null
    const bx = aiming ? aim.lanePos : v.ballPos.x, bz = v.ballPos.z
    let eye: V3, look: V3
    if (mode === 'aim') {
      // chest height, a little behind and to the right of the ball so the lane runs off-axis, tilted about 8 degrees down
      const a = ((aim?.angleDeg ?? 0) * Math.PI) / 180
      eye = { x: bx + 0.38, y: EYE_H, z: WZ(-2.3) }
      look = { x: bx + Math.tan(a) * 10 - 0.15, y: 0.0, z: WZ(7.5) }
    } else if (mode === 'roll') {
      eye = { x: v.ballPos.x, y: 1.2 + BALL_R, z: WZ(bz - 2.6) }
      look = { x: v.ballPos.x + v.ballVel.x * 0.25, y: 0.2, z: WZ(bz + 4) }
    } else {
      eye = { x: 0, y: 1.5, z: WZ(PIN_Z - 3.4) }
      look = { x: 0, y: 0.3, z: WZ(PIN_Z + 0.5) }
    }
    if (this.first) { this.first = false; this.posS.set(eye); this.lookS.set(look) }
    const p = this.posS.to(eye, dt), l = this.lookS.to(look, dt)
    this.shakeT += dt
    const A = this.shakeA * Math.exp(-this.shakeT / 0.12)
    let sx = 0, sy = 0
    if (A > 0.002) { sx = Math.sin(this.shakeT * 97) * A * 0.04; sy = Math.cos(this.shakeT * 71) * A * 0.03 } else this.shakeA = 0
    const cam = this.engine.camera
    cam.setPosition(p.x + sx, p.y + sy, p.z)
    cam.lookAt(l.x, l.y, l.z)
    this.fovS += (FOV[mode] - this.fovS) * Math.min(1, dt * 3)
    cam.camera!.fov = this.fovS
    this.lane.setBall(bx, bz, v.phase === 'rolling' || v.phase === 'settle')
    if (aiming && path) this.lane.setAimPath(path, v.swayLocked); else this.lane.setAimGuide(aiming ? aim : null)
    this.lane.setPins(v)
    this.lane.update(this.t, dt)
    this.engine.renderFrame()
  }
  renderFrame(): void { this.engine.renderFrame() }
  /** Sparks where a pin is struck (sim coords). */
  pinHitFx(x: number, z: number): void { this.fx.burst('pinSpark', x, 0.25, WZ(z)) }
  strikeFx(): void { this.lane.cheer(); this.lane.flash(); for (const x of [-1, 0, 1]) this.fx.burst('confetti', x, 2.2, WZ(PIN_Z - 2)) }
  sweepDust(): void { this.fx.burst('dust', 0, 0.2, WZ(PIN_Z + 0.3)) }
}
