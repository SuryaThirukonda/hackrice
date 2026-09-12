import { BLEND_ADDITIVE, BLEND_NORMAL, CULLFACE_NONE, Color, Entity, Mesh, MeshInstance, StandardMaterial, Vec3, calculateNormals, createSphere, type GraphicsDevice, type Texture } from 'playcanvas'
import { inkMat } from './materials'
import type { V3 } from './springs'

export type Prim = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'plane' | 'torus'
export interface PartOpts { pos?: V3; scale?: V3; euler?: V3; outline?: boolean; outlineK?: number; shadows?: boolean; receive?: boolean; batch?: number }

let defaultBatch = -1
/** Batch group that `part()` and `decal()` use when no explicit `batch` is given (set while building static scenery, reset to -1 for anything that moves). */
export function setDefaultBatch(id: number): void { defaultBatch = id }

/** A primitive with an inverted-hull ink outline child. */
export function part(parent: Entity, name: string, type: Prim, mat: StandardMaterial, o: PartOpts = {}): Entity {
  const e = new Entity(name)
  const batch = o.batch ?? defaultBatch
  e.addComponent('render', { type, material: mat, castShadows: o.shadows !== false, receiveShadows: o.receive ?? true, batchGroupId: batch })
  const s = o.scale ?? { x: 1, y: 1, z: 1 }
  e.setLocalScale(s.x, s.y, s.z)
  if (o.pos) e.setLocalPosition(o.pos.x, o.pos.y, o.pos.z)
  if (o.euler) e.setLocalEulerAngles(o.euler.x, o.euler.y, o.euler.z)
  if (o.outline !== false) {
    const k = o.outlineK ?? 0.03
    const h = new Entity(name + ':ink')
    h.addComponent('render', { type, material: inkMat(), castShadows: false, receiveShadows: false, batchGroupId: batch })
    // scale the hull outward by a fixed world thickness on each axis
    h.setLocalScale(1 + k / Math.max(0.05, s.x), 1 + k / Math.max(0.05, s.y), 1 + k / Math.max(0.05, s.z))
    e.addChild(h)
  }
  parent.addChild(e)
  return e
}

export function pivot(parent: Entity, name: string, pos?: V3): Entity {
  const e = new Entity(name)
  if (pos) e.setLocalPosition(pos.x, pos.y, pos.z)
  parent.addChild(e)
  return e
}

const _a = new Vec3(), _b = new Vec3(), _m = new Vec3()
/** Orient a unit cylinder (axis Y) so it spans from a to b (parent-local), with the given radius. */
export function orientSegment(e: Entity, a: V3, b: V3, r: number): void {
  _a.set(a.x, a.y, a.z); _b.set(b.x, b.y, b.z)
  _m.add2(_a, _b).mulScalar(0.5)
  const len = Math.max(0.001, _a.distance(_b))
  e.setLocalPosition(_m)
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
  // rotate local Y onto direction d
  const yaw = Math.atan2(dx, dz) * (180 / Math.PI)
  const pitch = Math.atan2(Math.hypot(dx, dz), dy) * (180 / Math.PI)
  e.setLocalEulerAngles(pitch, yaw, 0)
  e.setLocalScale(r * 2, len, r * 2)
}

/** Two-bone analytic IK in a local frame: returns the elbow position for shoulder S, target T, bone lengths, and a bend hint direction. */
export function twoBoneIK(S: V3, T: V3, l1: number, l2: number, hint: V3): { elbow: V3; target: V3 } {
  let dx = T.x - S.x, dy = T.y - S.y, dz = T.z - S.z
  let d = Math.hypot(dx, dy, dz)
  const max = l1 + l2 - 0.002
  if (d > max) { const k = max / d; dx *= k; dy *= k; dz *= k; d = max }
  if (d < 1e-4) return { elbow: { x: S.x + hint.x * l1, y: S.y + hint.y * l1, z: S.z + hint.z * l1 }, target: { ...S } }
  const ux = dx / d, uy = dy / d, uz = dz / d
  // hint made perpendicular to u
  const hd = hint.x * ux + hint.y * uy + hint.z * uz
  let px = hint.x - hd * ux, py = hint.y - hd * uy, pz = hint.z - hd * uz
  const pl = Math.hypot(px, py, pz) || 1
  px /= pl; py /= pl; pz /= pl
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  return { elbow: { x: S.x + ux * a + px * h, y: S.y + uy * a + py * h, z: S.z + uz * a + pz * h }, target: { x: S.x + dx, y: S.y + dy, z: S.z + dz } }
}

/** Faceted (hard-edge) sphere: low-band sphere unwelded so every triangle has its own normal. */
export function facetedSphere(device: GraphicsDevice, parent: Entity, name: string, mat: StandardMaterial, o: PartOpts & { bands?: number } = {}): Entity {
  const src = createSphere(device, { radius: 0.5, latitudeBands: o.bands ?? 7, longitudeBands: (o.bands ?? 7) + 2 })
  const pos: number[] = [], idx: number[] = [], uv: number[] = []
  src.getPositions(pos); src.getIndices(idx); src.getUvs(0, uv)
  const P: number[] = [], U: number[] = [], I: number[] = []
  for (let i = 0; i < idx.length; i++) { const v = idx[i]; P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); U.push(uv[v * 2], uv[v * 2 + 1]); I.push(i) }
  const N = calculateNormals(P, I)
  const mesh = new Mesh(device)
  mesh.setPositions(P); mesh.setNormals(N); mesh.setUvs(0, U); mesh.setUvs(1, U); mesh.setIndices(I); mesh.update()
  src.destroy()
  const e = new Entity(name)
  e.addComponent('render', { meshInstances: [new MeshInstance(mesh, mat)], castShadows: o.shadows !== false, receiveShadows: o.receive ?? true })
  const s = o.scale ?? { x: 1, y: 1, z: 1 }
  e.setLocalScale(s.x, s.y, s.z)
  if (o.pos) e.setLocalPosition(o.pos.x, o.pos.y, o.pos.z)
  if (o.euler) e.setLocalEulerAngles(o.euler.x, o.euler.y, o.euler.z)
  if (o.outline !== false) {
    const k = o.outlineK ?? 0.03
    const h = new Entity(name + ':ink')
    h.addComponent('render', { meshInstances: [new MeshInstance(mesh, inkMat())], castShadows: false, receiveShadows: false })
    h.setLocalScale(1 + k / Math.max(0.05, s.x), 1 + k / Math.max(0.05, s.y), 1 + k / Math.max(0.05, s.z))
    e.addChild(h)
  }
  parent.addChild(e)
  return e
}

/** Flat textured card lying on a surface (scuffs, tape, logos). Alpha-blended, no shadows. */
const decalMats = new Map<string, StandardMaterial>()
export function decal(parent: Entity, name: string, tex: Texture, o: { pos: V3; w: number; h: number; euler?: V3; opacity?: number; fog?: boolean; batch?: number }): Entity {
  // materials are shared per (texture, opacity, fog) so decals with the same card can be batched into one draw call
  const key = `${tex.name}#${tex.width}x${tex.height}#${(tex as unknown as { id?: number }).id ?? ''}|${o.opacity ?? 1}|${o.fog ?? false}`
  let m = decalMats.get(key)
  if (!m) {
    m = new StandardMaterial()
    m.useLighting = false; m.diffuse = new Color(1, 1, 1)
    m.emissive = new Color(1, 1, 1); m.emissiveMap = tex; m.opacityMap = tex; m.opacityMapChannel = 'a'; m.blendType = BLEND_NORMAL; m.opacity = o.opacity ?? 1
    m.depthWrite = false; m.cull = CULLFACE_NONE; m.useTonemap = false; m.useFog = o.fog ?? false; m.update()
    decalMats.set(key, m)
  }
  const e = new Entity(name)
  e.addComponent('render', { type: 'plane', material: m, castShadows: false, receiveShadows: false, batchGroupId: o.batch ?? defaultBatch })
  e.setLocalScale(o.w, 1, o.h)
  e.setLocalPosition(o.pos.x, o.pos.y, o.pos.z)
  if (o.euler) e.setLocalEulerAngles(o.euler.x, o.euler.y, o.euler.z)
  parent.addChild(e)
  return e
}

/** Camera-facing card with an alpha texture (crowd, glow sprites). Call `face(camera)` each frame. */
export function billboard(parent: Entity, name: string, tex: Texture, w: number, h: number, tint = 0xffffff, additive = false, mat?: StandardMaterial): Entity {
  const m = new StandardMaterial()
  const c = new Color(((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255)
  if (!mat) {
    m.useLighting = false; m.diffuse = c
    m.emissive = c; m.emissiveMap = tex; m.opacityMap = tex; m.opacityMapChannel = 'a'; m.blendType = additive ? BLEND_ADDITIVE : BLEND_NORMAL
    m.depthWrite = false; m.cull = CULLFACE_NONE; m.useTonemap = false; m.useFog = true; m.update()
  }
  const e = new Entity(name)
  e.addComponent('render', { type: 'plane', material: mat ?? m, castShadows: false, receiveShadows: false })
  e.setLocalEulerAngles(90, 0, 0)
  const holder = new Entity(name + ':bb')
  holder.addChild(e)
  e.setLocalScale(w, 1, h)
  parent.addChild(holder)
  return holder
}
