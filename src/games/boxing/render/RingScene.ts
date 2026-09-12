import { Environment } from '../../../engine3d/environment'
import { BLEND_ADDITIVE, Curve, EMITTERSHAPE_BOX, Entity, Vec3, type GraphicsDevice } from 'playcanvas'
import { P } from '../../../theme'
import { matteMat, shinyMat, toonMat, unlitMat } from '../../../engine3d/materials'
import { decal, orientSegment, part, pivot } from '../../../engine3d/primitives'
import { carpetTex, leatherTex, noiseTex, panelTex, scuffTex, stripeTex, bumpTex, weaveTex } from '../../../engine3d/textures'
import { RING_HALF } from '../sim/constants'
import type { V3 } from '../../../engine3d/springs'
import { Rng } from '../sim/rng'

const LAMP_POS: [number, number][] = [[-2.2, -2.2], [2.2, 2.2], [-2.2, 2.2], [2.2, -2.2]]

/** Ring, ropes with sag, turnbuckles, apron band, decals, ringside props, spotlight cones, billboard crowd and sky. */
export class RingScene {
  crowd: { e: Entity; phase: number; y: number; s: number }[] = []
  private flicker = 0
  private hop = 0
  private device: GraphicsDevice

  constructor(root: Entity, device: GraphicsDevice, batch: { stat: number; crowd: number }) {
    this.device = device
    const B = batch.stat
    const R = RING_HALF + 0.35
    const rng = new Rng(1234)
    // canvas floor with grain + normal bump, centre logo, scuffs and tape
    const floor = matteMat(0xf1dfb8, { diffuseMap: weaveTex(device, '#f1dfb8', '#c9b48c'), tiling: 14, normalMap: bumpTex(device, 128, 1.2, 9), bumpiness: 0.35 })
    part(root, 'floor', 'box', floor, { pos: { x: 0, y: -0.05, z: 0 }, scale: { x: R * 2, y: 0.1, z: R * 2 }, outlineK: 0.04 })
    part(root, 'logo', 'torus', toonMat(P.red), { pos: { x: 0, y: 0.006, z: 0 }, scale: { x: 1.6, y: 0.02, z: 1.6 }, outline: false, shadows: false })
    part(root, 'logoDot', 'cylinder', toonMat(P.gold), { pos: { x: 0, y: 0.006, z: 0 }, scale: { x: 0.5, y: 0.012, z: 0.5 }, outline: false, shadows: false })
    const scuff = scuffTex(device)
    for (let i = 0; i < 6; i++) decal(root, 'scuff', scuff, { pos: { x: rng.range(-2.2, 2.2), y: 0.004, z: rng.range(-2.2, 2.2) }, w: 1.4, h: 1.4, euler: { x: 0, y: rng.range(0, 360), z: 0 }, opacity: 0.6 })
    const tape = stripeTex(device, ['#ffffff', '#ff3a3a'], 32, 45)
    for (const [x, z, ry] of [[-2.7, 0, 0], [2.7, 0, 0], [0, -2.7, 90], [0, 2.7, 90]] as [number, number, number][]) decal(root, 'tape', tape, { pos: { x, y: 0.003, z }, w: 0.08, h: 5.4, euler: { x: 0, y: ry, z: 0 }, opacity: 0.85 })
    // apron with a striped logo band
    const apron = matteMat(P.blue, { diffuseMap: noiseTex(device, '#2f6cf6', '#1f4fc0', 0.25, 64, 4), tiling: 5 })
    part(root, 'apron', 'box', apron, { pos: { x: 0, y: -0.35, z: 0 }, scale: { x: R * 2 + 0.3, y: 0.5, z: R * 2 + 0.3 }, outlineK: 0.05 })
    const band = matteMat(0xffffff, { diffuseMap: stripeTex(device, ['#ff3a3a', '#fff1cf', '#2f6cf6', '#fff1cf'], 64, 90), tiling: 8, toon: false })
    for (const [x, z, sx, sz] of [[0, R + 0.16, R * 2 + 0.3, 0.02], [0, -R - 0.16, R * 2 + 0.3, 0.02], [R + 0.16, 0, 0.02, R * 2 + 0.3], [-R - 0.16, 0, 0.02, R * 2 + 0.3]] as number[][]) part(root, 'band', 'box', band, { pos: { x, y: -0.35, z }, scale: { x: sx, y: 0.2, z: sz }, outline: false, shadows: false })
    // posts, caps and turnbuckle pads
    const postCols = [P.red, P.blue, P.red, P.blue]
    const leather = leatherTex(device, '#ffffff')
    const padMats = [toonMat(P.red, { diffuseMap: leather, tiling: 2 }), toonMat(P.blue, { diffuseMap: leather, tiling: 2 }), toonMat(P.red, { diffuseMap: leather, tiling: 2 }), toonMat(P.blue, { diffuseMap: leather, tiling: 2 })]
    const postMat = shinyMat(0xd8d8e0), capMat = shinyMat(P.gold)
    const corners = [[-R, -R], [R, -R], [R, R], [-R, R]]
    corners.forEach(([x, z], i) => {
      part(root, 'post', 'cylinder', postMat, { pos: { x, y: 0.7, z }, scale: { x: 0.12, y: 1.4, z: 0.12 }, batch: B })
      part(root, 'cap', 'sphere', capMat, { pos: { x, y: 1.42, z }, scale: { x: 0.2, y: 0.2, z: 0.2 }, batch: B })
      for (const y of [0.5, 0.85, 1.2]) part(root, 'pad', 'box', padMats[i], { pos: { x: x * 0.97, y, z: z * 0.97 }, scale: { x: 0.2, y: 0.2, z: 0.2 }, outlineK: 0.02, batch: B })
    })
    // ropes with sag: six segments per side dipping 4 cm in the middle, oriented endpoint to endpoint
    const ropeCols = [P.red, 0xfff1cf, P.blue]
    const sag = (u: number) => -0.045 * (1 - u * u) // u in -1..1 along a side
    ;[0.5, 0.85, 1.2].forEach((y, i) => {
      const m = toonMat(ropeCols[i], { gloss: 0.35 })
      const N = 6
      for (let k = 0; k < N; k++) {
        const u0 = -1 + (2 * k) / N, u1 = -1 + (2 * (k + 1)) / N
        const pts: [V3, V3][] = [
          [{ x: u0 * R, y: y + sag(u0), z: -R }, { x: u1 * R, y: y + sag(u1), z: -R }],
          [{ x: u0 * R, y: y + sag(u0), z: R }, { x: u1 * R, y: y + sag(u1), z: R }],
          [{ x: R, y: y + sag(u0), z: u0 * R }, { x: R, y: y + sag(u1), z: u1 * R }],
          [{ x: -R, y: y + sag(u0), z: u0 * R }, { x: -R, y: y + sag(u1), z: u1 * R }],
        ]
        for (const [a, b] of pts) { const e = part(root, 'rope', 'cylinder', m, { outline: false, shadows: false, batch: B }); orientSegment(e, a, b, 0.025) }
      }
    })
    // ringside: desk with monitors, stools, buckets, bottles, the bell
    const desk = pivot(root, 'desk', { x: 0, y: 0, z: R + 3.2 })
    part(desk, 'deskTop', 'box', matteMat(0x2a1c4a), { pos: { x: 0, y: 0.72, z: 0 }, scale: { x: 3.2, y: 0.08, z: 0.7 }, outlineK: 0.03 })
    part(desk, 'deskFront', 'box', matteMat(P.magenta), { pos: { x: 0, y: 0.36, z: -0.3 }, scale: { x: 3.2, y: 0.72, z: 0.08 }, outlineK: 0.03 })
    for (const dx of [-0.9, 0.9]) {
      part(desk, 'mon', 'box', matteMat(0x141414), { pos: { x: dx, y: 1.0, z: 0.1 }, scale: { x: 0.6, y: 0.4, z: 0.06 }, outlineK: 0.02 })
      part(desk, 'monScreen', 'box', unlitMat(0x1e8fb0), { pos: { x: dx, y: 1.0, z: 0.06 }, scale: { x: 0.52, y: 0.32, z: 0.02 }, outline: false, shadows: false })
    }
    for (let i = 0; i < 3; i++) part(desk, 'bottle', 'cylinder', toonMat(0x9fe8ff, { gloss: 0.8 }), { pos: { x: -1.3 + i * 0.16, y: 0.86, z: 0.15 }, scale: { x: 0.06, y: 0.2, z: 0.06 }, outlineK: 0.015 })
    part(root, 'bellPost', 'cylinder', shinyMat(0xd8d8e0), { pos: { x: -R - 0.9, y: 0.5, z: R + 0.6 }, scale: { x: 0.06, y: 1.0, z: 0.06 } })
    part(root, 'bell', 'cone', shinyMat(P.gold), { pos: { x: -R - 0.9, y: 1.1, z: R + 0.6 }, scale: { x: 0.34, y: 0.3, z: 0.34 } })
    corners.forEach(([x, z], i) => {
      const s = pivot(root, 'stool', { x: x * 1.25, y: 0, z: z * 1.25 })
      part(s, 'seat', 'cylinder', toonMat(postCols[i]), { pos: { x: 0, y: 0.5, z: 0 }, scale: { x: 0.36, y: 0.06, z: 0.36 }, outlineK: 0.02 })
      part(s, 'leg', 'cylinder', matteMat(0x141414), { pos: { x: 0, y: 0.25, z: 0 }, scale: { x: 0.05, y: 0.5, z: 0.05 }, outline: false })
      part(s, 'bucket', 'cylinder', toonMat(0xd8d8e0), { pos: { x: 0.4, y: 0.16, z: 0 }, scale: { x: 0.26, y: 0.32, z: 0.26 }, outlineK: 0.02 })
    })
    // Low-poly crowd blocks in rising tiers; seeded variation is presentation-only.
    const crowdStage = new Environment(root, 'crowd-blocks')
    for (const side of [-1, 1]) for (let row = 0; row < 4; row++) for (let i = 0; i < 20; i++) {
      const x = (i - 9.5) * 0.88, z = side * (7.2 + row * 1.15)
      const y = 0.45 + row * 0.55
      const fan = pivot(root, 'fan', { x, y, z })
      const color = [0x50637d, 0x7b627c, 0x426e79, 0x8a765f][(i + row) % 4]
      part(fan, 'fan-body', 'capsule', crowdStage.mat(color, true), { pos: { x: 0, y: 0, z: 0 }, scale: { x: 0.4, y: 0.28, z: 0.3 }, outline: false, shadows: false, batch: batch.crowd })
      part(fan, 'fan-head', 'sphere', crowdStage.mat(0xa38c82, true), { pos: { x: 0, y: 0.42, z: 0 }, scale: { x: 0.25, y: 0.28, z: 0.25 }, outline: false, shadows: false, batch: batch.crowd })
      for (const side of [-1, 1]) {
        part(fan, 'fan-arm', 'capsule', crowdStage.mat(color, true), { pos: { x: side * 0.23, y: -0.02, z: 0 }, scale: { x: 0.11, y: 0.2, z: 0.11 }, outline: false, shadows: false, batch: batch.crowd })
        part(fan, 'fan-leg', 'capsule', crowdStage.mat(0x536375, true), { pos: { x: side * 0.11, y: -0.34, z: 0.08 }, scale: { x: 0.12, y: 0.16, z: 0.12 }, outline: false, shadows: false, batch: batch.crowd })
      }
      this.crowd.push({ e: fan, phase: rng.range(0, 6.28), y, s: 1 })
    }
    // spotlights: plain lamp cones with a warm bulb (no glow pass)
    for (const [x, z] of LAMP_POS) {
      part(root, 'lamp', 'cone', matteMat(0x141414), { pos: { x, y: 5.2, z }, euler: { x: 180, y: 0, z: 0 }, scale: { x: 0.5, y: 0.5, z: 0.5 }, outline: false, shadows: false, batch: B })
      part(root, 'bulb', 'sphere', unlitMat(0xffe6a8), { pos: { x, y: 4.95, z }, scale: { x: 0.2, y: 0.2, z: 0.2 }, outline: false, shadows: false, batch: B })
    }
    // arena floor and back wall with carpet and panel textures
    part(root, 'arenaFloor', 'box', matteMat(0xffffff, { diffuseMap: carpetTex(device, '#89959e', '#7a8892'), tiling: 30, toon: false }), { pos: { x: 0, y: -0.62, z: 0 }, scale: { x: 30, y: 0.04, z: 30 }, outline: false, shadows: false, batch: B })
    const wallMat = matteMat(0xffffff, { diffuseMap: panelTex(device, '#e4e2d9', '#c8cec9'), tiling: 10, toon: false })
    for (const [x, z, ry] of [[0, -13, 0], [0, 13, 0], [-13, 0, 90], [13, 0, 90]] as number[][]) part(root, 'wall', 'box', wallMat, { pos: { x, y: 3, z }, euler: { x: 0, y: ry, z: 0 }, scale: { x: 26, y: 7.2, z: 0.3 }, outline: false, shadows: false, batch: B })
    // ambient dust motes drifting in the light
    const dust = new Entity('dust')
    dust.addComponent('particlesystem', { numParticles: 40, lifetime: 6, rate: 0.15, rate2: 0.25, loop: true, autoPlay: true, localSpace: false, lighting: false, emitterShape: EMITTERSHAPE_BOX, emitterExtents: new Vec3(5, 3, 5), initialVelocity: 0.15, startAngle: 0, startAngle2: 360, depthWrite: false, blendType: BLEND_ADDITIVE, intensity: 0.5,
      scaleGraph: new Curve([0, 0.02, 1, 0.02]), alphaGraph: new Curve([0, 0, 0.3, 0.5, 1, 0]) })
    dust.setLocalPosition(0, 2.4, 0)
    root.addChild(dust)
    part(root, 'sky', 'sphere', unlitMat(0xcbd5d7, true), { scale: { x: 60, y: 60, z: 60 }, outline: false, shadows: false })
    // Open grandstands: solid enclosing cylinders would hide the venue from ringside.
    const venue = new Environment(root, 'arena-architecture', B)
    for (const side of [-1, 1]) {
      for (let row = 0; row < 4; row++) {
        const z = side * (7.2 + row * 1.15), y = -0.4 + row * 0.55
        venue.box('terrace', 0x7b8992, { x: 0, y, z }, { x: 20, y: 0.5, z: 1.2 })
        for (let seat = 0; seat < 22; seat++) {
          const x = (seat - 10.5) * 0.84
          venue.box('seat-back', row % 2 ? 0x394969 : 0x30415e, { x, y: y + 0.65, z: z + side * 0.3 }, { x: 0.62, y: 0.55, z: 0.16 }, true)
        }
      }
      venue.box('arena-ribbon', 0xe7bd76, { x: 0, y: 3.5, z: side * 12.5 }, { x: 24, y: 0.14, z: 0.08 }, true)
      for (const x of [-10, -5, 5, 10]) venue.box('wall-pier', 0x87959b, { x, y: 3, z: side * 12.6 }, { x: 0.5, y: 7, z: 0.6 })
      venue.truss({ x: -4, y: 5.6, z: side * 4 }, { x: 4, y: 5.6, z: side * 4 })
      venue.truss({ x: side * 4, y: 5.6, z: -4 }, { x: side * 4, y: 5.6, z: 4 })
    }
    venue.screen(0, 4.4, -12.5, 5, 0xf0c879)
    venue.label(device, 'RINGSIDE / BOXING', { x: 0, y: 4.4, z: -12.37 }, 4.7, 1.65)
    // Daylit sports-hall windows and pane mullions above the side aisles.
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
      const z = (i - 2) * 4.5
      venue.box('window-frame', 0x7c8f99, { x: side * 12.78, y: 4.3, z }, { x: 0.12, y: 2.5, z: 3.6 })
      venue.box('window-glass', 0xd9edf3, { x: side * 12.7, y: 4.3, z }, { x: 0.025, y: 2.25, z: 3.35 }, true)
      venue.box('window-mullion', 0x8498a3, { x: side * 12.66, y: 4.3, z }, { x: 0.04, y: 2.3, z: 0.08 })
    }

    for (let i = 0; i < 3; i++) venue.box('ring-step', 0x52617b, { x: R + 0.5 + i * 0.25, y: -0.15 - i * 0.15, z: 1.5 }, { x: 0.5, y: 0.15, z: 1.2 })

  }

  /** Crowd bob and camera facing, cone flicker. */
  update(t: number, dt: number, cam: { x: number; y: number; z: number }): void {
    void cam
    this.hop = Math.max(0, this.hop - dt * 2.2)
    this.flicker = Math.max(0, this.flicker - dt * 3)
    for (const c of this.crowd) {
      const bob = Math.sin(t * 2.2 + c.phase) * 0.03 + Math.max(0, Math.sin(t * 14 + c.phase)) * this.hop * 0.3
      const p = c.e.getLocalPosition(); c.e.setLocalPosition(p.x, c.y + bob, p.z)

    }
  }
  cheer(): void { this.hop = 1 }
  flash(): void { this.flicker = 1 }
  get gd(): GraphicsDevice { return this.device }
}
