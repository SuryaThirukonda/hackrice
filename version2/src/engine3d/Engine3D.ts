import { AppBase, AppOptions, BAKE_COLOR, BatchManager, CameraComponentSystem, Color, DEVICETYPE_WEBGL2, Entity, FILLMODE_NONE, FOG_LINEAR, FOG_NONE, LIGHTFALLOFF_INVERSESQUARED, LIGHTFALLOFF_LINEAR, LightComponentSystem, Lightmapper, ParticleSystemComponentSystem, RESOLUTION_AUTO, RenderComponentSystem, SHADOW_PCF3_32F, TONEMAP_ACES, createGraphicsDevice, type Texture } from 'playcanvas'
import { col } from './materials'
import { envAtlasFromGradient, type SkyGradient } from './env'
import { Post, type Quality } from './post'

export interface WorldLook { sky: SkyGradient; fog?: { color: number; start: number; end: number }; tint?: number; saturation?: number; exposure?: number; ambient?: number }

/** One PlayCanvas app behind the Phaser canvas, shared by every 3D game. Frames are rendered manually from Phaser's update. */
export class Engine3D {
  private static inst: Promise<Engine3D> | null = null
  static get(): Promise<Engine3D> { return (this.inst ??= Engine3D.create()) }
  static peek(): Engine3D | null { return Engine3D.ready }
  private static ready: Engine3D | null = null

  readonly canvas: HTMLCanvasElement
  readonly app: AppBase
  readonly camera: Entity
  /** Key (warm, shadows), fill (cool), rim (behind the subject). */
  readonly key: Entity
  readonly fill: Entity
  readonly rim: Entity
  readonly post: Post
  private worlds: Entity[] = []
  private atlases = new Map<string, Texture>()
  quality: Quality = 'high'

  private constructor(canvas: HTMLCanvasElement, app: AppBase) {
    this.canvas = canvas; this.app = app
    this.camera = new Entity('camera')
    this.camera.addComponent('camera', { clearColor: new Color(0, 0, 0, 0), clearColorBuffer: true, fov: 60, nearClip: 0.05, farClip: 80, toneMapping: TONEMAP_ACES })
    app.root.addChild(this.camera)
    this.key = new Entity('key')
    this.key.addComponent('light', { type: 'directional', color: col(0xfff4dc), intensity: 1.35, castShadows: true, shadowDistance: 16, shadowResolution: 1024, shadowType: SHADOW_PCF3_32F, shadowBias: 0.06, normalOffsetBias: 0.05, shadowIntensity: 0.8, numCascades: 1 })
    this.key.setEulerAngles(52, 30, 0)
    app.root.addChild(this.key)
    this.fill = new Entity('fill')
    this.fill.addComponent('light', { type: 'omni', color: col(0x6f86c9), intensity: 0.5, range: 20, falloffMode: LIGHTFALLOFF_LINEAR, castShadows: false })
    this.fill.setPosition(-4, 3, 4)
    app.root.addChild(this.fill)
    this.rim = new Entity('rim')
    this.rim.addComponent('light', { type: 'spot', color: col(0xffd7a0), intensity: 2.2, range: 14, innerConeAngle: 22, outerConeAngle: 40, falloffMode: LIGHTFALLOFF_INVERSESQUARED, castShadows: false })
    this.rim.setPosition(0, 4, -5); this.rim.lookAt(0, 1, 0)
    app.root.addChild(this.rim)
    app.scene.ambientLight = col(0x33395a)
    app.scene.exposure = 1.15
    this.post = new Post(app, this.camera.camera!)
    this.setQuality('medium')
  }

  private static async create(): Promise<Engine3D> {
    const parent = document.getElementById('game') as HTMLElement
    const canvas = document.createElement('canvas')
    canvas.className = 'pc'
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;display:none'
    parent.insertBefore(canvas, parent.firstChild)
    const device = await createGraphicsDevice(canvas, { deviceTypes: [DEVICETYPE_WEBGL2], antialias: true, powerPreference: 'high-performance' })
    device.maxPixelRatio = 1
    const opts = new AppOptions()
    opts.graphicsDevice = device
    opts.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem, ParticleSystemComponentSystem]
    opts.resourceHandlers = []
    opts.lightmapper = Lightmapper
    opts.batchManager = BatchManager
    const app = new AppBase(canvas)
    app.init(opts)
    app.setCanvasFillMode(FILLMODE_NONE)
    app.setCanvasResolution(RESOLUTION_AUTO)
    app.start()
    app.autoRender = false
    const e = new Engine3D(canvas, app)
    Engine3D.ready = e
    return e
  }

  /** Quality: high = shadows + full post incl. SSAO; medium = no SSAO, smaller RT; low = no post, no shadows. */
  setQuality(q: Quality): void {
    this.quality = q
    this.post.setQuality(q)
    this.key.light!.castShadows = q !== 'low'
    this.key.light!.shadowResolution = q === 'high' ? 2048 : 1024
    this.app.graphicsDevice.maxPixelRatio = q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2)
  }

  /** A root entity for one game's content; disabled until shown. */
  newWorld(name: string): Entity {
    const w = new Entity(name)
    w.enabled = false
    this.app.root.addChild(w)
    this.worlds.push(w)
    return w
  }
  /** Per-world look: environment lighting from a gradient sky (cached by name), fog, grading, exposure. */
  applyLook(name: string, look: WorldLook): void {
    let atlas = this.atlases.get(name)
    if (!atlas) { atlas = envAtlasFromGradient(this.app.graphicsDevice, look.sky); this.atlases.set(name, atlas) }
    this.app.scene.envAtlas = atlas
    this.app.scene.skyboxIntensity = 1
    const f = this.app.scene.fog
    if (look.fog) { f.type = FOG_LINEAR; f.color = col(look.fog.color); f.start = look.fog.start; f.end = look.fog.end } else f.type = FOG_NONE
    this.app.scene.exposure = look.exposure ?? 1.15
    this.app.scene.ambientLight = col(look.ambient ?? 0x33395a)
    this.post.grade(look.tint ?? 0xffffff, look.saturation ?? 1.08)
  }
  /** Aim the light rig at a subject: key from above-front-left, fill opposite, rim behind toward the camera. */
  aimLights(target: { x: number; y: number; z: number }, camPos: { x: number; z: number }): void {
    const dx = camPos.x - target.x, dz = camPos.z - target.z, d = Math.hypot(dx, dz) || 1
    const ux = dx / d, uz = dz / d // unit vector from target toward the camera
    this.fill.setPosition(target.x + ux * 4 - uz * 4, target.y + 2.5, target.z + uz * 4 + ux * 4)
    this.rim.setPosition(target.x - ux * 5, target.y + 3.5, target.z - uz * 5)
    this.rim.lookAt(target.x, target.y, target.z)
  }
  private batchIds = new Map<string, number>()
  /** Batch group id for static geometry sharing materials (one draw call per material). Dynamic groups re-transform on the CPU each frame. */
  batchGroup(name: string, dynamic = false, size = 40): number {
    let id = this.batchIds.get(name)
    if (id === undefined) { id = this.app.batcher.addGroup(name, dynamic, size).id; this.batchIds.set(name, id) }
    return id
  }
  /** Build the batches for the given groups (call once after a world is constructed). */
  generateBatches(ids: number[]): void { try { this.app.batcher.generate(ids) } catch (e) { console.warn('[3d] batching skipped', e) } }

  /** Bake ambient occlusion and the key light into static (lightmapped) parts of a world. Skipped on low quality. */
  bakeStatic(world: Entity): void {
    if (this.quality === 'low') return
    const s = this.app.scene
    s.ambientBake = true; s.ambientBakeNumSamples = 48; s.ambientBakeOcclusionContrast = 0.45; s.lightmapSizeMultiplier = 8; s.lightmapMaxResolution = 1024
    this.key.light!.bake = true
    try { this.app.lightmapper?.bake([world], BAKE_COLOR) } catch (e) { console.warn('[3d] lightmap bake skipped', e) }
    this.key.light!.bake = false
  }
  show(world: Entity, w: number, h: number): void {
    for (const x of this.worlds) x.enabled = x === world
    this.canvas.style.display = 'block'
    this.resize(w, h)
  }
  hide(): void { this.canvas.style.display = 'none'; for (const x of this.worlds) x.enabled = false; this.post.focus(null) }
  resize(w: number, h: number): void { this.app.resizeCanvas(w, h) }
  renderFrame(): void { this.app.render() }
}
