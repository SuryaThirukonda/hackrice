import { waterTextures } from '../../../engine3d/water'
import { pointInPolygon } from '../sim/holes'
import { landscapePeak } from '../../../engine3d/environment'
import { Texture, AppBase, CULLFACE_NONE, Entity, FOG_LINEAR, Mesh, MeshInstance, type GraphicsDevice, type StandardMaterial } from 'playcanvas'
import { col, flatMat, matteMat, unlitMat } from '../../../engine3d/materials'
import { grassTex, noiseTex } from '../../../engine3d/textures'
import { facetedSphere, part, pivot } from '../../../engine3d/primitives'
import { P } from '../../../theme'
import type { GolfSnapshot, Hole, Player, Theme, V2, V3 } from '../sim/types'
import { THEMES, buildProp, type ThemePalette } from './themes'

export const PREVIEW_N = 24
/** Sim radius is 0.05 m; drawn bigger so the ball reads from the tee. */
export const BALL_DRAW_R = 0.12
/** Stacked surface heights (m) so overlapping flat layers never z-fight at 500 m. */
const Y = { course: 0.02, fairway: 0.05, water: 0.08, bunker: 0.1, green: 0.12 }
const GROUND_TOP = Y.green
const RAD = 180 / Math.PI
/** Render-space x is the sim's x mirrored: in a right-handed y-up world, looking north (+z) puts +x on the LEFT, so without
 * this 'aim right' (compass heading increasing toward east) would swing the view left and the 3D view would mirror the minimap. */
export const MX = -1

/**
 * Ear-clipping triangulation of a simple polygon in the xz plane. Returns index triples wound
 * counter-clockwise in (x, z) regardless of the input winding. Always terminates.
 */
export function triangulate(poly: V2[]): number[] {
  const n = poly.length
  if (n < 3) return []
  let area = 0
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a.x * b.z - b.x * a.z }
  const idx: number[] = []
  for (let i = 0; i < n; i++) idx.push(area >= 0 ? i : n - 1 - i)
  const cross = (a: V2, b: V2, c: V2): number => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
  const inTri = (p: V2, a: V2, b: V2, c: V2): boolean => cross(a, b, p) > 1e-9 && cross(b, c, p) > 1e-9 && cross(c, a, p) > 1e-9
  const out: number[] = []
  let guard = 0
  while (idx.length > 3 && guard++ < 10_000) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const m = idx.length, i0 = idx[(i + m - 1) % m], i1 = idx[i], i2 = idx[(i + 1) % m]
      const a = poly[i0], b = poly[i1], c = poly[i2]
      if (cross(a, b, c) <= 1e-9) continue // reflex or degenerate corner
      let ear = true
      for (const j of idx) { if (j !== i0 && j !== i1 && j !== i2 && inTri(poly[j], a, b, c)) { ear = false; break } }
      if (!ear) continue
      out.push(i0, i1, i2); idx.splice(i, 1); clipped = true; break
    }
    if (!clipped) { out.push(idx[0], idx[1], idx[2]); idx.splice(1, 1) } // malformed input: clip anyway rather than loop forever
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2])
  return out
}

/** A flat polygon mesh at height y with an up-facing normal (two-sided material as insurance). */
function flatPoly(device: GraphicsDevice, poly: V2[], y: number, mat: StandardMaterial, name: string): Entity {
  const tris = triangulate(poly)
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], uvs: number[] = []
  for (const p of poly) { positions.push(p.x * MX, y, p.z); normals.push(0, 1, 0); uvs.push(p.x / 6, p.z / 6) } // planar uvs, one tile per 6 m
  for (let i = 0; i < tris.length; i += 3) indices.push(tris[i], tris[i + 1], tris[i + 2]) // CCW in (x,z) is -y; the x mirror flips it to +y
  const mesh = new Mesh(device)
  mesh.setPositions(positions); mesh.setNormals(normals); mesh.setUvs(0, uvs); mesh.setIndices(indices); mesh.update()
  const e = new Entity(name)
  e.addComponent('render', { meshInstances: [new MeshInstance(mesh, mat)], castShadows: false, receiveShadows: true })
  return e
}

const hex6 = (n: number): string => '#' + n.toString(16).padStart(6, '0')
const shade = (n: number, k: number): number => { const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * k))), g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * k))), b = Math.min(255, Math.max(0, Math.round((n & 255) * k))); return (r << 16) | (g << 8) | b }
/** Turf material with a small grass texture (custom polygon meshes carry planar uvs). */
function turf(device: GraphicsDevice, hex: number, two = false): StandardMaterial { const m = matteMat(hex, { diffuseMap: grassTex(device, hex6(hex), hex6(shade(hex, 0.72)), 64, hex & 1023), tiling: 1, toon: false }); if (two) { m.cull = CULLFACE_NONE; m.update() } return m }

/** Turf, hazard, tree and sky materials for one theme. */
interface ThemeMats { rough: StandardMaterial; course: StandardMaterial; fairway: StandardMaterial; water: StandardMaterial; sand: StandardMaterial; green: StandardMaterial; trunk: StandardMaterial; canopy: StandardMaterial; sky: StandardMaterial; horizon: StandardMaterial }
function themeMats(t: ThemePalette, device: GraphicsDevice): ThemeMats {
  const waves = waterTextures(device)
  const water = matteMat(0x3b99ae, { diffuseMap: waves.color, normalMap: waves.normal, bumpiness: 0.35, gloss: 0.92, specular: 0.85, metalness: 0.12, tiling: 0.5, toon: false }); water.cull = CULLFACE_NONE; water.update()
  // Mown bands live in UV space, clipped exactly by the authoritative fairway mesh.
  const fairway = matteMat(t.fairway)
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = hex6(t.fairway); ctx.fillRect(0, 0, 32, 64)
  ctx.fillStyle = hex6(shade(t.fairway, 0.88)); ctx.fillRect(0, 32, 32, 32)
  const mowing = new Texture(device, { name: 'fairway-mowing', width: 32, height: 64, mipmaps: true })
  mowing.setSource(canvas)
  fairway.diffuse = col(0xffffff); fairway.diffuseMap = mowing; fairway.diffuseMapTiling.set(0.5, 0.5); fairway.update()
  return {
    rough: matteMat(t.rough), course: matteMat(t.course), fairway, water, sand: matteMat(t.sand, { diffuseMap: noiseTex(device, hex6(t.sand), hex6(shade(t.sand, 0.85)), 0.3, 64, 77), tiling: 1, toon: false }), green: turf(device, t.green),
    trunk: flatMat(t.trunk), canopy: flatMat(t.canopy), sky: unlitMat(t.skyTop, true), horizon: unlitMat(t.skyHorizon, true),
  }
}

/** One golf hole in flat comic 3D: layered turf, hazards, flag, trees, wind sock, balls and the aim preview. */
export class CourseScene {
  root: Entity
  hole: Hole | null = null
  private device: GraphicsDevice
  private holeRoot: Entity | null = null
  private balls: Record<Player, Entity>
  private preview: Entity[] = []
  private sockPivot: Entity | null = null
  private flag: Entity | null = null
  private canopies: Entity[] = []
  private props: Entity[] = []
  private wind: V2 = { x: 0, z: 0 }
  private sky: Entity
  private horizon: Entity
  private theme: Theme | null = null
  /** Theme materials are built on first use and kept for the life of the scene. */
  private themeCache = new Map<Theme, ThemeMats>()
  private mats = { cup: unlitMat(0x141414), pole: flatMat(0xfff1cf), flag: flatMat(P.red), tee: flatMat(P.blue), sock: flatMat(P.orange) }

  constructor(root: Entity, device: GraphicsDevice) {
    this.root = root; this.device = device
    const m = this.matsFor('meadow')
    this.sky = part(root, 'sky', 'sphere', m.sky, { scale: { x: 1600, y: 1600, z: 1600 }, outline: false, shadows: false, receive: false })
    // a squashed inner sphere reads as a glow band around the horizon from anywhere on the course
    this.horizon = part(root, 'horizon', 'sphere', m.horizon, { pos: { x: 0, y: -20, z: 0 }, scale: { x: 1500, y: 160, z: 1500 }, outline: false, shadows: false, receive: false })
    this.balls = {
      a: part(root, 'ballA', 'sphere', flatMat(0xffffff), { scale: { x: BALL_DRAW_R * 2, y: BALL_DRAW_R * 2, z: BALL_DRAW_R * 2 } }),
      b: part(root, 'ballB', 'sphere', flatMat(0xfff1a0), { scale: { x: BALL_DRAW_R * 2, y: BALL_DRAW_R * 2, z: BALL_DRAW_R * 2 } }),
    }
    const gold = unlitMat(P.gold)
    for (let i = 0; i < PREVIEW_N; i++) {
      const e = part(root, 'preview', 'sphere', gold, { scale: { x: 0.3, y: 0.3, z: 0.3 }, outline: false })
      e.enabled = false
      this.preview.push(e)
    }
  }

  private matsFor(theme: Theme): ThemeMats {
    let m = this.themeCache.get(theme)
    if (!m) { m = themeMats(THEMES[theme], this.device); this.themeCache.set(theme, m) }
    return m
  }

  /** Swap the sky dome and fog to a theme's palette. Fog starts well past the 80 m ring the other games use, so it never shows there. */
  private applyTheme(theme: Theme): void {
    if (this.theme === theme) return
    this.theme = theme
    const m = this.matsFor(theme), t = THEMES[theme]
    if (this.sky.render) this.sky.render.material = m.sky
    if (this.horizon.render) this.horizon.render.material = m.horizon
    const scene = AppBase.getApplication()?.scene
    if (scene) { scene.fog.type = FOG_LINEAR; scene.fog.color = col(t.fog.color); scene.fog.start = t.fog.start; scene.fog.end = t.fog.end }
  }

  /** Rebuild the static hole geometry (turf layers, hazards, flag, trees, props, tee, wind sock) in the hole's theme. */
  setHole(hole: Hole): void {
    if (this.holeRoot) { this.holeRoot.destroy(); this.holeRoot = null }
    this.hole = hole; this.canopies = []; this.props = []
    this.applyTheme(hole.theme)
    const tm = this.matsFor(hole.theme)
    const h = pivot(this.root, 'hole')
    this.holeRoot = h
    const xs = hole.course.map((p) => p.x), zs = hole.course.map((p) => p.z)
    const minX = Math.min(...xs) - 150, maxX = Math.max(...xs) + 150, minZ = Math.min(...zs) - 150, maxZ = Math.max(...zs) + 150
    part(h, 'rough', 'box', tm.rough, { pos: { x: (minX + maxX) / 2 * MX, y: -0.1, z: (minZ + maxZ) / 2 }, scale: { x: maxX - minX, y: 0.2, z: maxZ - minZ }, outline: false })
    h.addChild(flatPoly(this.device, hole.course, Y.course, tm.course, 'course'))
    h.addChild(flatPoly(this.device, hole.fairway, Y.fairway, tm.fairway, 'fairway'))
    const shallows = matteMat(0x6babb0, { gloss: 0.8, specular: 0.6 })
    const bankStone = matteMat(0x9b9f8e)
    const reed = matteMat(0x6f8548)
    h.once('destroy', () => { shallows.destroy(); bankStone.destroy(); reed.destroy() })
    hole.water.forEach((w, i) => {
      h.addChild(flatPoly(this.device, w, Y.water, tm.water, `water${i}`))
      // Narrow, irregular shallow-water shelves stay INSIDE the hazard polygon.
      for (let edge = 0; edge < w.length; edge++) {
        const a = w[edge], b = w[(edge + 1) % w.length]
        const length = Math.hypot(b.x - a.x, b.z - a.z), count = Math.ceil(length / 2)
        const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length
        const mid = { x: (a.x + b.x) / 2 + nx * 0.1, z: (a.z + b.z) / 2 + nz * 0.1 }
        const direction = pointInPolygon(mid, w) ? 1 : -1
        for (let j = 0; j < count; j++) {
          const u = j / count, v = (j + 1) / count
          const p = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }
          const q = { x: a.x + (b.x - a.x) * v, z: a.z + (b.z - a.z) * v }
          const depth = 0.7 + 0.5 * (1 + Math.sin(j * 0.65 + edge))
          const nextDepth = 0.7 + 0.5 * (1 + Math.sin((j + 1) * 0.65 + edge))
          const r = { x: q.x + nx * direction * nextDepth, z: q.z + nz * direction * nextDepth }
          const t = { x: p.x + nx * direction * depth, z: p.z + nz * direction * depth }
          if (pointInPolygon(r, w) && pointInPolygon(t, w)) h.addChild(flatPoly(this.device, [p, q, r, t], Y.water + 0.003, shallows, 'water-shelf'))
          if (j % 2 === 0 && !pointInPolygon(p, hole.fairway)) {
            for (let stalk = 0; stalk < 3; stalk++) {
              const height = 0.8 + (stalk + j % 3) * 0.22
              part(h, 'waterside-reed', 'cylinder', reed, { pos: { x: p.x * MX + stalk * 0.16, y: height / 2, z: p.z + 0.3 }, scale: { x: 0.07, y: height, z: 0.07 }, euler: { x: 0, y: 0, z: (stalk - 1) * 12 }, outline: false, shadows: false })
            }
          }
          // Pebbles at the far ends, outside the fairway, soften the engineered bank.
          if (j % 3 === 0 && !pointInPolygon(p, hole.fairway)) {
            facetedSphere(this.device, h, 'river-stone', bankStone, { pos: { x: p.x * MX, y: 0.15, z: p.z }, scale: { x: 1.7, y: 0.65, z: 1.2 }, bands: 7, outline: false, shadows: false })
          }
        }
      }
    })
    for (const b of hole.bunkers) part(h, 'bunker', 'cylinder', tm.sand, { pos: { x: b.c.x * MX, y: Y.bunker / 2, z: b.c.z }, scale: { x: b.r * 2, y: Y.bunker, z: b.r * 2 }, outline: false })
    const c = { x: hole.cup.x * MX, z: hole.cup.z }
    part(h, 'green', 'cylinder', tm.green, { pos: { x: c.x, y: Y.green / 2, z: c.z }, scale: { x: hole.greenR * 2, y: Y.green, z: hole.greenR * 2 }, outline: false })
    part(h, 'cup', 'cylinder', this.mats.cup, { pos: { x: c.x, y: Y.green + 0.01, z: c.z }, scale: { x: 0.4, y: 0.02, z: 0.4 }, outline: false })
    part(h, 'pole', 'cylinder', this.mats.pole, { pos: { x: c.x, y: Y.green + 1.2, z: c.z }, scale: { x: 0.06, y: 2.4, z: 0.06 }, outline: false })
    const flagPivot = pivot(h, 'flagPivot', { x: c.x, y: Y.green + 2.15, z: c.z })
    part(flagPivot, 'flag', 'box', this.mats.flag, { pos: { x: 0.42, y: 0, z: 0 }, scale: { x: 0.8, y: 0.5, z: 0.04 }, outlineK: 0.02 })
    this.flag = flagPivot
    for (const dx of [-1, 1]) part(h, 'teeMarker', 'sphere', this.mats.tee, { pos: { x: hole.tee.x * MX + dx, y: GROUND_TOP + 0.15, z: hole.tee.z }, scale: { x: 0.3, y: 0.3, z: 0.3 } })
    for (const t of hole.trees) {
      part(h, 'trunk', 'cylinder', tm.trunk, { pos: { x: t.x * MX, y: 1.5, z: t.z }, scale: { x: 0.7, y: 3, z: 0.7 }, outlineK: 0.08 })
      this.canopies.push(facetedSphere(this.device, h, 'canopy', tm.canopy, { pos: { x: t.x * MX, y: 6.4, z: t.z }, scale: { x: 6, y: 7, z: 6 }, bands: 8, outline: false }))
    }
    // Scenery is outside the playable course bounds; no decorative hazard alters a lie.
    const palette = THEMES[hole.theme]
    const mountain = matteMat(hole.theme === 'meadow' ? 0x658b8c : shade(palette.canopy, 0.85))
    const distant = matteMat(palette.skyHorizon)
    const centerX = (minX + maxX) / 2 * MX, centerZ = (minZ + maxZ) / 2
    const radiusX = (maxX - minX) / 2 + 25, radiusZ = (maxZ - minZ) / 2 + 25
    for (let i = 0; i < 20; i++) {
      const angle = i / 20 * Math.PI * 2
      const height = 35 + (i * 17 % 43)
      landscapePeak(this.device, h, i % 3 ? mountain : distant,
        { x: centerX + Math.cos(angle) * radiusX, y: -2, z: centerZ + Math.sin(angle) * radiusZ },
        { x: 160, y: height, z: 140 }, i)

    }
    h.once('destroy', () => { mountain.destroy(); distant.destroy() })
    if (hole.theme !== 'canyon') {
      for (const side of [-1, 1]) for (let i = 0; i < 16; i++) {
        const x = (side < 0 ? minX + 138 : maxX - 138) * MX
        const z = minZ + 150 + (maxZ - minZ - 300) * i / 15
        const height = 7 + i % 4
        part(h, 'boundary-trunk', 'box', tm.trunk, { pos: { x, y: 2, z }, scale: { x: 0.8, y: 4, z: 0.8 }, outline: false, shadows: false })
        facetedSphere(this.device, h, 'boundary-canopy', tm.canopy, { pos: { x, y: height * 0.7, z }, scale: { x: 8, y: height, z: 8 }, bands: 8, outline: false, shadows: false })
      }
    }
    // A low collar gives the target shape without moving the playable green boundary.
    part(h, 'green-collar', 'cylinder', tm.fairway, { pos: { x: c.x, y: 0.035, z: c.z }, scale: { x: hole.greenR * 2 + 1.5, y: 0.07, z: hole.greenR * 2 + 1.5 }, outline: false, shadows: false })
    for (const tree of hole.trees) {
      for (const side of [-1, 1]) facetedSphere(this.device, h, 'branch-crown', tm.canopy, { pos: { x: tree.x * MX + side * 1.8, y: 4.9, z: tree.z + side * 0.8 }, scale: { x: 4.5, y: 4, z: 4.5 }, bands: 7, outline: false, shadows: false })
    }
    for (const pr of hole.props ?? []) this.props.push(buildProp(h, pr, pr.p.x * MX, GROUND_TOP, pr.p.z))
    // wind sock beside the tee: pole, then a cone hanging from a pivot that rotates to the wind
    const sx = (hole.tee.x + 5) * MX, sz = hole.tee.z + 2
    part(h, 'sockPole', 'cylinder', this.mats.pole, { pos: { x: sx, y: 2, z: sz }, scale: { x: 0.1, y: 4, z: 0.1 }, outline: false })
    this.sockPivot = pivot(h, 'sockPivot', { x: sx, y: 4, z: sz })
    part(this.sockPivot, 'sock', 'cone', this.mats.sock, { pos: { x: 0, y: 0.7, z: 0 }, scale: { x: 0.45, y: 1.4, z: 0.45 }, outlineK: 0.02 })
    this.setWind(this.wind)
    this.setPreview(null)
  }

  setBalls(v: GolfSnapshot): void {
    for (const p of ['a', 'b'] as const) {
      const b = v.balls[p], e = this.balls[p]
      e.enabled = !b.holed
      e.setLocalPosition(b.pos.x * MX, b.pos.y + GROUND_TOP + BALL_DRAW_R, b.pos.z)
    }
  }

  setWind(wind: V2): void {
    this.wind = { ...wind }
    if (!this.sockPivot) return
    const speed = Math.hypot(wind.x, wind.z)
    const yaw = speed > 1e-3 ? Math.atan2(wind.x * MX, wind.z) * RAD : 0
    this.sockPitch = 180 - Math.min(1, speed / 6) * 95 // calm: hangs down (180); strong: nearly horizontal
    this.sockYaw = yaw
    this.sockPivot.setLocalEulerAngles(this.sockPitch, this.sockYaw, 0)
    this.flag?.setLocalEulerAngles(0, yaw - 90, 0)
  }
  private sockPitch = 180
  private sockYaw = 0

  /** Show a shot trail resampled onto the preview spheres, or hide them. */
  setPreview(trail: V3[] | null): void {
    if (!trail || trail.length < 2) { for (const e of this.preview) e.enabled = false; return }
    for (let i = 0; i < PREVIEW_N; i++) {
      const p = trail[Math.min(trail.length - 1, Math.round((i / (PREVIEW_N - 1)) * (trail.length - 1)))]
      const e = this.preview[i]
      e.enabled = true
      e.setLocalPosition(p.x * MX, p.y + GROUND_TOP + 0.08, p.z)
    }
  }

  update(t: number, dt: number): void {
    void dt
    if (this.theme) {
      const water = this.matsFor(this.theme).water
      water.normalMapOffset.set(t * 0.007, t * 0.011)
      water.diffuseMapOffset.set(t * 0.003, 0)
      water.update()
    }
    const k = Math.min(1, Math.hypot(this.wind.x, this.wind.z) / 6)
    const sway = Math.sin(t * 1.3) * 1.5 * k
    for (let i = 0; i < this.canopies.length; i++) { const e = this.canopies[i]; e.setLocalEulerAngles(0, 0, sway + Math.sin(t * 1.7 + i) * 0.6 * k) }
    this.sockPivot?.setLocalEulerAngles(this.sockPitch, this.sockYaw, Math.sin(t * 5) * 4 * k)
  }
}
