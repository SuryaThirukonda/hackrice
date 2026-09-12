import Phaser from 'phaser'
import { pixelCircle, pixelLine, RetroStage } from '../../../retro/RetroStage'
import { COURSE_PALETTE, RETRO } from '../../../retro/palette'
import { projectGolf } from '../../../retro/proj'
import { CourseRaster, drawMode7, type Mode7Camera } from '../../../retro/mode7'
import type { GolfSnapshot, Hole, V2, V3 } from '../sim/types'

export type CamMode = 'aim' | 'flight' | 'top'
export interface AimState { heading: number; putting: boolean; top: boolean }

/** Phaser-only golf renderer: generated landscape plate plus sim-projected ball, trail, props and map view. */
export class GolfWorld {
  private readonly stage: RetroStage
  private preview: V3[] | null = null
  private raster: CourseRaster | null = null
  private rasterHole: Hole | null = null
  private t = 0

  constructor(scene: Phaser.Scene, crt = true) { this.stage = new RetroStage(scene, 'golf-meadow', crt) }

  show(w: number, h: number): void { this.stage.resize(w, h); this.stage.show() }
  hide(): void { this.stage.destroy() }
  resize(w: number, h: number): void { this.stage.resize(w, h) }
  setPreview(trail: V3[] | null): void { this.preview = trail }

  apply(v: GolfSnapshot, aim: AimState, dt: number): void {
    this.t += Math.max(0, dt)
    const c = this.stage.begin(dt, COURSE_PALETTE[v.holeData.theme].sky)
    const pal = COURSE_PALETTE[v.holeData.theme]
    if (v.holeData.theme === 'canyon') { c.fillStyle = 'rgba(171,72,30,0.34)'; c.fillRect(0, 0, 384, 216) }
    if (v.holeData.theme === 'neon') { c.fillStyle = 'rgba(9,4,35,0.70)'; c.fillRect(0, 0, 384, 216) }

    if (aim.top) this.drawTop(c, v)
    else {
      const ball = v.balls[v.current]
      const moving = v.phase === 'flying' || v.phase === 'rolling'
      const speed = Math.hypot(ball.vel.x, ball.vel.z)
      const heading = moving && speed > 0.2 ? Math.atan2(ball.vel.x, ball.vel.z) * 180 / Math.PI : aim.heading
      const rad = heading * Math.PI / 180
      const behind = moving ? 9 : aim.putting ? 2.4 : 3.2
      const camera: Mode7Camera = { x: ball.pos.x - Math.sin(rad) * behind, y: moving ? Math.max(3.5, ball.pos.y + 6) : 1.6, z: ball.pos.z - Math.cos(rad) * behind, heading }
      if (this.rasterHole !== v.holeData || !this.raster) { this.rasterHole = v.holeData; this.raster = new CourseRaster(v.holeData) }
      drawMode7(c, this.raster, camera, { ob: RETRO.ink, rough: pal.rough, fairway: pal.fairway, green: pal.green, bunker: pal.sand, water: pal.water })
      this.drawProps(c, v.holeData, camera)
      if (this.preview && v.phase === 'aim') {
        for (let i = 2; i < this.preview.length; i += 4) {
          const p = projectGolf(this.preview[i], camera)
          if (p.visible && p.y > 75 && p.y < 205) { c.fillStyle = RETRO.gold; c.fillRect(Math.round(p.x), Math.round(p.y), 2, 2) }
        }
      }
      const p = projectGolf(ball.pos, camera)
      if (p.visible) {
        const r = Math.max(moving ? 4 : 3, Math.min(8, p.scale * 1.6))
        c.fillStyle = 'rgba(5,12,28,0.45)'; c.fillRect(Math.round(p.x - r), Math.round(p.y + r), Math.round(r * 2), 2)
        pixelCircle(c, p.x, p.y, r, v.current === 'a' ? RETRO.white : RETRO.gold)
      }
      if (v.phase === 'aim') this.drawClub(c, aim.putting)
      const cup = projectGolf({ x: v.holeData.cup.x, y: 0, z: v.holeData.cup.z }, camera)
      if (cup.visible && cup.y > 84 && cup.y < 212) {
        const pole = Math.max(5, Math.min(30, cup.scale * 5))
        c.fillStyle = RETRO.white; c.fillRect(Math.round(cup.x), Math.round(cup.y - pole), Math.max(1, Math.round(cup.scale * 0.35)), Math.round(pole))
        c.fillStyle = pal.accent; c.fillRect(Math.round(cup.x + 1), Math.round(cup.y - pole), Math.max(3, Math.round(cup.scale * 3)), Math.max(2, Math.round(cup.scale * 1.5)))
      }
    }
    this.stage.end(dt)
  }

  private drawClub(c: CanvasRenderingContext2D, putting: boolean): void {
    const swing = Math.sin(this.t * 1.7) * 2
    c.fillStyle = RETRO.skinDark; c.fillRect(121, 198, 59, 18); c.fillRect(204, 198, 59, 18)
    c.fillStyle = RETRO.white; c.fillRect(126, 189, 51, 25); c.fillRect(207, 189, 51, 25)
    pixelLine(c, 205 + swing, 204, 219 + swing, putting ? 151 : 143, RETRO.steel, 4)
    c.fillStyle = RETRO.ink; c.fillRect(207 + swing, putting ? 146 : 137, putting ? 23 : 31, 8)
    c.fillStyle = RETRO.grey; c.fillRect(209 + swing, putting ? 148 : 139, putting ? 19 : 27, 4)
  }

  private drawProps(c: CanvasRenderingContext2D, hole: Hole, camera: Mode7Camera): void {
    const pal = COURSE_PALETTE[hole.theme]
    for (const t of hole.trees) {
      const p = projectGolf({ x: t.x, y: 0, z: t.z }, camera)
      if (!p.visible || p.scale < 0.1 || p.y < 78) continue
      const h = Math.max(5, Math.min(32, p.scale * 5))
      c.fillStyle = RETRO.brown; c.fillRect(Math.round(p.x - 1), Math.round(p.y - h), 3, Math.round(h))
      pixelCircle(c, p.x, p.y - h, Math.max(3, h * 0.42), pal.rough)
    }
    for (const prop of hole.props ?? []) {
      const p = projectGolf({ x: prop.p.x, y: 0, z: prop.p.z }, camera)
      if (!p.visible || p.y < 78) continue
      const s = Math.max(2, Math.min(18, p.scale * 2.5 * (prop.s ?? 1)))
      c.fillStyle = prop.kind === 'cactus' ? pal.fairway : prop.kind === 'tower' || prop.kind === 'lamp' ? RETRO.purple : RETRO.brown
      c.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s * 2.4), Math.round(s), Math.round(s * 2.4))
      if (prop.kind === 'lamp' || prop.kind === 'tower') { c.fillStyle = pal.accent; c.fillRect(Math.round(p.x - 2), Math.round(p.y - s * 2.7), 4, 3) }
    }
  }

  private drawTop(c: CanvasRenderingContext2D, v: GolfSnapshot): void {
    const h = v.holeData, pal = COURSE_PALETTE[h.theme]
    c.fillStyle = RETRO.ink; c.fillRect(0, 0, 384, 216)
    const xs = h.course.map((p) => p.x), zs = h.course.map((p) => p.z)
    const minX = Math.min(...xs) - 8, maxX = Math.max(...xs) + 8, minZ = Math.min(...zs) - 8, maxZ = Math.max(...zs) + 8
    const k = Math.min(330 / (maxX - minX), 190 / (maxZ - minZ))
    const px = (p: V2) => 192 + (p.x - (minX + maxX) / 2) * k
    const py = (p: V2) => 203 - (p.z - minZ) * k
    const poly = (pts: V2[], fill: string) => { c.fillStyle = fill; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(px(p), py(p)) : c.moveTo(px(p), py(p))); c.closePath(); c.fill() }
    poly(h.course, pal.rough); poly(h.fairway, pal.fairway)
    for (const w of h.water) poly(w, pal.water)
    for (const b of h.bunkers) { c.fillStyle = pal.sand; c.beginPath(); c.arc(px(b.c), py(b.c), Math.max(2, b.r * k), 0, Math.PI * 2); c.fill() }
    c.fillStyle = pal.green; c.beginPath(); c.arc(px(h.cup), py(h.cup), Math.max(3, h.greenR * k), 0, Math.PI * 2); c.fill()
    for (const side of ['b', 'a'] as const) {
      const b = v.balls[side]; if (b.holed) continue
      pixelCircle(c, px(b.pos), py(b.pos), 3, side === 'a' ? RETRO.white : RETRO.gold)
    }
    c.fillStyle = pal.accent; c.fillRect(Math.round(px(h.cup)), Math.round(py(h.cup) - 9), 2, 9); c.fillRect(Math.round(px(h.cup) + 2), Math.round(py(h.cup) - 9), 7, 4)
    c.fillStyle = RETRO.white; c.font = '8px monospace'; c.fillText('TOP VIEW', 8, 13)
  }
}
