import { Entity } from 'playcanvas'
import { P } from '../../../theme'
import { flatMat, shade } from '../../../engine3d/materials'
import { leatherTex } from '../../../engine3d/textures'
import { orientSegment, part, pivot, twoBoneIK } from '../../../engine3d/primitives'
import { Spring3, type V3, v3 } from '../../../engine3d/springs'
import type { ArmPose } from './poses'

const SH_L = v3(-0.32, -0.34, 0.02), SH_R = v3(0.32, -0.34, 0.02)
/** First-person arms are deliberately long: the punch end points sit ~1.1 m from the shoulder, and at 0.30 m
 *  bones two-bone IK clamped them to about half that, so the jab stopped in mid-air instead of reaching out. */
const L1 = 0.48, L2 = 0.46

/** First-person arms parented to the camera. */
export class PlayerArms {
  root: Entity
  private segs: { upper: Entity; fore: Entity; glove: Entity; elbow: Entity }[] = []
  private sL = new Spring3(170); private sR = new Spring3(170)
  private detached = false
  constructor(camera: Entity, color = P.blue, device?: import('playcanvas').GraphicsDevice) {
    // The camera is a single shared entity that every sport re-parents into its own rig, so a previous
    // match's arms would ride along into bowling/golf. Clear any stale set before hanging a new one.
    for (const child of [...camera.children]) if (child.name === 'arms') (child as Entity).destroy()
    this.root = pivot(camera, 'arms')
    const skin = flatMat(0xf3b98c, { gloss: 0.5 }), glove = flatMat(color, { gloss: 0.7, specular: 0.7, diffuseMap: device ? leatherTex(device, '#ffffff', 6) : undefined, tiling: 3 }), cuff = flatMat(0xfff1cf)
    const gloveLo = flatMat(shade(color, 0.62), { gloss: 0.55, specular: 0.5 })
    for (const n of ['L', 'R']) {
      const upper = part(this.root, n + 'upper', 'cylinder', skin, { scale: { x: 0.09, y: L1, z: 0.09 } })
      const fore = part(this.root, n + 'fore', 'cylinder', skin, { scale: { x: 0.08, y: L2, z: 0.08 } })
      const glv = part(this.root, n + 'glove', 'sphere', glove, { scale: { x: 0.15, y: 0.14, z: 0.17 } })
      part(glv, n + 'cuff', 'cylinder', cuff, { pos: { x: 0, y: -0.02, z: 0.5 }, euler: { x: 90, y: 0, z: 0 }, scale: { x: 0.72, y: 0.25, z: 0.72 }, outline: false })
      // Muscle and glove detail rides on the IK-driven segments. orientSegment leaves roll about the bone
      // uncontrolled, so segment children must be rotationally symmetric: spheres and cylinders only.
      const sd = n === 'L' ? 1 : -1
      part(upper, n + 'bicep', 'sphere', skin, { pos: { x: 0, y: -0.13, z: 0 }, scale: { x: 1.5, y: 0.58, z: 1.5 }, outline: false })
      part(fore, n + 'flexor', 'sphere', skin, { pos: { x: 0, y: -0.18, z: 0 }, scale: { x: 1.55, y: 0.56, z: 1.55 }, outline: false })
      part(fore, n + 'wrap', 'cylinder', cuff, { pos: { x: 0, y: 0.18, z: 0 }, scale: { x: 1.45, y: 0.13, z: 1.45 }, outline: false })
      part(glv, n + 'seam', 'torus', cuff, { pos: { x: 0, y: 0.02, z: 0.1 }, euler: { x: 90, y: 0, z: 0 }, scale: { x: 1.03, y: 0.3, z: 1.03 }, outline: false })
      part(glv, n + 'thumb', 'sphere', gloveLo, { pos: { x: sd * 0.42, y: -0.12, z: -0.18 }, euler: { x: 0, y: 0, z: -sd * 22 }, scale: { x: 0.36, y: 0.46, z: 0.38 }, outline: false })
      const elbow = part(this.root, n + 'elbow', 'sphere', skin, { scale: { x: 0.12, y: 0.12, z: 0.12 } })
      this.segs.push({ upper, fore, glove: glv, elbow })
    }
    this.sL.set(v3(-0.23, -0.24, -0.46)); this.sR.set(v3(0.25, -0.26, -0.43))
  }
  private arm(i: number, S: V3, T: V3, hint: V3): void {
    const s = this.segs[i]
    const ik = twoBoneIK(S, T, L1, L2, hint)
    orientSegment(s.upper, S, ik.elbow, 0.045)
    orientSegment(s.fore, ik.elbow, ik.target, 0.04)
    s.elbow.setLocalPosition(ik.elbow.x, ik.elbow.y, ik.elbow.z)
    s.glove.setLocalPosition(ik.target.x, ik.target.y, ik.target.z)
  }
  /** Remove the arms from the shared camera. The camera outlives this world, so leaving them attached
   *  would draw boxing gloves over the next sport the player enters. */
  detach(): void {
    if (this.detached) return
    this.detached = true
    this.root.destroy()
  }
  apply(pose: ArmPose, dt: number): void {
    if (this.detached) return
    this.root.setLocalEulerAngles(0, 0, pose.roll)
    this.root.setLocalPosition(0, 0, -pose.fwd)
    this.arm(0, SH_L, this.sL.to(pose.L, dt), v3(-1, -0.8, 0.1))
    this.arm(1, SH_R, this.sR.to(pose.R, dt), v3(1, -0.8, 0.1))
  }
}
