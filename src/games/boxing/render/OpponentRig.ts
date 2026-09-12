import { Entity } from 'playcanvas'
import { P } from '../../../theme'
import { flatMat, shade } from '../../../engine3d/materials'
import { leatherTex, weaveTex } from '../../../engine3d/textures'
import { orientSegment, part, pivot, twoBoneIK } from '../../../engine3d/primitives'
import { Spring, Spring3, type V3, v3 } from '../../../engine3d/springs'
import { ARM_L1, ARM_L2, ARM_SH_L, ARM_SH_R, type OpponentPose } from './poses'

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

  constructor(parent: Entity, color = P.red, trunks = P.blue, device?: import('playcanvas').GraphicsDevice) {
    this.root = pivot(parent, 'opponent')
    const leather = device ? leatherTex(device, '#ffffff', 5) : undefined, weave = device ? weaveTex(device, '#ffffff', '#000000') : undefined
    this.lean = pivot(this.root, 'lean', v3(0, 0.95, 0))
    this.body = pivot(this.lean, 'body', v3(0, -0.95, 0))
    // One shared material set. flatMat() allocates a new StandardMaterial per call and the cache was removed,
    // so every repeated call would fragment batching; these nine are created once and reused by every part.
    const M = {
      skin: flatMat(SKIN, { gloss: 0.5, specular: 0.4 }),
      skinHi: flatMat(SKIN_HI, { gloss: 0.58, specular: 0.5 }),
      skinLo: flatMat(SKIN_LO, { gloss: 0.32, specular: 0.22 }),
      glove: flatMat(color, { gloss: 0.7, specular: 0.7, metalness: 0.1, diffuseMap: leather, tiling: 3 }),
      gloveLo: flatMat(shade(color, 0.62), { gloss: 0.55, specular: 0.5, diffuseMap: leather, tiling: 4 }),
      trunk: flatMat(trunks, { gloss: 0.4, diffuseMap: weave, tiling: 6 }),
      gold: flatMat(P.gold, { gloss: 0.7, specular: 0.6, metalness: 0.3 }),
      white: flatMat(0xffffff, { gloss: 0.6 }),
      dark: flatMat(INK, { gloss: 0.25 }),
    }

    // legs hang from hip pivots so they can swing in a walk cycle; hip sits at body y 0.95
    for (const s of [-1, 1]) {
      const hip = pivot(this.body, 'hip', v3(s * 0.13, 0.95, 0))
      part(hip, 'glute', 'sphere', M.skin, { pos: { x: 0, y: -0.14, z: 0.055 }, scale: { x: 0.2, y: 0.24, z: 0.2 } })
      part(hip, 'thigh', 'cylinder', M.skin, { pos: { x: 0, y: -0.23, z: 0 }, scale: { x: 0.16, y: 0.44, z: 0.16 } })
      part(hip, 'quad', 'sphere', M.skinHi, { pos: { x: 0, y: -0.24, z: -0.025 }, scale: { x: 0.185, y: 0.29, z: 0.175 }, outline: false })
      part(hip, 'knee', 'sphere', M.skin, { pos: { x: 0, y: -0.45, z: 0 }, scale: { x: 0.17, y: 0.17, z: 0.17 } })
      part(hip, 'shin', 'cylinder', M.skin, { pos: { x: 0, y: -0.67, z: 0.01 }, scale: { x: 0.14, y: 0.42, z: 0.14 } })
      part(hip, 'calf', 'sphere', M.skinHi, { pos: { x: 0, y: -0.63, z: 0.035 }, scale: { x: 0.19, y: 0.24, z: 0.175 }, outline: false })
      part(hip, 'ankleWrap', 'box', M.white, { pos: { x: 0, y: -0.77, z: 0.005 }, scale: { x: 0.17, y: 0.05, z: 0.175 }, outline: false })
      part(hip, 'boot', 'box', M.white, { pos: { x: 0, y: -0.83, z: -0.04 }, scale: { x: 0.16, y: 0.13, z: 0.3 } })
      part(hip, 'bootSole', 'box', M.dark, { pos: { x: 0, y: -0.9025, z: -0.04 }, scale: { x: 0.175, y: 0.035, z: 0.315 }, outline: false }) // 3 cm of clearance: the idle bob is +/-0.02 and the ink hull adds 0.03 below
      part(hip, 'bootTongue', 'box', M.dark, { pos: { x: 0, y: -0.76, z: -0.135 }, scale: { x: 0.07, y: 0.03, z: 0.1 }, outline: false })
      part(hip, 'bootLaces', 'box', M.white, { pos: { x: 0, y: -0.748, z: -0.135 }, scale: { x: 0.085, y: 0.018, z: 0.1 }, outline: false })
      if (s < 0) this.legL = hip; else this.legR = hip
    }

    // trunks: a flared leg opening under a narrower waist, so the shorts have a real taper instead of one slab
    part(this.body, 'trunks', 'box', M.trunk, { pos: { x: 0, y: 0.9, z: 0 }, scale: { x: 0.5, y: 0.16, z: 0.31 } })
    part(this.body, 'trunksWaist', 'box', M.trunk, { pos: { x: 0, y: 1.04, z: 0 }, scale: { x: 0.44, y: 0.19, z: 0.28 }, outline: false })
    part(this.body, 'belt', 'box', M.gold, { pos: { x: 0, y: 1.1, z: 0 }, scale: { x: 0.47, y: 0.075, z: 0.295 } })
    part(this.body, 'beltTrim', 'box', M.white, { pos: { x: 0, y: 1.1, z: -0.152 }, scale: { x: 0.4, y: 0.03, z: 0.02 }, outline: false })
    for (const s of [-1, 1]) part(this.body, 'stripe', 'box', M.white, { pos: { x: s * 0.252, y: 0.9, z: 0 }, scale: { x: 0.02, y: 0.15, z: 0.285 }, outline: false })

    // abdomen: a narrow column between the obliques, with segmentation cut into the front face
    part(this.body, 'abs', 'box', M.skin, { pos: { x: 0, y: 1.2, z: 0 }, scale: { x: 0.26, y: 0.17, z: 0.26 }, outline: false })
    for (const s of [-1, 1]) part(this.body, 'oblique', 'box', M.skin, { pos: { x: s * 0.155, y: 1.205, z: 0 }, scale: { x: 0.1, y: 0.16, z: 0.24 }, euler: { x: 0, y: 0, z: -s * 12 } })
    part(this.body, 'absLine', 'box', M.skinLo, { pos: { x: 0, y: 1.185, z: -0.132 }, scale: { x: 0.016, y: 0.12, z: 0.012 }, outline: false })
    for (const y of [1.15, 1.19, 1.23]) part(this.body, 'absRow', 'box', M.skinLo, { pos: { x: 0, y, z: -0.132 }, scale: { x: 0.19, y: 0.014, z: 0.012 }, outline: false })

    // ribcage tapering into the waist, with pectorals, lats and collarbones on top
    part(this.body, 'ribs', 'box', M.skin, { pos: { x: 0, y: 1.295, z: 0 }, scale: { x: 0.4, y: 0.1, z: 0.28 }, outline: false })
    this.torso = part(this.body, 'torso', 'box', M.skin, { pos: { x: 0, y: 1.38, z: 0 }, scale: { x: 0.5, y: 0.24, z: 0.3 } })
    for (const s of [-1, 1]) part(this.body, 'lat', 'box', M.skin, { pos: { x: s * 0.235, y: 1.335, z: 0.01 }, scale: { x: 0.09, y: 0.22, z: 0.26 }, euler: { x: 0, y: 0, z: -s * 10 } })
    for (const s of [-1, 1]) part(this.body, 'pec', 'sphere', M.skinHi, { pos: { x: s * 0.115, y: 1.418, z: -0.126 }, scale: { x: 0.215, y: 0.155, z: 0.135 }, outline: false })
    part(this.body, 'sternum', 'box', M.skinLo, { pos: { x: 0, y: 1.415, z: -0.148 }, scale: { x: 0.022, y: 0.135, z: 0.012 }, outline: false })
    for (const s of [-1, 1]) part(this.body, 'clav', 'cylinder', M.skinHi, { pos: { x: s * 0.105, y: 1.492, z: -0.138 }, scale: { x: 0.045, y: 0.21, z: 0.045 }, euler: { x: 0, y: 0, z: -s * 78 }, outline: false })

    // shoulders: a narrower yoke, with deltoids and traps carrying the width
    part(this.body, 'shoulders', 'box', M.skin, { pos: { x: 0, y: 1.465, z: 0.01 }, scale: { x: 0.6, y: 0.13, z: 0.26 } })
    for (const s of [-1, 1]) part(this.body, 'delt', 'sphere', M.skinHi, { pos: { x: s * 0.295, y: 1.445, z: 0 }, scale: { x: 0.21, y: 0.22, z: 0.21 } })
    for (const s of [-1, 1]) part(this.body, 'trap', 'box', M.skin, { pos: { x: s * 0.135, y: 1.515, z: 0.015 }, scale: { x: 0.22, y: 0.09, z: 0.22 }, euler: { x: 0, y: 0, z: -s * 14 } })
    part(this.body, 'neck', 'cylinder', M.skin, { pos: { x: 0, y: 1.57, z: 0 }, scale: { x: 0.15, y: 0.13, z: 0.14 } })

    // head: a boxer's face rather than a smooth ball
    this.head = pivot(this.body, 'headPivot', v3(0, 1.62, 0))
    part(this.head, 'head', 'sphere', M.skin, { pos: { x: 0, y: 0.15, z: 0 }, scale: { x: 0.32, y: 0.34, z: 0.32 } })
    part(this.head, 'jaw', 'box', M.skin, { pos: { x: 0, y: 0.055, z: -0.035 }, scale: { x: 0.26, y: 0.12, z: 0.26 } })
    part(this.head, 'chin', 'box', M.skin, { pos: { x: 0, y: 0.025, z: -0.183 }, scale: { x: 0.135, y: 0.075, z: 0.055 }, euler: { x: -8, y: 0, z: 0 } })
    part(this.head, 'hair', 'sphere', M.dark, { pos: { x: 0, y: 0.23, z: 0.04 }, scale: { x: 0.3, y: 0.22, z: 0.3 }, outline: false })
    part(this.head, 'brow', 'box', M.skin, { pos: { x: 0, y: 0.215, z: -0.135 }, scale: { x: 0.26, y: 0.045, z: 0.075 }, euler: { x: 12, y: 0, z: 0 }, outline: false })
    part(this.head, 'nose', 'box', M.skin, { pos: { x: 0, y: 0.168, z: -0.172 }, scale: { x: 0.062, y: 0.09, z: 0.07 }, euler: { x: 10, y: 0, z: 4 }, outline: false })
    for (const s of [-1, 1]) part(this.head, 'ear', 'sphere', M.skin, { pos: { x: s * 0.163, y: 0.145, z: 0.018 }, scale: { x: 0.05, y: 0.095, z: 0.075 }, outline: false })
    for (const s of [-1, 1]) part(this.head, 'eye', 'sphere', M.dark, { pos: { x: s * 0.07, y: 0.17, z: -0.15 }, scale: { x: 0.05, y: 0.05, z: 0.03 }, outline: false })
    part(this.head, 'mouthLine', 'box', M.dark, { pos: { x: 0, y: 0.103, z: -0.181 }, scale: { x: 0.15, y: 0.012, z: 0.04 }, outline: false })
    part(this.head, 'guardTeeth', 'box', M.white, { pos: { x: 0, y: 0.082, z: -0.176 }, scale: { x: 0.145, y: 0.034, z: 0.055 }, outline: false })

    // arms: the two segments are positioned by IK each frame; muscle detail rides on them in bone-local space,
    // where local Y is the bone axis and one unit equals the bone length.
    const mk = (n: string): [Entity, Entity, Entity, Entity] => {
      const up = part(this.body, n + 'Upper', 'cylinder', M.skin, { scale: { x: 0.12, y: ARM_L1, z: 0.12 } })
      part(up, n + 'Bicep', 'sphere', M.skinHi, { pos: { x: 0, y: -0.13, z: 0 }, scale: { x: 1.45, y: 0.6, z: 1.45 }, outline: false })
      part(up, n + 'Tricep', 'sphere', M.skin, { pos: { x: 0, y: 0.1, z: 0 }, scale: { x: 1.34, y: 0.42, z: 1.34 }, outline: false })
      const fo = part(this.body, n + 'Fore', 'cylinder', M.skin, { scale: { x: 0.1, y: ARM_L2, z: 0.1 } })
      part(fo, n + 'Flexor', 'sphere', M.skinHi, { pos: { x: 0, y: -0.17, z: 0 }, scale: { x: 1.62, y: 0.58, z: 1.62 }, outline: false })
      const gl = part(this.body, n + 'Glove', 'sphere', M.glove, { scale: { x: 0.22, y: 0.2, z: 0.24 } })
      // the IK only translates the glove, so glove-local axes are body axes: -Z is the punching face, +Z the wrist
      const s = n === 'armL' ? 1 : -1
      part(gl, n + 'Cuff', 'cylinder', M.gloveLo, { pos: { x: 0, y: -0.03, z: 0.46 }, euler: { x: 90, y: 0, z: 0 }, scale: { x: 0.8, y: 0.3, z: 0.85 }, outline: false })
      part(gl, n + 'Trim', 'cylinder', M.white, { pos: { x: 0, y: -0.03, z: 0.6 }, euler: { x: 90, y: 0, z: 0 }, scale: { x: 0.88, y: 0.1, z: 0.93 }, outline: false })
      part(gl, n + 'Seam', 'torus', M.white, { pos: { x: 0, y: 0.02, z: 0.1 }, euler: { x: 90, y: 0, z: 0 }, scale: { x: 1.03, y: 0.28, z: 1.03 }, outline: false })
      part(gl, n + 'Thumb', 'sphere', M.gloveLo, { pos: { x: s * 0.42, y: -0.1, z: -0.16 }, euler: { x: 0, y: 0, z: -s * 22 }, scale: { x: 0.34, y: 0.44, z: 0.36 }, outline: false })
      const el = part(this.body, n + 'Elbow', 'sphere', M.skin, { scale: { x: 0.13, y: 0.13, z: 0.13 } })
      return [up, fo, gl, el]
    }
    ;[this.upperL, this.foreL, this.gloveL, this.elbowL] = mk('armL')
    ;[this.upperR, this.foreR, this.gloveR, this.elbowR] = mk('armR')
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
