import { Entity } from 'playcanvas'
import { Spring3, clamp01, type V3 } from './springs'

/**
 * Third-person chase camera: root(springed eye, look-at) -> shake -> camera.
 * The springs are soft so the framing holds still during normal play; hits shake it and knockdowns push it in.
 */
export class ChaseRig {
  root: Entity
  shake: Entity
  private pos = new Spring3(7)
  private look = new Spring3(9)
  private shakeT = 0
  private shakeA = 0
  private fovKick = 0
  private pushT = 0
  private pushD = 1
  private pushM = 0
  private cam: Entity
  private first = true
  constructor(parent: Entity, camera: Entity) {
    this.root = new Entity('chaseRoot'); this.shake = new Entity('chaseShake')
    parent.addChild(this.root); this.root.addChild(this.shake)
    camera.setLocalPosition(0, 0, 0); camera.setLocalEulerAngles(0, 0, 0)
    this.shake.addChild(camera)
    this.cam = camera
  }
  /** Decaying hand-held shake; power 0..1.5. */
  kick(power: number): void { this.shakeA = Math.max(this.shakeA, power); this.shakeT = 0 }
  /** Short lens widening on a landed punch. */
  punchKick(): void { this.fovKick = 5 }
  /** Dolly toward the look point by up to `metres`, easing in and out over `seconds`. */
  push(seconds: number, metres: number): void { this.pushT = seconds; this.pushD = seconds; this.pushM = metres }
  /** Forget the smoothing so the next update lands instantly (scene start, camera cuts). */
  snap(): void { this.first = true }
  update(dt: number, eye: V3, look: V3, fov: number): void {
    if (this.first) { this.pos.set(eye); this.look.set(look); this.first = false }
    const e = this.pos.to(eye, dt), l = this.look.to(look, dt)
    let k = 0
    if (this.pushT > 0) { this.pushT -= dt; k = this.pushM * Math.sin(Math.PI * clamp01(this.pushT / this.pushD)) }
    const dx = l.x - e.x, dy = l.y - e.y, dz = l.z - e.z, len = Math.hypot(dx, dy, dz) || 1
    this.root.setPosition(e.x + (dx / len) * k, e.y + (dy / len) * k, e.z + (dz / len) * k)
    this.root.lookAt(l.x, l.y, l.z)
    this.shakeT += dt
    const A = this.shakeA * Math.exp(-this.shakeT / 0.12)
    if (A > 0.002) {
      const n1 = Math.sin(this.shakeT * 97), n2 = Math.cos(this.shakeT * 71)
      this.shake.setLocalPosition(n1 * A * 0.05, n2 * A * 0.035, 0)
      this.shake.setLocalEulerAngles(0, 0, n1 * A * 2)
    } else { this.shake.setLocalPosition(0, 0, 0); this.shake.setLocalEulerAngles(0, 0, 0); this.shakeA = 0 }
    this.fovKick = Math.max(0, this.fovKick - dt * 28)
    this.cam.camera!.fov = fov + this.fovKick
  }
}
