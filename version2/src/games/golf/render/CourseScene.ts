import { AppBase, CULLFACE_NONE, Entity, FOG_LINEAR, Mesh, MeshInstance, type GraphicsDevice, type StandardMaterial } from 'playcanvas'
import { col, flatMat, matteMat, unlitMat } from '../../../engine3d/materials'
import { grassTex, noiseTex } from '../../../engine3d/textures'
import { part, pivot } from '../../../engine3d/primitives'
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
  const water = matteMat(t.water, { gloss: 0.85, specular: 0.8, metalness: 0.2, toon: false }); water.cull = CULLFACE_NONE; water.update()
  return {
    rough: turf(device, t.rough), course: turf(device, t.course, true), fairway: turf(device, t.fairway, true), water, sand: matteMat(t.sand, { diffuseMap: noiseTex(device, hex6(t.sand), hex6(shade(t.sand, 0.85)), 0.3, 64, 77), tiling: 1, toon: false }), green: turf(device, t.green),
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
    this.sky = part(root, 'sky', 'sphere', m.sky, { scale: { x: 1600, y: 1600, z: 1600 }, outline: false })
    // a squashed inner sphere reads as a glow band around the horizon from anywhere on the course
    this.horizon = part(root, 'horizon', 'sphere', m.horizon, { pos: { x: 0, y: -20, z: 0 }, scale: { x: 1500, y: 160, z: 1500 }, outline: false })
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
    hole.water.forEach((w, i) => h.addChild(flatPoly(this.device, w, Y.water, tm.water, `water${i}`)))
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
      this.canopies.push(part(h, 'canopy', 'cone', tm.canopy, { pos: { x: t.x * MX, y: 6.4, z: t.z }, scale: { x: 5, y: 7, z: 5 }, outlineK: 0.14 }))
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
    const k = Math.min(1, Math.hypot(this.wind.x, this.wind.z) / 6)
    const sway = Math.sin(t * 1.3) * 1.5 * k
    for (let i = 0; i < this.canopies.length; i++) { const e = this.canopies[i]; e.setLocalEulerAngles(0, 0, sway + Math.sin(t * 1.7 + i) * 0.6 * k) }
    this.sockPivot?.setLocalEulerAngles(this.sockPitch, this.sockYaw, Math.sin(t * 5) * 4 * k)
  }
}
