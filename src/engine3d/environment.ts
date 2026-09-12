import { Entity, Mesh, MeshInstance, Texture, calculateNormals, type GraphicsDevice, type StandardMaterial } from 'playcanvas'
import { col, matteMat, unlitMat } from './materials'
import { orientSegment, part, pivot } from './primitives'
import type { V3 } from './springs'
import type { Engine3D } from './Engine3D'

/** Shared, material-cached static scenery. No collision components or simulation state. */
export class Environment {
  readonly root: Entity
  private materials = new Map<string, StandardMaterial>()
  constructor(parent: Entity, name: string, privateBatch = -1) {
    this.root = pivot(parent, name)
    this.batch = privateBatch
  }
  private batch: number
  mat(hex: number, glow = false): StandardMaterial {
    const key = `${hex}:${glow}`
    let m = this.materials.get(key)
    if (!m) { m = glow ? unlitMat(hex) : matteMat(hex); this.materials.set(key, m) }
    return m
  }
  box(name: string, color: number, pos: V3, scale: V3, glow = false): Entity {
    return part(this.root, name, 'box', this.mat(color, glow), { pos, scale, outline: false, shadows: false, batch: this.batch })
  }
  beam(name: string, a: V3, b: V3, radius = 0.045): void {
    const e = part(this.root, name, 'cylinder', this.mat(0x435569), { outline: false, shadows: false, batch: this.batch })
    orientSegment(e, a, b, radius)
  }
  truss(a: V3, b: V3): void {
    this.beam('truss-lower', a, b)
    this.beam('truss-upper', { ...a, y: a.y + 0.4 }, { ...b, y: b.y + 0.4 })
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z))
    for (let i = 0; i < n; i++) this.beam('truss-brace',
      { x: a.x + (b.x - a.x) * i / n, y: a.y + (i % 2) * 0.4, z: a.z + (b.z - a.z) * i / n },
      { x: a.x + (b.x - a.x) * (i + 1) / n, y: a.y + ((i + 1) % 2) * 0.4, z: a.z + (b.z - a.z) * (i + 1) / n }, 0.025)
  }
  label(device: GraphicsDevice, text: string, pos: V3, width: number, height: number): void {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#263b4b'; ctx.fillRect(0, 0, 1024, 256)
    ctx.fillStyle = '#f5e8c9'; ctx.font = 'bold 110px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(text, 512, 128, 960)
    const texture = new Texture(device, { name: 'venue-sign', width: 1024, height: 256, mipmaps: true, anisotropy: 8 }); texture.setSource(canvas)
    const material = unlitMat(0xffffff); material.emissiveMap = texture; material.update()
    part(this.root, 'venue-sign', 'box', material, { pos, scale: { x: width, y: height, z: 0.02 }, outline: false, shadows: false })
    this.root.once('destroy', () => { texture.destroy(); material.destroy() })
  }
  screen(x: number, y: number, z: number, width: number, accent: number): void {
    this.box('screen-frame', 0x101c30, { x, y, z }, { x: width, y: width * 0.45, z: 0.12 })
    this.box('screen-face', 0x203c57, { x, y, z: z + 0.07 }, { x: width * 0.9, y: width * 0.36, z: 0.02 }, true)
    for (let i = 0; i < 3; i++) this.box('screen-graphic', accent, { x: x - width * 0.26 + i * width * 0.26, y, z: z + 0.09 }, { x: width * 0.16, y: width * (0.08 + i * 0.05), z: 0.01 }, true)
  }
}

/** Reset the shared rig on every sport entry, avoiding lighting leaking between worlds. */
export function lightSport(engine: Engine3D, sport: 'boxing' | 'bowling' | 'golf'): void {
  const outdoor = sport === 'golf', lane = sport === 'bowling'
  engine.key.setEulerAngles(outdoor ? 48 : 28, outdoor ? -35 : -25, 0)
  engine.key.light!.color = col(outdoor ? 0xfff4d8 : lane ? 0xfff0d3 : 0xfff7ed)
  engine.key.light!.intensity = outdoor ? 1.65 : 1.5
  engine.key.light!.shadowDistance = outdoor ? 85 : 28
  engine.fill.light!.type = 'directional'
  engine.fill.setEulerAngles(32, 155, 0)
  engine.fill.light!.color = col(outdoor ? 0xb2d7f0 : 0xe1ecf0)
  engine.fill.light!.intensity = outdoor ? 0.3 : 0.85
  engine.rim.light!.intensity = outdoor ? 0 : 1.2
  engine.camera.camera!.nearClip = outdoor ? 0.3 : 0.05
  engine.camera.camera!.farClip = outdoor ? 1500 : 80
}

/** Unwelded ridge with a broken shoulder: inexpensive hard normals and an asymmetric silhouette. */
export function landscapePeak(device: GraphicsDevice, parent: Entity, mat: StandardMaterial, pos: V3, scale: V3, seed: number): Entity {
  const positions: number[] = [], indices: number[] = []
  const n = 16
  const ring = (i: number, inner: boolean): number[] => {
    const angle = i / n * Math.PI * 2
    const radius = inner ? 0.22 + 0.035 * Math.sin(i * 2 + seed) : 0.5
    return [Math.cos(angle) * radius, inner ? 0.38 + 0.12 * Math.sin(angle * 3 + seed) : 0, Math.sin(angle) * radius]
  }
  const triangle = (a: number[], b: number[], c: number[]) => {
    const offset = positions.length / 3
    positions.push(...a, ...b, ...c); indices.push(offset, offset + 1, offset + 2)
  }
  for (let i = 0; i < n; i++) {
    const a = ring(i, false), b = ring((i + 1) % n, false), c = ring(i, true), d = ring((i + 1) % n, true)
    triangle(a, c, b); triangle(b, c, d)
    triangle(c, [0.12 * Math.sin(seed), 1, 0.08 * Math.cos(seed)], d)
  }

  const mesh = new Mesh(device)
  mesh.setPositions(positions); mesh.setNormals(calculateNormals(positions, indices)); mesh.setIndices(indices); mesh.update()
  const e = new Entity('landscape-peak')
  e.addComponent('render', { meshInstances: [new MeshInstance(mesh, mat)], castShadows: false, receiveShadows: false })
  e.setLocalPosition(pos.x, pos.y, pos.z); e.setLocalScale(scale.x, scale.y, scale.z)
  parent.addChild(e)
  e.once('destroy', () => mesh.destroy())
  return e
}
