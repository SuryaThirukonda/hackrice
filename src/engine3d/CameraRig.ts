import { Entity } from 'playcanvas'
import { Spring } from './springs'

/** First-person camera chain: root(pos, yaw) -> head(sway/duck) -> bob -> shake -> camera. */
export class CameraRig {
  root: Entity
  head: Entity
  bob: Entity
  shake: Entity
  // Stiff on purpose: a dodge is only 250 ms, and at k = 60 the head reached less than half the sim's sway
  // before the invulnerable window had already closed, so a successful slip was invisible.
  private swayS = new Spring(0, 220)
  private duckS = new Spring(0, 160)
  private lookS = new Spring(0, 6) // slow tilt toward a fighter on the canvas
  private shakeT = 0
  private shakeA = 0
  private fovKick = 0
  private baseFov: number
  constructor(parent: Entity, camera: Entity, eyeH: number) {
    this.root = new Entity('camRoot'); this.head = new Entity('head'); this.bob = new Entity('bob'); this.shake = new Entity('shake')
    parent.addChild(this.root); this.root.addChild(this.head); this.head.addChild(this.bob); this.bob.addChild(this.shake)
    this.head.setLocalPosition(0, eyeH, 0)
    camera.setLocalPosition(0, 0, 0); camera.setLocalEulerAngles(0, 0, 0)
    this.shake.addChild(camera)
    this.baseFov = camera.camera!.fov
    this.cam = camera
  }
  private cam: Entity
  private eyeH = 0
  kick(power: number): void { this.shakeA = Math.max(this.shakeA, power); this.shakeT = 0 }
  punchKick(): void { this.fovKick = 6 }
  setBaseFov(f: number): void { this.baseFov = f }
  /**
   * @param pos world position of the player (ring metres)
   * @param yawDeg facing yaw
   * @param sway head lateral offset (m), duck vertical offset (m, negative = down)
   * @param stepPhase accumulated distance walked (for bob)
   */
  /** `lookDown` is an extra downward tilt in degrees, used to keep a fallen opponent in frame. */
  update(dt: number, pos: { x: number; z: number }, yawDeg: number, sway: number, duck: number, stepPhase: number, eyeH: number, lookDown = 0): void {
    this.eyeH = eyeH
    this.root.setPosition(pos.x, 0, pos.z)
    this.root.setEulerAngles(0, yawDeg, 0)
    const sx = this.swayS.to(sway, dt), dy = this.duckS.to(duck, dt)
    this.head.setLocalPosition(sx, this.eyeH + dy, 0.28) // eye sits a little behind the body centre
    const look = this.lookS.to(lookDown, dt)
    this.head.setLocalEulerAngles(-dy * 20 - look, 0, -sx * 26) // more roll so a slip reads as a slip
    this.bob.setLocalPosition(0.006 * Math.sin(stepPhase * Math.PI * 4), 0.012 * Math.abs(Math.sin(stepPhase * Math.PI * 4)), 0)
    this.shakeT += dt
    const A = this.shakeA * Math.exp(-this.shakeT / 0.12)
    if (A > 0.002) {
      const n1 = Math.sin(this.shakeT * 97), n2 = Math.cos(this.shakeT * 71)
      this.shake.setLocalPosition(n1 * A * 0.04, n2 * A * 0.03, 0)
      this.shake.setLocalEulerAngles(0, 0, n1 * A * 2.5)
    } else { this.shake.setLocalPosition(0, 0, 0); this.shake.setLocalEulerAngles(0, 0, 0); this.shakeA = 0 }
    this.fovKick = Math.max(0, this.fovKick - dt * 30)
    this.cam.camera!.fov = this.baseFov + this.fovKick
  }
}
