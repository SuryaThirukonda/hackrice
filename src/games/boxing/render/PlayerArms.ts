import { Entity } from 'playcanvas'
import { P } from '../../../theme'
import { flatMat } from '../../../engine3d/materials'
import { leatherTex } from '../../../engine3d/textures'
import { orientSegment, part, pivot, twoBoneIK } from '../../../engine3d/primitives'
import { Spring3, type V3, v3 } from '../../../engine3d/springs'
import type { ArmPose } from './poses'

const SH_L = v3(-0.32, -0.34, 0.02), SH_R = v3(0.32, -0.34, 0.02)
const L1 = 0.3, L2 = 0.3

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
    for (const n of ['L', 'R']) {
      const upper = part(this.root, n + 'upper', 'cylinder', skin, { scale: { x: 0.09, y: L1, z: 0.09 } })
      const fore = part(this.root, n + 'fore', 'cylinder', skin, { scale: { x: 0.08, y: L2, z: 0.08 } })
      const glv = part(this.root, n + 'glove', 'sphere', glove, { scale: { x: 0.15, y: 0.14, z: 0.17 } })
      part(glv, n + 'cuff', 'cylinder', cuff, { pos: { x: 0, y: -0.02, z: 0.5 }, euler: { x: 90, y: 0, z: 0 }, scale: { x: 0.72, y: 0.25, z: 0.72 }, outline: false })
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
