import { Environment } from '../../../engine3d/environment'
import { Entity } from 'playcanvas'
import { P } from '../../../theme'
import { flatMat, matteMat, shinyMat, toonMat, unlitMat } from '../../../engine3d/materials'
import { carpetTex, panelTex, woodTex } from '../../../engine3d/textures'
import type { GraphicsDevice } from 'playcanvas'
import { part, pivot } from '../../../engine3d/primitives'
import { Rng } from '../../boxing/sim/rng'
import { BALL_R, BALL_START_Z, DECK_END_Z, GUTTER_W, LANE_HALF, LANE_LEN, OIL_Z, PIN_SPOTS } from '../sim/constants'
import { previewPath } from '../sim/preview'
import type { AimState } from '../keymap'
import type { Snapshot, V2 } from '../sim/types'

/** Sim → world: the sim runs down +z, PlayCanvas cameras look down -z, so the lane is laid along -z (x stays screen-right). */
export const WZ = (z: number): number => -z
const RAD = 180 / Math.PI
const PIN_H = 0.38
const FALL_DEG = 85
const APPROACH_LEN = 4.6
const HALL_HALF = 4.6
const LANE_PITCH = LANE_HALF * 2 + GUTTER_W * 2 + 0.34 // centre-to-centre of neighbouring lanes

interface PinRig { root: Entity; tilt: Entity; lastX: number; lastZ: number; fallYaw: number | null; seedYaw: number }

/** Procedural alley: lane, gutters, approach, pin deck, walls, ball return, crowd, ten pins, the ball and the aim guide. */
export class LaneScene {
  pins: Entity[] = []
  ball: Entity
  aimGuide: Entity
  private dots: Entity[] = []
  private dotGold = unlitMat(P.gold)
  private dotGreen = unlitMat(P.green)
  private rigs: PinRig[] = []
  private crowd: { e: Entity; phase: number; y: number }[] = []
  private hop = 0
  private spin = 0
  private flicker = 0
  private lastBallZ = BALL_START_Z

  constructor(root: Entity, device?: GraphicsDevice) {
    const grain = device ? woodTex(device, '#e9c98a', '#b8925a', '#c9a465', 512, 21) : undefined
    const wood = matteMat(0xe9c98a, { gloss: 0.55, specular: 0.5, diffuseMap: grain, tiling: 12 }), oil = matteMat(0xd6b06e, { gloss: 0.9, specular: 0.9, metalness: 0.2 }), gutter = matteMat(0x5a4632), deck = matteMat(0xc9a86a, { gloss: 0.5, specular: 0.4 })
    // lane, oil stripe, pin deck (one continuous board to the pit)
    part(root, 'lane', 'box', wood, { pos: { x: 0, y: -0.05, z: WZ(LANE_LEN / 2) }, scale: { x: LANE_HALF * 2, y: 0.1, z: LANE_LEN }, outlineK: 0.02 })
    part(root, 'oil', 'box', oil, { pos: { x: 0, y: -0.003, z: WZ(OIL_Z / 2) }, scale: { x: LANE_HALF * 2 - 0.04, y: 0.004, z: OIL_Z }, outline: false })
    part(root, 'deck', 'box', deck, { pos: { x: 0, y: -0.05, z: WZ((LANE_LEN + DECK_END_Z) / 2) }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2, y: 0.1, z: DECK_END_Z - LANE_LEN }, outlineK: 0.02 })
    // arrows on the lane (the classic seven)
    const arrowM = unlitMat(0x3a2a1a)
    for (let i = 0; i < 7; i++) { const x = (i - 3) * 0.15; part(root, 'arrow', 'cone', arrowM, { pos: { x, y: 0.006, z: WZ(4.6 - Math.abs(i - 3) * 0.3) }, euler: { x: -90, y: 0, z: 0 }, scale: { x: 0.06, y: 0.16, z: 0.01 }, outline: false }) }
    // gutters: thin darker channels each side, running to the pit
    for (const sx of [-1, 1]) part(root, 'gutter', 'box', gutter, { pos: { x: sx * (LANE_HALF + GUTTER_W / 2), y: -0.07, z: WZ(DECK_END_Z / 2) }, scale: { x: GUTTER_W, y: 0.08, z: DECK_END_Z }, outlineK: 0.02 })
    // approach and foul line
    part(root, 'approach', 'box', flatMat(0xd8bc8f), { pos: { x: 0, y: -0.05, z: WZ(-APPROACH_LEN / 2) }, scale: { x: HALL_HALF * 2, y: 0.1, z: APPROACH_LEN }, outlineK: 0.02 })
    part(root, 'foul', 'box', unlitMat(P.red), { pos: { x: 0, y: 0.004, z: 0 }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2, y: 0.006, z: 0.04 }, outline: false })
    // hall floor beyond the lane and the pit
    part(root, 'carpet', 'box', matteMat(0xffffff, { diffuseMap: device ? carpetTex(device, '#728d91', '#638084') : undefined, tiling: 24, toon: false }), { pos: { x: 0, y: -0.12, z: WZ(6) }, scale: { x: HALL_HALF * 2 + 0.2, y: 0.1, z: DECK_END_Z + APPROACH_LEN + 6 }, outline: false })
    part(root, 'pit', 'box', unlitMat(0x0d0a18), { pos: { x: 0, y: 0.3, z: WZ(DECK_END_Z + 0.35) }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2, y: 0.7, z: 0.7 }, outline: false })
    // back wall with a comic masking unit and side walls
    part(root, 'back', 'box', matteMat(0xffffff, { diffuseMap: device ? panelTex(device, '#baa285', '#a68e74') : undefined, tiling: 8, toon: false }), { pos: { x: 0, y: 1.6, z: WZ(DECK_END_Z + 0.8) }, scale: { x: HALL_HALF * 2 + 0.4, y: 3.4, z: 0.2 }, outlineK: 0.04 })
    part(root, 'mask', 'box', flatMat(P.blue), { pos: { x: 0, y: 1.25, z: WZ(DECK_END_Z + 0.6) }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2 + 0.3, y: 1.2, z: 0.16 }, outlineK: 0.04 })
    part(root, 'maskStripe', 'box', unlitMat(P.gold), { pos: { x: 0, y: 1.25, z: WZ(DECK_END_Z + 0.5) }, scale: { x: LANE_HALF * 2, y: 0.22, z: 0.02 }, outline: false })
    for (const sx of [-1, 1]) {
      part(root, 'wall', 'box', matteMat(0xffffff, { diffuseMap: device ? panelTex(device, '#e6e0d0', '#d4c8b4') : undefined, tiling: 8, toon: false }), { pos: { x: sx * (HALL_HALF + 0.2), y: 1.6, z: WZ(7.5) }, scale: { x: 0.2, y: 3.4, z: DECK_END_Z + APPROACH_LEN + 3 }, outlineK: 0.04 })
      part(root, 'rail', 'box', flatMat(P.gold), { pos: { x: sx * (HALL_HALF - 0.05), y: 0.5, z: WZ(7.5) }, scale: { x: 0.06, y: 0.06, z: DECK_END_Z + APPROACH_LEN + 2 }, outline: false })
    }
    // ball return beside the approach
    const ret = pivot(root, 'return', { x: -1.15, y: 0, z: WZ(-2.2) })
    part(ret, 'returnBody', 'box', flatMat(P.cyan), { pos: { x: 0, y: 0.28, z: 0 }, scale: { x: 0.4, y: 0.56, z: 1.7 }, outlineK: 0.03 })
    part(ret, 'returnHood', 'box', flatMat(P.blue), { pos: { x: 0, y: 0.62, z: -0.6 }, scale: { x: 0.44, y: 0.16, z: 0.5 }, outlineK: 0.03 })
    for (let i = 0; i < 3; i++) part(ret, 'spareBall', 'sphere', shinyMat([P.red, P.gold, P.green][i]), { pos: { x: 0, y: 0.66, z: 0.35 - i * 0.24 }, scale: { x: 0.2, y: 0.2, z: 0.2 } })
    // seeded crowd silhouettes along both rails
    const rng = new Rng(4321)
    const dark = matteMat(0x718a96), dark2 = matteMat(0x9b826d)
    const skin = matteMat(0xc5a184), trousers = matteMat(0x526472)
    for (let i = 0; i < 28; i++) {
      const sx = i % 2 ? -1 : 1, z = rng.range(-4.2, 16), h = rng.range(1.5, 2.0)
      const mat = i % 4 < 2 ? dark : dark2
      const e = pivot(root, 'fan', { x: sx * (HALL_HALF - 0.55 + rng.range(-0.1, 0.1)), y: h / 2 - 0.2, z: WZ(z) })
      part(e, 'fanTorso', 'capsule', mat, { scale: { x: 0.42, y: h * 0.2, z: 0.3 }, outline: false, shadows: false })
      part(e, 'fanHead', 'sphere', skin, { pos: { x: 0, y: h * 0.3, z: 0 }, scale: { x: 0.28, y: 0.32, z: 0.28 }, outline: false, shadows: false })
      for (const side of [-1, 1]) {
        part(e, 'fanArm', 'capsule', mat, { pos: { x: side * 0.25, y: -0.02, z: 0 }, scale: { x: 0.12, y: h * 0.18, z: 0.12 }, outline: false, shadows: false })
        part(e, 'fanLeg', 'capsule', trousers, { pos: { x: side * 0.12, y: -h * 0.33, z: 0 }, scale: { x: 0.14, y: h * 0.19, z: 0.14 }, outline: false, shadows: false })
      }
      this.crowd.push({ e, phase: rng.range(0, 6.28), y: h / 2 - 0.2 })
    }
    // lamps and sky
    part(root, 'sky', 'sphere', unlitMat(0xd9ded9, true), { scale: { x: 70, y: 70, z: 70 }, outline: false, shadows: false, receive: false })

    // ---- extra alley detail ----
    // approach dots (two rows of seven) and the range finder dots at 12 ft
    const dotM = unlitMat(0x3a2a1a)
    for (const z of [-1.2, -2.4]) for (let i = -3; i <= 3; i++) part(root, 'dot', 'cylinder', dotM, { pos: { x: i * 0.15, y: 0.004, z: WZ(z) }, scale: { x: 0.04, y: 0.006, z: 0.04 }, outline: false })
    for (let i = -2; i <= 2; i++) part(root, 'rangeDot', 'cylinder', dotM, { pos: { x: i * 0.3, y: 0.004, z: WZ(2.2) }, scale: { x: 0.03, y: 0.006, z: 0.03 }, outline: false })
    // lane dividers (capping) on the outer edges of the gutters
    for (const sx of [-1, 1]) part(root, 'cap', 'box', flatMat(0x8a6a44), { pos: { x: sx * (LANE_HALF + GUTTER_W + 0.05), y: 0.02, z: WZ(DECK_END_Z / 2) }, scale: { x: 0.1, y: 0.09, z: DECK_END_Z }, outlineK: 0.02 })
    // neighbouring lanes on both sides with their own gutters, arrows, masks and racked pins
    const pinW = toonMat(0xfff6e5, { gloss: 0.75, specular: 0.7 }), pinR = toonMat(P.red, { gloss: 0.75 })
    for (const side of [-1, 1]) {
      const lx = side * LANE_PITCH
      part(root, 'nLane', 'box', wood, { pos: { x: lx, y: -0.05, z: WZ(LANE_LEN / 2) }, scale: { x: LANE_HALF * 2, y: 0.1, z: LANE_LEN }, outlineK: 0.02 })
      part(root, 'nOil', 'box', oil, { pos: { x: lx, y: -0.003, z: WZ(OIL_Z / 2) }, scale: { x: LANE_HALF * 2 - 0.04, y: 0.004, z: OIL_Z }, outline: false })
      part(root, 'nDeck', 'box', deck, { pos: { x: lx, y: -0.05, z: WZ((LANE_LEN + DECK_END_Z) / 2) }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2, y: 0.1, z: DECK_END_Z - LANE_LEN }, outlineK: 0.02 })
      for (const sx of [-1, 1]) part(root, 'nGutter', 'box', gutter, { pos: { x: lx + sx * (LANE_HALF + GUTTER_W / 2), y: -0.07, z: WZ(DECK_END_Z / 2) }, scale: { x: GUTTER_W, y: 0.08, z: DECK_END_Z }, outlineK: 0.02 })
      for (let i = 0; i < 7; i++) part(root, 'nArrow', 'cone', arrowM, { pos: { x: lx + (i - 3) * 0.15, y: 0.006, z: WZ(4.6 - Math.abs(i - 3) * 0.3) }, euler: { x: -90, y: 0, z: 0 }, scale: { x: 0.06, y: 0.16, z: 0.01 }, outline: false })
      part(root, 'nMask', 'box', flatMat(side < 0 ? P.red : P.green), { pos: { x: lx, y: 1.25, z: WZ(DECK_END_Z + 0.6) }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2 + 0.3, y: 1.2, z: 0.16 }, outlineK: 0.04 })
      part(root, 'nMaskStripe', 'box', unlitMat(P.gold), { pos: { x: lx, y: 1.25, z: WZ(DECK_END_Z + 0.5) }, scale: { x: LANE_HALF * 2, y: 0.22, z: 0.02 }, outline: false })
      part(root, 'nPit', 'box', unlitMat(0x0d0a18), { pos: { x: lx, y: 0.3, z: WZ(DECK_END_Z + 0.35) }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2, y: 0.7, z: 0.7 }, outline: false })
      for (const sp of PIN_SPOTS) {
        const pp = pivot(root, 'nPin', { x: lx + sp.x, y: 0, z: WZ(sp.z) })
        part(pp, 'b', 'cylinder', pinW, { pos: { x: 0, y: 0.15, z: 0 }, scale: { x: 0.12, y: 0.3, z: 0.12 }, outlineK: 0.02 })
        part(pp, 's', 'cylinder', pinR, { pos: { x: 0, y: 0.25, z: 0 }, scale: { x: 0.126, y: 0.035, z: 0.126 }, outline: false })
        part(pp, 'h', 'sphere', pinW, { pos: { x: 0, y: PIN_H - 0.05, z: 0 }, scale: { x: 0.1, y: 0.1, z: 0.1 }, outlineK: 0.02 })
      }
      part(root, 'nApproach', 'box', flatMat(0xd8bc8f), { pos: { x: lx, y: -0.05, z: WZ(-APPROACH_LEN / 2) }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2 + 0.6, y: 0.1, z: APPROACH_LEN }, outlineK: 0.02 })
      part(root, 'nFoul', 'box', unlitMat(P.red), { pos: { x: lx, y: 0.004, z: 0 }, scale: { x: LANE_HALF * 2 + GUTTER_W * 2, y: 0.006, z: 0.04 }, outline: false })
    }
    // seating and tables behind the approach, plus a ball rack
    for (const tx of [-2.6, 2.6]) {
      part(root, 'table', 'cylinder', flatMat(P.gold), { pos: { x: tx, y: 0.7, z: WZ(-5.6) }, scale: { x: 1.1, y: 0.06, z: 1.1 }, outlineK: 0.03 })
      part(root, 'tableLeg', 'cylinder', flatMat(0x141414), { pos: { x: tx, y: 0.35, z: WZ(-5.6) }, scale: { x: 0.08, y: 0.7, z: 0.08 }, outline: false })
      for (const [dx, dz] of [[-0.75, 0], [0.75, 0], [0, 0.75]]) {
        part(root, 'seat', 'cylinder', flatMat(P.red), { pos: { x: tx + dx, y: 0.45, z: WZ(-5.6 + dz) }, scale: { x: 0.42, y: 0.12, z: 0.42 }, outlineK: 0.03 })
        part(root, 'seatBack', 'box', flatMat(P.red), { pos: { x: tx + dx * 1.2, y: 0.75, z: WZ(-5.6 + dz * 1.2) }, scale: { x: 0.4, y: 0.5, z: 0.1 }, outlineK: 0.03 })
      }
    }
    const rack = pivot(root, 'rack', { x: 1.25, y: 0, z: WZ(-2.6) })
    part(rack, 'rackBody', 'box', flatMat(0x2a1c4a), { pos: { x: 0, y: 0.45, z: 0 }, scale: { x: 0.5, y: 0.9, z: 1.2 }, outlineK: 0.03 })
    for (let i = 0; i < 4; i++) part(rack, 'rackBall', 'sphere', shinyMat([P.blue, P.orange, P.green, P.cyan][i]), { pos: { x: 0, y: 0.5 + (i % 2) * 0.28, z: -0.3 + Math.floor(i / 2) * 0.6 }, scale: { x: 0.22, y: 0.22, z: 0.22 } })
    // carpet pattern squares beside the approaches
    const sq = unlitMat(0x2a1c4a)
    for (let i = 0; i < 8; i++) for (const sx of [-1, 1]) part(root, 'carpetSq', 'box', sq, { pos: { x: sx * (HALL_HALF - 0.9), y: -0.065, z: WZ(-4.2 + i * 0.9) }, scale: { x: 0.45, y: 0.02, z: 0.45 }, outline: false })
    // foul line lights
    for (const sx of [-1, 1]) part(root, 'foulLight', 'sphere', unlitMat(P.red), { pos: { x: sx * (LANE_HALF + GUTTER_W + 0.05), y: 0.12, z: 0 }, scale: { x: 0.1, y: 0.1, z: 0.1 }, outline: false })

    // Individual maple boards carry subtle color variation at a readable scale.
    const boards = [0xe1ba7e, 0xe9c58a, 0xdab47d].map(color => matteMat(color, { diffuseMap: grain, gloss: 0.68, specular: 0.4, tiling: 1 }))
    for (const x of [-LANE_PITCH, 0, LANE_PITCH]) for (let i = 0; i < 9; i++) {
      part(root, 'maple-board', 'box', boards[i % 3], { pos: { x: x + (i - 4) * LANE_HALF * 2 / 9, y: 0.001, z: WZ(LANE_LEN / 2) }, scale: { x: LANE_HALF * 2 / 9, y: 0.002, z: LANE_LEN }, outline: false, shadows: false })
    }
    // Repeating ceiling bays emphasize the main lane's vanishing point.
    const venue = new Environment(root, 'alley-architecture')
    venue.box('ceiling', 0xe1dfd5, { x: 0, y: 4.1, z: WZ(8) }, { x: HALL_HALF * 2, y: 0.16, z: 29 })
    for (let i = 0; i < 6; i++) {
      const z = WZ(i * 4 - 2)
      venue.box('ceiling-rib', 0xb1b3a9, { x: 0, y: 3.8, z }, { x: HALL_HALF * 2, y: 0.22, z: 0.22 })
      for (const x of [-LANE_PITCH, 0, LANE_PITCH]) {
        venue.box('light-housing', 0x101c30, { x, y: 3.66, z }, { x: 0.72, y: 0.1, z: 1.7 })
        venue.box('warm-light-panel', 0xffe3aa, { x, y: 3.6, z }, { x: 0.56, y: 0.025, z: 1.5 }, true)
      }
    }
    for (const x of [-LANE_PITCH, 0, LANE_PITCH]) {
      venue.screen(x, 2.8, WZ(DECK_END_Z + 0.45), 1.3, x === 0 ? 0xffd27c : 0x65b2c0)
      if (device) venue.label(device, `LANE 0${x < 0 ? 1 : x === 0 ? 2 : 3}`, { x, y: 2.8, z: WZ(DECK_END_Z + 0.32) }, 1.2, 0.4)
      venue.box('pin-deck-light', 0xffedc4, { x, y: 0.72, z: WZ(DECK_END_Z + 0.48) }, { x: 1.35, y: 0.06, z: 0.06 }, true)
    }
    for (const side of [-1, 1]) {
      venue.box('wall-inlay', 0xab7951, { x: side * (HALL_HALF + 0.08), y: 2.3, z: WZ(8) }, { x: 0.025, y: 0.09, z: 25 }, true)
      venue.box('banquette', 0x42576a, { x: side * 3.9, y: 0.3, z: 1.4 }, { x: 0.65, y: 0.6, z: 3.4 })
    }

    // pins: yaw pivot -> tilt pivot -> body, neck stripe, head
    const white = toonMat(0xfff6e5, { gloss: 0.75, specular: 0.7 }), red = toonMat(P.red, { gloss: 0.75 })
    PIN_SPOTS.forEach((s, i) => {
      const yaw = pivot(root, `pin${i}`, { x: s.x, y: 0, z: WZ(s.z) })
      const tilt = pivot(yaw, 'tilt')
      part(tilt, 'body', 'cylinder', white, { pos: { x: 0, y: 0.15, z: 0 }, scale: { x: 0.12, y: 0.3, z: 0.12 }, outlineK: 0.02 })
      part(tilt, 'stripe', 'cylinder', red, { pos: { x: 0, y: 0.25, z: 0 }, scale: { x: 0.126, y: 0.035, z: 0.126 }, outline: false })
      part(tilt, 'neck', 'cylinder', white, { pos: { x: 0, y: 0.3, z: 0 }, scale: { x: 0.08, y: 0.06, z: 0.08 }, outline: false })
      part(tilt, 'head', 'sphere', white, { pos: { x: 0, y: PIN_H - 0.05, z: 0 }, scale: { x: 0.1, y: 0.1, z: 0.1 }, outlineK: 0.02 })
      this.pins.push(yaw)
      this.rigs.push({ root: yaw, tilt, lastX: s.x, lastZ: s.z, fallYaw: null, seedYaw: rng.range(-40, 40) })
    })
    // ball with three finger holes
    this.ball = part(root, 'ball', 'sphere', shinyMat(P.magenta), { pos: { x: 0, y: BALL_R, z: WZ(BALL_START_Z) }, scale: { x: BALL_R * 2, y: BALL_R * 2, z: BALL_R * 2 }, outlineK: 0.02 })
    const hole = unlitMat(0x141414)
    for (const [hx, hy] of [[-0.12, 0.42], [0.12, 0.42], [0, 0.2]]) part(this.ball, 'hole', 'sphere', hole, { pos: { x: hx, y: hy, z: 0.36 }, scale: { x: 0.12, y: 0.12, z: 0.12 }, outline: false })
    // aim guide: a dotted predicted path (straight run, hook curve after the oil, or the gutter drop)
    this.aimGuide = pivot(root, 'aimGuide', { x: 0, y: 0.01, z: 0 })
    for (let i = 0; i < 64; i++) { const d = part(this.aimGuide, 'dot', 'cylinder', this.dotGold, { scale: { x: 0.07, y: 0.008, z: 0.07 }, outline: false }); d.enabled = false; this.dots.push(d) }
  }

  /** Put the ball at a sim position; while rolling it spins with the distance travelled. */
  setBall(x: number, z: number, rolling: boolean): void {
    if (rolling) this.spin -= ((z - this.lastBallZ) / BALL_R) * RAD
    this.lastBallZ = z
    this.ball.setLocalPosition(x, BALL_R, WZ(z))
    this.ball.setLocalEulerAngles(this.spin % 360, 0, 0)
  }

  /** Show the predicted path as dots; locked paths turn green. Hidden when path is null. */
  setAimPath(path: V2[] | null, locked: boolean): void {
    this.aimGuide.enabled = path !== null
    if (!path) return
    const mat = locked ? this.dotGreen : this.dotGold
    this.dots.forEach((d, i) => {
      const p = path[i]
      d.enabled = p !== undefined
      if (!p) return
      d.setLocalPosition(p.x, 0, WZ(p.z))
      const sc = locked ? 0.085 : 0.07
      d.setLocalScale(sc, 0.008, sc)
      if (d.render && d.render.material !== mat) d.render.material = mat
    })
  }
  /** Kept for callers that still pass an AimState: draws the path for that aim at medium power. */
  setAimGuide(aim: AimState | null): void { this.setAimPath(aim ? previewPath({ lanePos: aim.lanePos, angleDeg: aim.angleDeg, power: 0.75, hook: aim.hook }, 0) : null, false) }

  /** Lay out pins from a snapshot: standing pins upright, fallen pins tipped over along their travel, removed pins hidden. */
  setPins(v: Snapshot): void {
    const seen = new Set<number>()
    for (const p of v.pins) {
      seen.add(p.index)
      const r = this.rigs[p.index]
      if (!r) continue
      r.root.enabled = true
      r.root.setLocalPosition(p.x, 0, WZ(p.z))
      if (p.down) {
        if (r.fallYaw === null) {
          const dx = p.x - r.lastX, dz = p.z - r.lastZ
          // world yaw so that local +z (the tilt direction) points along the sim travel (dx, -dz in world)
          r.fallYaw = Math.hypot(dx, dz) > 1e-4 ? Math.atan2(dx, WZ(dz)) * RAD : 180 + r.seedYaw
        }
        r.root.setLocalEulerAngles(0, r.fallYaw, 0)
        r.tilt.setLocalEulerAngles(FALL_DEG, 0, 0)
      } else {
        r.fallYaw = null
        r.root.setLocalEulerAngles(0, 0, 0)
        r.tilt.setLocalEulerAngles(0, 0, 0)
      }
      r.lastX = p.x; r.lastZ = p.z
    }
    this.rigs.forEach((r, i) => { if (!seen.has(i)) { r.root.enabled = false; r.fallYaw = null } })
  }

  /** Crowd bob; hop after a strike; lamp flicker. */
  update(t: number, dt: number): void {
    this.hop = Math.max(0, this.hop - dt * 2.5)
    this.flicker = Math.max(0, this.flicker - dt * 2.5)
    for (const c of this.crowd) {
      const bob = Math.sin(t * 2.2 + c.phase) * 0.03 + Math.max(0, Math.sin(t * 14 + c.phase)) * this.hop * 0.25
      const p = c.e.getLocalPosition(); c.e.setLocalPosition(p.x, c.y + bob, p.z)
    }
  }
  cheer(): void { this.hop = 1 }
  flash(): void { this.flicker = 1 }
}
