import { lightSport } from '../../../engine3d/environment'
import type { Entity } from 'playcanvas'
import { Engine3D } from '../../../engine3d/Engine3D'
import { pivot } from '../../../engine3d/primitives'
import { PIN_Z } from '../sim/constants'
import type { AimState } from '../keymap'
import type { Snapshot, V2 } from '../sim/types'
import { Fx } from '../../../engine3d/fx'
import { LaneScene, WZ } from './LaneScene'

const CAMERA_EYE = { x: 0.35, y: 2.3, z: WZ(-6.2) }
const CAMERA_LOOK = { x: 0, y: 0.28, z: WZ(PIN_Z - 1.7) }

/** Everything 3D for one bowling game: the alley, simulated objects, effects and a fixed cinematic camera. */
export class BowlingWorld {
  root: Entity
  lane: LaneScene
  fx!: Fx
  camRig: Entity
  private shakeA = 0
  private shakeT = 0
  private t = 0
  private engine: Engine3D

  constructor(engine: Engine3D) {
    this.engine = engine
    this.root = engine.newWorld('bowling')
    this.lane = new LaneScene(this.root, engine.app.graphicsDevice)
    this.fx = new Fx(this.root)
    this.camRig = pivot(this.root, 'camRig')
    // the shared camera may still hang under another game's rig: always re-parent it here
    const cam = engine.camera
    cam.parent?.removeChild(cam)
    cam.setLocalPosition(0, 0, 0); cam.setLocalEulerAngles(0, 0, 0)
    this.camRig.addChild(cam)
  }
  show(w: number, h: number): void {
    lightSport(this.engine, 'bowling')
    this.engine.show(this.root, w, h)
    this.engine.applyLook('bowling', { sky: { top: '#e7e8e4', horizon: '#f7edda', ground: '#8d9caa' }, tint: 0xffffff, saturation: 1.02, exposure: 1.05, ambient: 0xabb7c0 })
    this.engine.camera.camera!.fov = 49
    this.engine.aimLights({ x: 0, y: 0.25, z: WZ(PIN_Z) }, { x: CAMERA_EYE.x, z: CAMERA_EYE.z })
  }
  hide(): void { this.engine.hide() }
  resize(w: number, h: number): void { this.engine.resize(w, h) }
  cheer(): void { this.lane.cheer() }
  shake(power: number): void { this.shakeA = Math.max(this.shakeA, power); this.shakeT = 0 }

  /** Drive the lane from a snapshot and the player's aim (null on the House's turn), then render. */
  apply(v: Snapshot, aim: AimState | null, dt: number, path: V2[] | null = null): void {
    this.t += dt
    const aiming = v.phase === 'aim' && aim !== null
    const bx = aiming ? aim.lanePos : v.ballPos.x, bz = v.ballPos.z
    this.shakeT += dt
    const A = this.shakeA * Math.exp(-this.shakeT / 0.12)
    let sx = 0, sy = 0
    if (A > 0.002) { sx = Math.sin(this.shakeT * 97) * A * 0.04; sy = Math.cos(this.shakeT * 71) * A * 0.03 } else this.shakeA = 0
    const cam = this.engine.camera
    cam.setPosition(CAMERA_EYE.x + sx, CAMERA_EYE.y + sy, CAMERA_EYE.z)
    cam.lookAt(CAMERA_LOOK.x, CAMERA_LOOK.y, CAMERA_LOOK.z)
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
