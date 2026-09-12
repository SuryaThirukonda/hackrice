import Phaser from 'phaser'
import { pixelCircle, RetroStage } from '../../../retro/RetroStage'
import { RETRO } from '../../../retro/palette'
import { projectLane } from '../../../retro/proj'
import { drawLaneGround } from '../../../retro/mode7'
import { PIN_Z } from '../sim/constants'
import type { AimState } from '../keymap'
import type { Snapshot, V2 } from '../sim/types'

/** Phaser-only low-resolution lane renderer with sim-driven pins, ball and hook preview. */
export class BowlingWorld {
  private readonly stage: RetroStage
  private t = 0
  private sweep = 0

  constructor(scene: Phaser.Scene, crt = true) { this.stage = new RetroStage(scene, 'bowling-lane', crt) }

  show(w: number, h: number): void { this.stage.resize(w, h); this.stage.show() }
  hide(): void { this.stage.destroy() }
  resize(w: number, h: number): void { this.stage.resize(w, h) }
  cheer(): void { this.stage.cheer() }
  shake(power: number): void { this.stage.shake(power) }
  renderFrame(): void { /* Phaser renders the canvas automatically. */ }

  apply(v: Snapshot, aim: AimState | null, dt: number, path: V2[] | null = null): void {
    this.t += Math.max(0, dt)
    const c = this.stage.begin(dt)
    // The generated plate contains a decorative rack. Mask it so only sim pins are visible.
    c.fillStyle = RETRO.ink; c.fillRect(156, 84, 73, 29)
    c.fillStyle = RETRO.navy; c.fillRect(160, 88, 65, 22)
    const cameraZ = v.phase === 'rolling' ? Math.max(-1, v.ballPos.z - 4.2) : v.phase === 'settle' || v.phase === 'frame_end' ? PIN_Z - 4.2 : -1
    const cameraX = v.phase === 'rolling' ? v.ballPos.x * 0.55 : 0
    drawLaneGround(c, cameraX, cameraZ)

    if (aim && path && v.phase === 'aim') {
      for (let i = 0; i < path.length; i += 3) {
        const p = projectLane(path[i].x - cameraX, path[i].z, cameraZ)
        if (!p.visible) continue
        c.fillStyle = v.swayLocked ? RETRO.lime : RETRO.gold
        const q = Math.max(1, Math.round(p.scale * 2))
        c.fillRect(Math.round(p.x - q / 2), Math.round(p.y), q, q)
      }
    }

    for (const pin of [...v.pins].sort((a, b) => b.z - a.z)) {
      if (!pin.standing && !pin.down) continue
      const p = projectLane(pin.x - cameraX, pin.z, cameraZ)
      this.drawPin(c, p.x, p.y, p.scale, pin.down, pin.index)
    }

    const ballZ = v.phase === 'aim' && aim ? -1 : v.ballPos.z
    const ballX = v.phase === 'aim' && aim ? aim.lanePos : v.ballPos.x
    const bp = projectLane(ballX - cameraX, ballZ, cameraZ)
    if (bp.visible && (v.phase === 'aim' || v.phase === 'rolling' || v.phase === 'settle')) {
      const r = Math.max(2, 10 * bp.scale)
      pixelCircle(c, bp.x, bp.y - r, r, RETRO.blue)
      c.fillStyle = RETRO.ink
      c.fillRect(Math.round(bp.x - r * 0.25), Math.round(bp.y - r * 1.35), Math.max(1, Math.round(r * 0.18)), Math.max(1, Math.round(r * 0.18)))
      c.fillRect(Math.round(bp.x + r * 0.08), Math.round(bp.y - r * 1.25), Math.max(1, Math.round(r * 0.16)), Math.max(1, Math.round(r * 0.16)))
    }

    if (v.phase === 'aim' && aim) this.drawHands(c, ballX)
    if (v.phase === 'settle' || v.phase === 'frame_end') {
      this.sweep = Math.min(1, this.sweep + dt * 2.2)
      const y = 82 + Math.sin(this.sweep * Math.PI) * 28
      c.fillStyle = RETRO.ink; c.fillRect(150, Math.round(y), 84, 7)
      c.fillStyle = RETRO.steel; c.fillRect(153, Math.round(y + 2), 78, 3)
    } else this.sweep = 0
    this.stage.end(dt)
  }

  private drawPin(c: CanvasRenderingContext2D, x: number, y: number, scale: number, down: boolean, seed: number): void {
    const h = Math.max(5, Math.round(25 * scale)), w = Math.max(3, Math.round(9 * scale))
    c.save(); c.translate(Math.round(x), Math.round(y)); if (down) c.rotate((seed % 2 ? -1 : 1) * 1.1)
    c.fillStyle = RETRO.ink; c.fillRect(-Math.ceil(w / 2) - 1, -h - 1, w + 2, h + 2)
    c.fillStyle = RETRO.white; c.fillRect(-Math.floor(w / 2), -h, w, h)
    c.fillStyle = RETRO.red; c.fillRect(-Math.floor(w / 2), -Math.round(h * 0.68), w, Math.max(1, Math.round(scale * 2)))
    c.fillStyle = RETRO.paper; c.fillRect(-Math.floor(w * 0.35), -h - 2, Math.max(2, Math.round(w * 0.7)), 3)
    c.restore()
  }

  private drawHands(c: CanvasRenderingContext2D, laneX: number): void {
    const shift = laneX * 34, bob = Math.round(Math.sin(this.t * 3) * 2)
    c.fillStyle = RETRO.skinDark; c.fillRect(118 + shift, 197 + bob, 50, 19); c.fillRect(216 + shift, 197 + bob, 50, 19)
    c.fillStyle = RETRO.skin; c.fillRect(124 + shift, 190 + bob, 43, 24); c.fillRect(217 + shift, 190 + bob, 43, 24)
    c.fillStyle = RETRO.red; c.fillRect(118 + shift, 207 + bob, 47, 9); c.fillRect(219 + shift, 207 + bob, 47, 9)
  }

  pinHitFx(x: number, z: number): void { const p = projectLane(x, z); this.stage.burst(p.x, p.y - 4, [RETRO.white, RETRO.gold, RETRO.red], 12) }
  strikeFx(): void { this.stage.cheer(1.4); this.stage.flash(0.12); for (const x of [130, 192, 254]) this.stage.burst(x, 103, [RETRO.gold, RETRO.cyan, RETRO.red], 16) }
  sweepDust(): void { this.stage.burst(192, 108, [RETRO.paper, RETRO.sand], 16) }
}
