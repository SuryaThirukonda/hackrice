import { Entity } from 'playcanvas'
import { P } from '../../../theme'
import { flatMat, shade } from '../../../engine3d/materials'
import { facetedSphere, orientSegment, part, pivot, twoBoneIK } from '../../../engine3d/primitives'
import { Spring, Spring3, type V3, v3 } from '../../../engine3d/springs'
import { ARM_L1, ARM_L2, ARM_SH_L, ARM_SH_R, type OpponentPose } from './poses'

export type BoxerModel = 'beginner' | 'intermediate' | 'pro' | 'boss' | 'alien' | 'lizard' | 'robot'

const SKIN = 0xf3b98c, SKIN_HI = 0xffd2a6, SKIN_LO = 0xc8845c, INK = 0x141414

/**
 * Procedural boxer driven by an OpponentPose. Root faces -Z at the opponent, feet at y = 0.
 *
 * Skeleton (do not change: poses.ts drives it):
 *   root -> lean (y +0.95, takes pitch/twist/roll and the knockdown fall) -> body (y -0.95, takes x/y/z and squash)
 * Everything below hangs off `body`, the two hip pivots, `head`, or an IK-driven arm segment.
 * Arm and glove detail must be a CHILD of the segment/glove entity: orientSegment rewrites a segment's
 * position, rotation and scale every frame, and leaves roll about the bone uncontrolled, so children of a
 * segment must be rotationally symmetric (spheres and cylinders, never boxes).
 */
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
  private sFall = new Spring3(70) // matches sPitch so the drop and the rotation converge together
  private legL: Entity | null = null; private legR: Entity | null = null
  private walk = 0

  constructor(parent: Entity, color = P.red, trunks = P.blue, device?: import('playcanvas').GraphicsDevice, model: BoxerModel = 'beginner') {
    this.root = pivot(parent, 'opponent')
    this.lean = pivot(this.root, 'lean', v3(0, 0.95, 0))
    this.body = pivot(this.lean, 'body', v3(0, -0.95, 0))
    // One shared material set. flatMat() allocates a new StandardMaterial per call and the cache was removed,
    // so every repeated call would fragment batching; materials are created once and reused by every part.
    const alien = model === 'alien', lizard = model === 'lizard', robot = model === 'robot'
    const skin = alien ? 0x80cbb1 : lizard ? 0x9272d6 : robot ? 0x839ba9 : model === 'pro' ? 0xb9794d : SKIN
    const M = {
      skin: flatMat(skin), skinHi: flatMat(alien || lizard || robot ? shade(skin, 1.15) : model === 'pro' ? 0xc68b5a : SKIN_HI), skinLo: flatMat(alien || lizard || robot ? shade(skin, 0.7) : SKIN_LO),
      glove: flatMat(color), gloveLo: flatMat(shade(color, 0.75)),
      trunk: flatMat(model === 'pro' || model === 'boss' ? 0x25252a : trunks),
      white: flatMat(0xe5e6e8), dark: flatMat(INK), hood: flatMat(0x3e3d45), beard: flatMat(0x974921),
    }

    // Model parts use flat faces and a compact palette; animation pivots stay unchanged.
    const shape = (parent: Entity, name: string, mat: import('playcanvas').StandardMaterial,
      pos: number[], scale: number[], rounded = false, roll = 0): Entity => {
      const options = { pos: v3(...pos as [number, number, number]), scale: v3(...scale as [number, number, number]), euler: v3(0, 0, roll), outline: false }
      return rounded && device ? facetedSphere(device, parent, name, mat, { ...options, bands: 4 }) : part(parent, name, 'box', mat, options)
    }
    const boss = model === 'boss', pro = model === 'pro', mid = model === 'intermediate'
    const width = boss ? 0.76 : robot ? 0.62 : alien ? 0.40 : pro ? 0.56 : mid ? 0.50 : 0.44
    const cloth = boss ? M.hood : M.skin
    for (const side of [-1, 1]) {
      const hip = pivot(this.body, side < 0 ? 'leftHip' : 'rightHip', v3(side * (boss ? 0.19 : 0.14), 0.95, 0))
      shape(hip, 'thigh', M.skin, [0,-0.29,0], [boss ? 0.25 : 0.19,0.35,0.22], true)
      shape(hip, 'shin', M.skin, [0,-0.59,0.015], [0.16,0.32,0.17], true)
      shape(hip, 'shortLeg', M.trunk, [0,-0.15,0], [boss ? 0.32 : 0.25,0.31,0.30], false, side * 7)
      shape(hip, 'shortStripe', M.white, [side * (boss ? 0.158 : 0.123),-0.15,-0.005], [0.025,0.30,0.305], false, side * 7)
      shape(hip, 'bootShaft', mid ? M.glove : M.white, [0,-0.77,0.005], [0.18,0.20,0.19])
      shape(hip, 'bootToe', mid ? M.glove : M.white, [0,-0.855,-0.065], [0.20,0.105,0.32])
      shape(hip, 'sole', M.dark, [0,-0.909,-0.065], [0.21,0.025,0.33])
      shape(hip, 'sock', M.white, [0,-0.68,0.005], [0.185,0.055,0.195])
      if (mid || pro) for (const y of [-0.75,-0.79,-0.83]) shape(hip, 'lace', mid ? M.white : M.dark, [0,y,-0.098], [0.105,0.015,0.012])
      if (side < 0) this.legL = hip; else this.legR = hip
    }
    shape(this.body, 'shortsWaist', M.trunk, [0,0.99,0], [width * 0.83,0.20,0.30])
    shape(this.body, 'waistband', M.white, [0,1.09,0], [width * 0.86,0.075,0.31])
    this.torso = shape(this.body, boss ? 'hoodieTorso' : 'torso', cloth, [0,1.335,0], [width,0.46,boss ? 0.48 : 0.30])
    shape(this.body, 'waist', cloth, [0,1.19,0], [width * 0.78,0.24,boss ? 0.42 : 0.25])
    if (boss) {
      shape(this.body, 'hoodieHem', M.hood, [0,1.105,0], [0.66,0.075,0.43])
      shape(this.body, 'kangarooPocket', M.hood, [0,1.23,-0.229], [0.37,0.13,0.035])
      for (const side of [-1,1]) shape(this.body, 'drawstring', M.white, [side * 0.10,1.48,-0.235], [0.018,0.18,0.018], false, -side * 8)
    } else if (mid || pro) {
      for (const side of [-1,1]) shape(this.body, 'pectoral', M.skinHi, [side * width * 0.22,1.43,-0.115], [width * 0.45,0.18,0.12], true)
      if (pro) for (const y of [1.20,1.27]) for (const side of [-1,1]) shape(this.body, 'abdominal', M.skinHi, [side * 0.065,y,-0.122], [0.12,0.06,0.025], true)
    }
    shape(this.body, 'neck', M.skin, [0,1.57,0], [0.15,0.14,0.15])
    for (const side of [-1,1]) shape(this.body, 'shoulder', cloth, [side * 0.29,1.46,0], [boss ? 0.30 : 0.20,0.22,0.23], true)
    this.head = pivot(this.body, 'headPivot', v3(0,1.62,0))
    if (boss) {
      shape(this.head, 'hoodBack', M.hood, [0,0.17,0.095], [0.43,0.43,0.30], true)
      for (const side of [-1,1]) shape(this.head, 'hoodSide', M.hood, [side * 0.185,0.13,-0.02], [0.10,0.38,0.30], false, -side * 16)
      shape(this.head, 'hoodTop', M.hood, [0,0.335,0], [0.39,0.09,0.34])
    }
    if (!alien && !lizard && !robot) {
    shape(this.head, 'face', M.skin, [0,0.14,-0.015], [0.28,0.30,0.27])
    shape(this.head, 'jaw', M.skin, [0,0.025,-0.025], [0.24,0.10,0.24], true)
    shape(this.head, 'hair', boss ? M.beard : M.dark, [0,0.29,0], [0.30,0.095,0.29], mid)
    if (mid) shape(this.head, 'hairQuiff', M.dark, [0,0.30,-0.10], [0.23,0.10,0.13], true, -10)
    for (const side of [-1,1]) {
      shape(this.head, 'ear', M.skin, [side * 0.15,0.13,0], [0.045,0.08,0.065])
      shape(this.head, 'eye', M.dark, [side * 0.065,0.15,-0.156], [0.031,0.043,0.012])
      shape(this.head, 'eyebrow', M.dark, [side * 0.066,0.195,-0.16], [0.085,0.024,0.015], false, -side * 9)
    }
    shape(this.head, 'nose', M.skinHi, [0,0.11,-0.165], [0.045,0.065,0.045])
    shape(this.head, 'mouth', M.skinLo, [0,0.055,-0.156], [0.08,0.012,0.012])
    if (boss) {
      shape(this.head, 'gingerBeard', M.beard, [0,-0.005,-0.08], [0.31,0.18,0.25], true)
      for (const side of [-1,1]) shape(this.head, 'sideburn', M.beard, [side * 0.12,0.06,-0.13], [0.06,0.16,0.08], true)
    }
    }
    if (alien) {
      shape(this.head,'alienCranium',M.skin,[0,0.17,0],[0.39,0.40,0.30],true)
      shape(this.head,'alienJaw',M.skin,[0,0.015,-0.04],[0.19,0.14,0.19],true)
      for (const side of [-1,1]) {
        shape(this.head,'alienEye',M.dark,[side * 0.095,0.15,-0.132],[0.10,0.13,0.055],true,-side * 25)
        shape(this.head,'antenna',M.skin,[side * 0.12,0.39,0],[0.025,0.19,0.025],false,-side * 20)
        shape(this.head,'antennaTip',M.glove,[side * 0.15,0.49,0],[0.065,0.065,0.065],true)
      }
      shape(this.head,'alienMouth',M.dark,[0,0.025,-0.137],[0.05,0.012,0.01])
    }
    if (lizard) {
      shape(this.head,'reptileSkull',M.skin,[0,0.14,0],[0.31,0.30,0.27],true)
      shape(this.head,'snout',M.skinHi,[0,0.055,-0.17],[0.27,0.13,0.22],true)
      for (const side of [-1,1]) {
        shape(this.head,'reptileEye',M.white,[side * 0.12,0.18,-0.095],[0.07,0.07,0.09],true)
        shape(this.head,'slitPupil',M.dark,[side * 0.12,0.18,-0.141],[0.016,0.05,0.012])
        shape(this.head,'nostril',M.dark,[side * 0.065,0.075,-0.272],[0.025,0.018,0.01])
      }
      for (const y of [0.23,0.30,0.37]) shape(this.head,'crest',M.glove,[0,y,0.035],[0.065,0.13,0.17],true)
      for (const y of [1.18,1.29,1.40]) shape(this.body,'bellyPlate',M.skinHi,[0,y,-0.155],[0.26,0.075,0.025])
    }
    if (robot) {
      shape(this.head,'steelHelmet',M.skin,[0,0.15,0],[0.34,0.31,0.29])
      shape(this.head,'visor',M.dark,[0,0.18,-0.15],[0.29,0.09,0.025])
      for (const side of [-1,1]) shape(this.head,'optic',M.glove,[side * 0.075,0.18,-0.168],[0.075,0.035,0.018])
      for (const x of [-0.06,0,0.06]) shape(this.head,'grille',M.dark,[x,0.065,-0.15],[0.025,0.05,0.02])
      shape(this.body,'chestPanel',M.dark,[0,1.36,-0.16],[0.23,0.18,0.025])
      shape(this.body,'powerCore',M.glove,[0,1.36,-0.185],[0.09,0.09,0.025],true)
      for (const side of [-1,1]) shape(this.body,'shoulderPlate',M.skinHi,[side * 0.29,1.49,0],[0.24,0.16,0.26])
    }
    const mk = (n: string): [Entity, Entity, Entity, Entity] => {
      const up = shape(this.body,n+'Upper',cloth,[0,0,0],[0.12,ARM_L1,0.12],true)
      shape(up,n+'Sleeve',cloth,[0,0,0],[boss ? 2.1 : pro ? 1.65 : 1.4,1,boss ? 2.1 : pro ? 1.65 : 1.4],true)
      const fo = shape(this.body,n+'Fore',M.skin,[0,0,0],[0.1,ARM_L2,0.1],true)
      shape(fo,n+'Forearm',boss ? M.hood : M.skin,[0,0,0],[boss ? 2.0 : 1.4,1,boss ? 2.0 : 1.4],true)
      const gl = shape(this.body,n+'Glove',M.glove,[0,0,0],[0.25,0.25,0.28],true)
      shape(gl,n+'Cuff',M.white,[0,-0.03,0.47],[0.75,0.73,0.30])
      shape(gl,n+'Thumb',M.gloveLo,[n === 'armL' ? 0.38 : -0.38,-0.15,0],[0.35,0.47,0.44],true)
      const el = shape(this.body,n+'Elbow',cloth,[0,0,0],[boss ? 0.22 : 0.15,boss ? 0.22 : 0.15,boss ? 0.22 : 0.15],true)
      return [up,fo,gl,el]
    }
    ;[this.upperL,this.foreL,this.gloveL,this.elbowL] = mk('armL')
    ;[this.upperR,this.foreR,this.gloveR,this.elbowR] = mk('armR')
    this.sGL.set(v3(-0.2, 1.36, -0.3)); this.sGR.set(v3(0.22, 1.33, -0.28))
  }

  private arm(upper: Entity, fore: Entity, glove: Entity, elbow: Entity, S: V3, T: V3, hint: V3): void {
    const ik = twoBoneIK(S, T, ARM_L1, ARM_L2, hint)
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
    // The knockdown fall rides on `lean`, whose parent is the root, so -Y is always the canvas. Applying it to
    // `body` put it inside the already-pitched frame, where "down" pointed sideways once the fighter went
    // horizontal: that is what left him flat but floating at chest height.
    const fall = this.sFall.to(v3(pose.fallX, pose.fallY, pose.fallZ), dt)
    this.lean.setLocalPosition(fall.x, 0.95 + fall.y, fall.z)
    this.lean.setLocalEulerAngles(this.sPitch.to(pose.pitch, dt), this.sTwist.to(pose.twist, dt), this.sRoll.to(pose.roll, dt))
    // body keeps its own channel, so idle bob, dodge, duck, hitstun and the punch lunge are untouched by the fall
    this.body.setLocalPosition(p.x, -0.95 + p.y, p.z)
    this.head.setLocalEulerAngles(this.sHead.to(pose.headPitch, dt), 0, 0)
    const gl = this.sGL.to(pose.gloveL, dt), gr = this.sGR.to(pose.gloveR, dt)
    this.arm(this.upperL, this.foreL, this.gloveL, this.elbowL, ARM_SH_L, gl, v3(-1, -0.7, 0.2))
    this.arm(this.upperR, this.foreR, this.gloveR, this.elbowR, ARM_SH_R, gr, v3(1, -0.7, 0.2))
  }
}
