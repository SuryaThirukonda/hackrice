import type { Entity } from 'playcanvas'
import { Engine3D } from '../../../engine3d/Engine3D'
import { pivot } from '../../../engine3d/primitives'
import { Spring3, type V3 } from '../../../engine3d/springs'
import type { GolfSnapshot } from '../sim/types'
import { CourseScene, MX } from './CourseScene'

export type CamMode = 'aim' | 'flight' | 'top'
/** What the scene knows that the sim does not: the player's aim heading (compass deg), whether this is a putt, and the Tab map view. */
export interface AimState { heading: number; putting: boolean; top: boolean }

const TOP_ALT = 60
const RAD = Math.PI / 180

/** Everything 3D for one golf round: the course, both balls, the aim preview and the camera. */
export class GolfWorld {
  root: Entity
  course: CourseScene
  camPivot: Entity
  mode: CamMode = 'aim'
  private engine: Engine3D
  private cam: Entity
  private pos = new Spring3(30)
  private look = new Spring3(45)
  private t = 0
  private first = true
  private saved: { fov: number; near: number; far: number }
  private stat: number

  constructor(engine: Engine3D) {
    this.engine = engine
    this.root = engine.newWorld('golf')
    this.stat = engine.batchGroup('golf-static', false, 120)
    this.course = new CourseScene(this.root, engine.app.graphicsDevice, this.stat)
    this.camPivot = pivot(this.root, 'golfCam')
    const cam = engine.camera
    this.cam = cam
    cam.parent?.removeChild(cam)
    cam.setLocalPosition(0, 0, 0); cam.setLocalEulerAngles(0, 0, 0)
    this.camPivot.addChild(cam)
    const c = cam.camera!
    this.saved = { fov: c.fov, near: c.nearClip, far: c.farClip }
    c.fov = 48; c.nearClip = 0.3; c.farClip = 1500 // holes are up to 500 m long; the shared camera defaults to an 80 m ring
  }

  show(w: number, h: number): void {
    this.engine.show(this.root, w, h)
    this.engine.applyLook('golf', { sky: { top: '#3fb6ff', horizon: '#ffe6b0', ground: '#2f7d3a', sun: { x: 0.7, y: 0.3, color: 'rgba(255,240,200,1)' } }, fog: { color: 0xcfe9ff, start: 160, end: 900 }, tint: 0xfff8ee, saturation: 1.12, exposure: 1.2, ambient: 0x4a5a7a })
  }
  hide(): void {
    const c = this.cam.camera
    if (c) { c.fov = this.saved.fov; c.nearClip = this.saved.near; c.farClip = this.saved.far }
    this.engine.hide()
  }
  resize(w: number, h: number): void { this.engine.resize(w, h) }
  setPreview(trail: V3[] | null): void { this.course.setPreview(trail) }

  /** Drive the course and the camera from a snapshot and render. */
  apply(v: GolfSnapshot, aim: AimState, dtIn: number): void {
    const dt = Math.min(0.05, Math.max(0, dtIn))
    this.t += dt
    if (this.course.hole !== v.holeData) { this.course.setHole(v.holeData); this.engine.generateBatches([this.stat]) }
    this.course.setWind(v.wind)
    this.course.setBalls(v)
    const ball = v.balls[v.current], b = ball.pos, cup = v.holeData.cup
    const moving = v.phase === 'flying' || v.phase === 'rolling'
    const mode: CamMode = moving ? 'flight' : aim.top ? 'top' : 'aim'
    let p: V3, l: V3, up: V3 = { x: 0, y: 1, z: 0 }
    if (mode === 'top') {
      p = { x: b.x, y: TOP_ALT, z: b.z }; l = { x: b.x, y: 0, z: b.z }; up = { x: 0, y: 0, z: 1 } // north up on screen
    } else if (mode === 'flight') {
      const sp = Math.hypot(ball.vel.x, ball.vel.z)
      const dx = sp > 0.5 ? ball.vel.x / sp : Math.sin(aim.heading * RAD), dz = sp > 0.5 ? ball.vel.z / sp : Math.cos(aim.heading * RAD)
      // above and behind, looking a little past the ball so the landing area stays in frame at the top of the flight
      p = { x: b.x - dx * 9, y: b.y + 7, z: b.z - dz * 9 }
      l = { x: b.x + dx * 6, y: Math.max(0, b.y - 2), z: b.z + dz * 6 }
    } else {
      // shoulder height behind the ball, stepped off to one side so the fairway runs off-axis; near turf stays in frame
      const dx = Math.sin(aim.heading * RAD), dz = Math.cos(aim.heading * RAD), rx = dz, rz = -dx
      if (aim.putting) { p = { x: b.x - dx * 2.4 + rx * 0.45, y: 1.5, z: b.z - dz * 2.4 + rz * 0.45 }; l = { x: cup.x, y: 0, z: cup.z } }
      else { p = { x: b.x - dx * 3.0 + rx * 0.9, y: 1.45, z: b.z - dz * 3.0 + rz * 0.9 }; l = { x: b.x + dx * 18, y: 0.2, z: b.z + dz * 18 } }
    }
    // snap in and out of the map view (a spring through a vertical look direction would roll the camera)
    if (this.first || mode === 'top' || this.mode === 'top') { this.pos.set(p); this.look.set(l) } else { this.pos.to(p, dt); this.look.to(l, dt) }
    this.mode = mode; this.first = false
    const cp = this.pos.get(), cl = this.look.get()
    this.camPivot.setPosition(cp.x * MX, cp.y, cp.z) // camera maths happens in sim space; only the final x is mirrored (see MX)
    this.camPivot.lookAt(cl.x * MX, cl.y, cl.z, up.x, up.y, up.z)
    const wp = this.camPivot.getPosition()
    this.course.update(this.t, dt, { x: wp.x, y: wp.y, z: wp.z })
    this.engine.renderFrame()
  }
}
