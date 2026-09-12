import { BLEND_ADDITIVE, BLEND_NORMAL, CULLFACE_NONE, Color, Curve, EMITTERSHAPE_BOX, Entity, StandardMaterial, Vec3, type GraphicsDevice } from 'playcanvas'
import { P } from '../../../theme'
import { matteMat, shinyMat, toonMat, unlitMat } from '../../../engine3d/materials'
import { billboard, decal, orientSegment, part, pivot } from '../../../engine3d/primitives'
import { carpetTex, crowdTex, leatherTex, noiseTex, panelTex, scuffTex, stripeTex, bumpTex, weaveTex } from '../../../engine3d/textures'
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

  constructor(root: Entity, device: GraphicsDevice, batch: { stat: number }) {
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
    // billboard crowd in three rings with three poses and random tints
    const texes = [crowdTex(device, 0), crowdTex(device, 1), crowdTex(device, 2)]
    const tints = [0x6b5aa0, 0x8a6fc0, 0x5a7ab0, 0xa07a8a]
    const fanMats = texes.map((tex, k) => { const m = new StandardMaterial(); const c = new Color(((tints[k] >> 16) & 255) / 255, ((tints[k] >> 8) & 255) / 255, (tints[k] & 255) / 255); m.useLighting = false; m.diffuse = c; m.emissive = c; m.emissiveMap = tex; m.opacityMap = tex; m.opacityMapChannel = 'a'; m.blendType = BLEND_NORMAL; m.depthWrite = false; m.cull = CULLFACE_NONE; m.useTonemap = false; m.useFog = true; m.update(); return m })
    for (let ring = 0; ring < 2; ring++) {
      const n = 30 + ring * 12, rad = 7.2 + ring * 2.2, y = ring * 0.85
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.06, 0.06)
        const s = rng.range(1.6, 2.1)
        const e = billboard(root, 'fan', texes[i % 3], s * 0.7, s, tints[i % tints.length], false, fanMats[i % 3])
        e.setLocalPosition(Math.cos(a) * rad, y + s / 2 - 0.25, Math.sin(a) * rad)
        this.crowd.push({ e, phase: rng.range(0, 6.28), y: y + s / 2 - 0.25, s })
      }
    }
    // spotlights: plain lamp cones with a warm bulb (no glow pass)
    for (const [x, z] of LAMP_POS) {
      part(root, 'lamp', 'cone', matteMat(0x141414), { pos: { x, y: 5.2, z }, euler: { x: 180, y: 0, z: 0 }, scale: { x: 0.5, y: 0.5, z: 0.5 }, outline: false, shadows: false, batch: B })
      part(root, 'bulb', 'sphere', unlitMat(0xffe6a8), { pos: { x, y: 4.95, z }, scale: { x: 0.2, y: 0.2, z: 0.2 }, outline: false, shadows: false, batch: B })
    }
    // arena floor and back wall with carpet and panel textures
    part(root, 'arenaFloor', 'box', matteMat(0x3a2f5a, { diffuseMap: carpetTex(device, '#3a2f5a', '#31284e'), tiling: 30, toon: false }), { pos: { x: 0, y: -0.62, z: 0 }, scale: { x: 30, y: 0.04, z: 30 }, outline: false, shadows: false, batch: B })
    const wallMat = matteMat(0x4a3f7a, { diffuseMap: panelTex(device, '#4a3f7a', '#332a5a'), tiling: 10, toon: false })
    for (const [x, z, ry] of [[0, -13, 0], [0, 13, 0], [-13, 0, 90], [13, 0, 90]] as number[][]) part(root, 'wall', 'box', wallMat, { pos: { x, y: 3, z }, euler: { x: 0, y: ry, z: 0 }, scale: { x: 26, y: 7.2, z: 0.3 }, outline: false, shadows: false, batch: B })
    // ambient dust motes drifting in the light
    const dust = new Entity('dust')
    dust.addComponent('particlesystem', { numParticles: 40, lifetime: 6, rate: 0.15, rate2: 0.25, loop: true, autoPlay: true, localSpace: false, lighting: false, emitterShape: EMITTERSHAPE_BOX, emitterExtents: new Vec3(5, 3, 5), initialVelocity: 0.15, startAngle: 0, startAngle2: 360, depthWrite: false, blendType: BLEND_ADDITIVE, intensity: 0.5,
      scaleGraph: new Curve([0, 0.02, 1, 0.02]), alphaGraph: new Curve([0, 0, 0.3, 0.5, 1, 0]) })
    dust.setLocalPosition(0, 2.4, 0)
    root.addChild(dust)
    part(root, 'sky', 'sphere', unlitMat(0x1c1a48, true), { scale: { x: 60, y: 60, z: 60 }, outline: false, shadows: false })
    // lit band behind the seats so the crowd silhouettes read
    part(root, 'seatWall', 'cylinder', unlitMat(0x3d3570, true), { pos: { x: 0, y: 1.6, z: 0 }, scale: { x: 24, y: 3.2, z: 24 }, outline: false, shadows: false })
  }

  /** Crowd bob and camera facing, cone flicker. */
  update(t: number, dt: number, cam: { x: number; y: number; z: number }): void {
    this.hop = Math.max(0, this.hop - dt * 2.2)
    this.flicker = Math.max(0, this.flicker - dt * 3)
    for (const c of this.crowd) {
      const bob = Math.sin(t * 2.2 + c.phase) * 0.03 + Math.max(0, Math.sin(t * 14 + c.phase)) * this.hop * 0.3
      const p = c.e.getLocalPosition(); c.e.setLocalPosition(p.x, c.y + bob, p.z)
      c.e.lookAt(cam.x, c.y + bob, cam.z)
      c.e.rotateLocal(0, 180, 0)
    }
  }
  cheer(): void { this.hop = 1 }
  flash(): void { this.flicker = 1 }
  get gd(): GraphicsDevice { return this.device }
}
