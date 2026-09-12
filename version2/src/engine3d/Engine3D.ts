import { AppBase, AppOptions, BAKE_COLOR, BatchManager, CameraComponentSystem, Color, DEVICETYPE_WEBGL2, Entity, FILLMODE_NONE, FOG_LINEAR, FOG_NONE, LightComponentSystem, Lightmapper, ParticleSystemComponentSystem, RESOLUTION_AUTO, RenderComponentSystem, SHADOW_PCF3_32F, TONEMAP_ACES, createGraphicsDevice } from 'playcanvas'
import { col } from './materials'
import type { SkyGradient } from './env'
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
  /** The single warm key light (shadows only on the high setting). */
  readonly key: Entity
  readonly post: Post
  private worlds: Entity[] = []
  quality: Quality = 'high'

  private constructor(canvas: HTMLCanvasElement, app: AppBase) {
    this.canvas = canvas; this.app = app
    this.camera = new Entity('camera')
    this.camera.addComponent('camera', { clearColor: new Color(0, 0, 0, 0), clearColorBuffer: true, fov: 60, nearClip: 0.05, farClip: 80, toneMapping: TONEMAP_ACES })
    app.root.addChild(this.camera)
    // one warm directional key plus flat ambient: the cheapest lighting the toon materials can read (no fill, rim or IBL)
    this.key = new Entity('key')
    this.key.addComponent('light', { type: 'directional', color: col(0xfff4dc), intensity: 1.55, castShadows: false, shadowDistance: 14, shadowResolution: 1024, shadowType: SHADOW_PCF3_32F, shadowBias: 0.06, normalOffsetBias: 0.05, shadowIntensity: 0.7, numCascades: 1 })
    this.key.setEulerAngles(52, 30, 0)
    app.root.addChild(this.key)
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

  /** Quality: high = 1K key-light shadows + vignette/grading post; medium (default) and low = direct render, no shadows, no post. Pixel ratio is always 1. */
  setQuality(q: Quality): void {
    this.quality = q
    this.post.setQuality(q)
    this.key.light!.castShadows = q === 'high'
    this.app.graphicsDevice.maxPixelRatio = 1
  }

  /** A root entity for one game's content; disabled until shown. */
  newWorld(name: string): Entity {
    const w = new Entity(name)
    w.enabled = false
    this.app.root.addChild(w)
    this.worlds.push(w)
    return w
  }
  /** Per-world look: fog, grading, exposure and a flat ambient (raised a little because there is no fill light). Environment lighting is skipped: it costs a cubemap sample per pixel. */
  applyLook(name: string, look: WorldLook): void {
    void name
    this.app.scene.envAtlas = null
    const f = this.app.scene.fog
    if (look.fog) { f.type = FOG_LINEAR; f.color = col(look.fog.color); f.start = look.fog.start; f.end = look.fog.end } else f.type = FOG_NONE
    this.app.scene.exposure = look.exposure ?? 1.15
    const a = col(look.ambient ?? 0x33395a); a.r = Math.min(1, a.r * 1.45); a.g = Math.min(1, a.g * 1.45); a.b = Math.min(1, a.b * 1.45)
    this.app.scene.ambientLight = a
    this.post.grade(look.tint ?? 0xffffff, look.saturation ?? 1.08)
  }
  /** Kept for callers: the single key light is fixed, so there is nothing to aim any more. */
  aimLights(target: { x: number; y: number; z: number }, camPos: { x: number; z: number }): void { void target; void camPos }
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
