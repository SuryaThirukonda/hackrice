import { Entity } from 'playcanvas'
import { P } from '../../../theme'
import { flatMat } from '../../../engine3d/materials'
import { leatherTex, weaveTex } from '../../../engine3d/textures'
import { orientSegment, part, pivot, setDefaultBatch, twoBoneIK } from '../../../engine3d/primitives'
import { Spring, Spring3, type V3, v3 } from '../../../engine3d/springs'
import type { OpponentPose } from './poses'

const SKIN = 0xf3b98c, HAIR = 0x141414
const SH_L = v3(-0.3, 1.43, 0), SH_R = v3(0.3, 1.43, 0)
const L1 = 0.36, L2 = 0.34 // upper arm and forearm: long enough to reach the opponent's head from jab range with the lunge

/** Procedural toon boxer driven by an OpponentPose. Root faces -Z. */
export class OpponentRig {
  root: Entity
  lean: Entity
  body: Entity
  torso: Entity
  head: Entity
  private upperL: Entity; private foreL: Entity; private gloveL: Entity; private elbowL: Entity
  private upperR: Entity; private foreR: Entity; private gloveR: Entity; private elbowR: Entity
  private sPos = new Spring3(90)
  private sPitch = new Spring(0, 70); private sRoll = new Spring(0, 70); private sTwist = new Spring(0, 90); private sHead = new Spring(0, 80)
  private sGL = new Spring3(140); private sGR = new Spring3(140)
  private sSquash = new Spring(1, 120)
  private legL: Entity | null = null; private legR: Entity | null = null
  private walk = 0

  constructor(parent: Entity, color = P.red, trunks = P.blue, device?: import('playcanvas').GraphicsDevice, batch = -1) {
    this.root = pivot(parent, 'opponent')
    setDefaultBatch(batch) // a dynamic batch group merges the rig's parts per material; the batcher re-transforms them each frame
    const leather = device ? leatherTex(device, '#ffffff', 5) : undefined, weave = device ? weaveTex(device, '#ffffff', '#000000') : undefined
    this.lean = pivot(this.root, 'lean', v3(0, 0.95, 0))
    this.body = pivot(this.lean, 'body', v3(0, -0.95, 0))
    const skin = flatMat(SKIN, { gloss: 0.5, specular: 0.4 }), glove = flatMat(color, { gloss: 0.7, specular: 0.7, metalness: 0.1, diffuseMap: leather, tiling: 3 }), trunk = flatMat(trunks, { gloss: 0.4, diffuseMap: weave, tiling: 6 }), boot = flatMat(0xffffff, { gloss: 0.6 })
    // legs hang from hip pivots so they can swing in a walk cycle
    for (const s of [-1, 1]) {
      const hip = pivot(this.body, 'hip', v3(s * 0.13, 0.95, 0))
      part(hip, 'thigh', 'cylinder', skin, { pos: { x: 0, y: -0.23, z: 0 }, scale: { x: 0.17, y: 0.44, z: 0.17 } })
      part(hip, 'knee', 'sphere', skin, { pos: { x: 0, y: -0.45, z: 0 }, scale: { x: 0.17, y: 0.17, z: 0.17 }, outline: false })
      part(hip, 'shin', 'cylinder', skin, { pos: { x: 0, y: -0.67, z: 0.01 }, scale: { x: 0.14, y: 0.42, z: 0.14 } })
      part(hip, 'calf', 'sphere', skin, { pos: { x: 0, y: -0.6, z: 0.05 }, scale: { x: 0.14, y: 0.2, z: 0.13 }, outline: false })
      part(hip, 'boot', 'box', boot, { pos: { x: 0, y: -0.88, z: -0.04 }, scale: { x: 0.16, y: 0.14, z: 0.3 } })
      part(hip, 'sole', 'box', flatMat(0x2a2a2a), { pos: { x: 0, y: -0.955, z: -0.04 }, scale: { x: 0.17, y: 0.02, z: 0.31 }, outline: false })
      part(hip, 'bootStripe', 'box', flatMat(color), { pos: { x: 0, y: -0.86, z: -0.04 }, scale: { x: 0.165, y: 0.03, z: 0.305 }, outline: false })
      part(hip, 'sock', 'cylinder', flatMat(0xffffff), { pos: { x: 0, y: -0.8, z: 0.01 }, scale: { x: 0.145, y: 0.06, z: 0.145 }, outline: false })
      if (s < 0) this.legL = hip; else this.legR = hip
    }
    // trunks with a waistband stripe and side panels, then a built torso: chest plate, pecs, abs, lats and trapezius caps
    const dark = flatMat(0x141414), stripeM = flatMat(0xfff1cf)
    part(this.body, 'trunks', 'box', trunk, { pos: { x: 0, y: 0.98, z: 0 }, scale: { x: 0.46, y: 0.3, z: 0.28 } })
    for (const sx of [-1, 1]) part(this.body, 'trunkPanel', 'box', stripeM, { pos: { x: sx * 0.235, y: 0.98, z: 0 }, scale: { x: 0.01, y: 0.26, z: 0.2 }, outline: false })
    part(this.body, 'belt', 'box', flatMat(P.gold), { pos: { x: 0, y: 1.1, z: 0 }, scale: { x: 0.48, y: 0.07, z: 0.3 } })
    part(this.body, 'beltStripe', 'box', dark, { pos: { x: 0, y: 1.1, z: -0.152 }, scale: { x: 0.48, y: 0.02, z: 0.01 }, outline: false })
    this.torso = part(this.body, 'torso', 'box', skin, { pos: { x: 0, y: 1.3, z: 0 }, scale: { x: 0.52, y: 0.5, z: 0.3 } })
    for (const sx of [-1, 1]) part(this.body, 'pec', 'sphere', skin, { pos: { x: sx * 0.13, y: 1.4, z: -0.13 }, scale: { x: 0.24, y: 0.16, z: 0.12 }, outline: false })
    for (const sx of [-1, 1]) part(this.body, 'lat', 'sphere', skin, { pos: { x: sx * 0.24, y: 1.32, z: 0.02 }, scale: { x: 0.12, y: 0.3, z: 0.24 }, outline: false })
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) part(this.body, 'ab', 'box', skin, { pos: { x: sx * 0.06, y: 1.24 - i * 0.07, z: -0.15 }, scale: { x: 0.1, y: 0.05, z: 0.03 }, outline: false })
    part(this.body, 'shoulders', 'box', skin, { pos: { x: 0, y: 1.46, z: 0 }, scale: { x: 0.68, y: 0.14, z: 0.26 }, outline: false })
    for (const sx of [-1, 1]) part(this.body, 'delt', 'sphere', skin, { pos: { x: sx * 0.32, y: 1.45, z: 0 }, scale: { x: 0.2, y: 0.18, z: 0.22 } })
    for (const sx of [-1, 1]) part(this.body, 'trap', 'sphere', skin, { pos: { x: sx * 0.14, y: 1.53, z: 0.02 }, scale: { x: 0.18, y: 0.1, z: 0.16 }, outline: false })
    part(this.body, 'neck', 'cylinder', skin, { pos: { x: 0, y: 1.57, z: 0 }, scale: { x: 0.14, y: 0.12, z: 0.14 }, outline: false })
    this.head = pivot(this.body, 'headPivot', v3(0, 1.62, 0))
    part(this.head, 'head', 'sphere', skin, { pos: { x: 0, y: 0.15, z: 0 }, scale: { x: 0.32, y: 0.34, z: 0.32 } })
    part(this.head, 'jaw', 'box', skin, { pos: { x: 0, y: 0.05, z: -0.02 }, scale: { x: 0.22, y: 0.1, z: 0.24 }, outline: false })
    part(this.head, 'hair', 'sphere', flatMat(HAIR), { pos: { x: 0, y: 0.23, z: 0.04 }, scale: { x: 0.3, y: 0.22, z: 0.3 }, outline: false })
    for (const sx of [-1, 1]) part(this.head, 'ear', 'sphere', skin, { pos: { x: sx * 0.16, y: 0.15, z: 0 }, scale: { x: 0.05, y: 0.08, z: 0.06 }, outline: false })
    part(this.head, 'brow', 'box', flatMat(HAIR), { pos: { x: 0, y: 0.215, z: -0.14 }, scale: { x: 0.2, y: 0.025, z: 0.04 }, outline: false })
    part(this.head, 'eyeL', 'sphere', dark, { pos: { x: -0.07, y: 0.17, z: -0.15 }, scale: { x: 0.05, y: 0.05, z: 0.03 }, outline: false })
    part(this.head, 'eyeR', 'sphere', dark, { pos: { x: 0.07, y: 0.17, z: -0.15 }, scale: { x: 0.05, y: 0.05, z: 0.03 }, outline: false })
    part(this.head, 'nose', 'box', skin, { pos: { x: 0, y: 0.13, z: -0.165 }, scale: { x: 0.05, y: 0.06, z: 0.05 }, outline: false })
    part(this.head, 'guardTeeth', 'box', flatMat(0xffffff), { pos: { x: 0, y: 0.07, z: -0.14 }, scale: { x: 0.12, y: 0.03, z: 0.04 }, outline: false })
    // arms (segments are positioned by IK each frame)
    const mk = (n: string): [Entity, Entity, Entity, Entity] => {
      const upper = part(this.body, n + 'Upper', 'cylinder', skin, { scale: { x: 0.13, y: L1, z: 0.13 } })
      part(upper, 'bicep', 'sphere', skin, { pos: { x: 0, y: 0.05, z: -0.35 }, scale: { x: 0.85, y: 0.28, z: 0.9 }, outline: false }) // bulge on the inside of the upper arm (local frame of the segment)
      const fore = part(this.body, n + 'Fore', 'cylinder', skin, { scale: { x: 0.1, y: L2, z: 0.1 } })
      const g = part(this.body, n + 'Glove', 'sphere', glove, { scale: { x: 0.22, y: 0.2, z: 0.24 } })
      part(g, 'cuff', 'cylinder', flatMat(0xfff1cf), { pos: { x: 0, y: 0.05, z: 0.45 }, euler: { x: 90, y: 0, z: 0 }, scale: { x: 0.9, y: 0.35, z: 0.85 }, outline: false }) // wrist cuff at the back of the glove
      part(g, 'laces', 'box', dark, { pos: { x: n === 'armL' ? 0.5 : -0.5, y: 0.1, z: 0.05 }, scale: { x: 0.06, y: 0.45, z: 0.5 }, outline: false }) // lace strip on the inside face
      const elbow = part(this.body, n + 'Elbow', 'sphere', skin, { scale: { x: 0.13, y: 0.13, z: 0.13 }, outline: false })
      return [upper, fore, g, elbow]
    }
    ;[this.upperL, this.foreL, this.gloveL, this.elbowL] = mk('armL')
    ;[this.upperR, this.foreR, this.gloveR, this.elbowR] = mk('armR')
    setDefaultBatch(-1)
    this.sGL.set(v3(-0.2, 1.36, -0.3)); this.sGR.set(v3(0.22, 1.33, -0.28))
  }

  private arm(upper: Entity, fore: Entity, glove: Entity, elbow: Entity, S: V3, T: V3, hint: V3): void {
    const ik = twoBoneIK(S, T, L1, L2, hint)
    orientSegment(upper, S, ik.elbow, 0.06)
    orientSegment(fore, ik.elbow, ik.target, 0.05)
    elbow.setLocalPosition(ik.elbow.x, ik.elbow.y, ik.elbow.z)
    glove.setLocalPosition(ik.target.x, ik.target.y, ik.target.z)
  }

  /** Place the root in the world and drive the pose with springs. `moving` (m/s) drives the walk cycle; `squash` < 1 crouches, > 1 stretches. */
  apply(pose: OpponentPose, worldPos: { x: number; z: number }, yawDeg: number, dt: number, moving = 0, squash = 1, t = 0): void {
    const p = this.sPos.to(v3(pose.x, pose.y, pose.z), dt)
    // breathing + squash-and-stretch on the whole body about the feet
    const sq = this.sSquash.to(squash, dt) * (1 + Math.sin(t * 2.1) * 0.012)
    this.body.setLocalScale(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq))
    // walk cycle: legs swing with distance covered, torso bobs
    this.walk += moving * dt * 2.6
    const swing = moving > 0.05 ? Math.sin(this.walk * Math.PI) * 26 : 0
    this.legL?.setLocalEulerAngles(swing, 0, 0); this.legR?.setLocalEulerAngles(-swing, 0, 0)
    this.root.setPosition(worldPos.x, 0, worldPos.z)
    this.root.setEulerAngles(0, yawDeg, 0)
    // translate the lean pivot (root frame, so a knockdown drops the hips to the canvas); the body hangs below it at a fixed offset
    this.lean.setLocalPosition(p.x, 0.95 + p.y, p.z)
    this.lean.setLocalEulerAngles(this.sPitch.to(pose.pitch, dt), this.sTwist.to(pose.twist, dt), this.sRoll.to(pose.roll, dt))
    this.head.setLocalEulerAngles(this.sHead.to(pose.headPitch, dt), 0, 0)
    const gl = this.sGL.to(pose.gloveL, dt), gr = this.sGR.to(pose.gloveR, dt)
    this.arm(this.upperL, this.foreL, this.gloveL, this.elbowL, SH_L, gl, v3(-1, -0.7, 0.2))
    this.arm(this.upperR, this.foreR, this.gloveR, this.elbowR, SH_R, gr, v3(1, -0.7, 0.2))
  }
}
