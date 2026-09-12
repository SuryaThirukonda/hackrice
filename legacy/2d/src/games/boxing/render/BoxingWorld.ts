import Phaser from 'phaser'
import { P } from '../../../theme'
import { pixelCircle, pixelLine, RetroStage } from '../../../retro/RetroStage'
import { RETRO } from '../../../retro/palette'
import { clamp } from '../../../retro/proj'
import type { FighterView, Snapshot } from '../sim/types'

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`

/** Phaser-only 384x216 boxing renderer. The deterministic sim remains the sole gameplay authority. */
export class BoxingWorld {
  private readonly stage: RetroStage
  private readonly opponentColor: number
  private readonly spectator: boolean
  private t = 0
  private hitPulse: 'a' | 'b' | null = null

  constructor(scene: Phaser.Scene, opponentColor = P.red, spectator = false, crt = true) {
    this.opponentColor = opponentColor
    this.spectator = spectator
    this.stage = new RetroStage(scene, 'boxing-arena', crt)
  }

  show(w: number, h: number): void { this.stage.resize(w, h); this.stage.show() }
  hide(): void { this.stage.destroy() }
  resize(w: number, h: number): void { this.stage.resize(w, h) }
  cheer(): void { this.stage.cheer() }
  shake(power: number): void { this.stage.shake(power) }
  punchKick(): void { this.stage.shake(0.22) }
  hitFx(_v: Snapshot, side: 'a' | 'b', heavy: boolean): void { this.hitPulse = side; this.stage.burst(side === 'a' ? 135 : 249, 116, [RETRO.white, RETRO.cyan], heavy ? 24 : 14) }
  knockdownFx(_v: Snapshot, side: 'a' | 'b'): void { this.stage.burst(side === 'a' ? 132 : 252, 174, [RETRO.sand, RETRO.paper, RETRO.gold], 28); this.stage.flash(0.12) }
  guardBreakFx(_v: Snapshot, side: 'a' | 'b'): void { this.stage.burst(side === 'a' ? 142 : 242, 122, [RETRO.gold, RETRO.red, RETRO.white], 22) }
  confetti(): void { for (const x of [80, 192, 304]) this.stage.burst(x, 70, [RETRO.gold, RETRO.red, RETRO.cyan, RETRO.white], 24) }

  apply(v: Snapshot, dt: number, _playerDown: boolean): void {
    this.t += Math.max(0, dt)
    const c = this.stage.begin(dt)
    c.fillStyle = 'rgba(12,35,88,0.14)'; c.fillRect(0, 139, 384, 77)
    if (this.spectator) {
      const sep = clamp(v.dist * 18, 48, 88)
      this.drawFighter(c, 192 - sep / 2 + v.a.pos.x * 9, 184, 0.78, v.a, hex(P.blue), false)
      this.drawFighter(c, 192 + sep / 2 + v.b.pos.x * 9, 184, 0.78, v.b, hex(this.opponentColor), true)
    } else {
      const scale = clamp(1.5 - v.dist * 0.18, 0.78, 1.18)
      const swayX = (v.b.head.x - v.a.head.x) * 24 + (v.b.pos.x - v.a.pos.x) * 11
      const feet = 181 + v.b.head.y * 16
      this.drawFighter(c, 192 + swayX, feet, scale, v.b, hex(this.opponentColor), true)
      this.drawPlayerGloves(c, v.a)
    }
    if (this.hitPulse) { c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(0, 0, 384, 216); this.hitPulse = null }
    this.stage.end(dt)
  }

  private drawFighter(c: CanvasRenderingContext2D, x: number, feet: number, s: number, f: FighterView, color: string, faceLeft: boolean): void {
    c.save(); c.translate(Math.round(x), Math.round(feet)); c.scale(s, s)
    let lean = 0, duck = 0, punch = 0
    if (f.state === 'dodge') { duck = f.dodge === 'duck' ? 17 * Math.sin(f.progress * Math.PI) : 0; lean = f.dodge === 'swayL' ? -12 : f.dodge === 'swayR' ? 12 : 0 }
    if (f.state === 'hitstun' || f.state === 'stagger') lean = (faceLeft ? -1 : 1) * 8 * (1 - f.progress)
    const down = f.state === 'down' || f.state === 'getup' || f.hp <= 0
    if (down) { c.translate(faceLeft ? 10 : -10, 0); c.rotate((faceLeft ? 1 : -1) * 1.25); duck = 24 }
    c.translate(lean, duck)
    c.fillStyle = 'rgba(4,10,24,0.5)'; c.fillRect(-21, -3, 42, 5)
    c.fillStyle = RETRO.ink; c.fillRect(-17, -42, 12, 42); c.fillRect(5, -42, 12, 42)
    c.fillStyle = RETRO.paper; c.fillRect(-16, -39, 10, 24); c.fillRect(6, -39, 10, 24)
    c.fillStyle = RETRO.blueDark; c.fillRect(-23, -66, 46, 27); c.fillStyle = RETRO.white; c.fillRect(-23, -66, 46, 5)
    c.fillStyle = RETRO.ink; c.fillRect(-22, -108, 44, 45)
    c.fillStyle = RETRO.skin; c.fillRect(-19, -106, 38, 42); c.fillStyle = RETRO.skinLight; c.fillRect(-13, -104, 10, 29)
    c.fillStyle = RETRO.skinDark; c.fillRect(-13, -132, 27, 29); c.fillStyle = RETRO.skin; c.fillRect(-11, -130, 23, 25)
    c.fillStyle = RETRO.ink; c.fillRect(-12, -134, 25, 7); c.fillRect(-7, -119, 4, 3); c.fillRect(5, -119, 4, 3); c.fillRect(-4, -109, 10, 3)
    const active = f.state === 'windup' || f.state === 'active' || f.state === 'recover'
    punch = active ? (f.state === 'windup' ? f.progress : f.state === 'active' ? 1 : 1 - f.progress) : 0
    const guardY = f.guard ? -119 : -91
    const leftExt = f.punch === 'jab' ? punch * 30 : 0, rightExt = f.punch === 'cross' ? punch * 34 : 0
    const dir = faceLeft ? -1 : 1
    pixelLine(c, -17, -96, -29 - dir * leftExt, guardY - leftExt * 0.25, RETRO.skin, 10)
    pixelLine(c, 17, -96, 29 - dir * rightExt, guardY - rightExt * 0.25, RETRO.skin, 10)
    pixelCircle(c, -31 - dir * leftExt, guardY - leftExt * 0.25, 11, color)
    pixelCircle(c, 31 - dir * rightExt, guardY - rightExt * 0.25, 11, color)
    c.restore()
  }

  private drawPlayerGloves(c: CanvasRenderingContext2D, f: FighterView): void {
    const sway = f.dodge === 'swayL' && f.state === 'dodge' ? -16 : f.dodge === 'swayR' && f.state === 'dodge' ? 16 : 0
    const duck = f.dodge === 'duck' && f.state === 'dodge' ? 13 : 0
    let lx = 113 + sway, ly = 194 + duck, rx = 271 + sway, ry = 194 + duck
    if (f.guard) { lx = 157 + sway; rx = 227 + sway; ly = ry = 169 + duck }
    const active = f.state === 'windup' || f.state === 'active' || f.state === 'recover'
    const p = active ? (f.state === 'windup' ? f.progress : f.state === 'active' ? 1 : 1 - f.progress) : 0
    if (f.punch === 'jab') { lx += 35 * p; ly -= 57 * p }
    if (f.punch === 'cross') { rx -= 35 * p; ry -= 57 * p }
    pixelLine(c, lx - 16, 218, lx, ly + 8, RETRO.skin, 16); pixelLine(c, rx + 16, 218, rx, ry + 8, RETRO.skin, 16)
    pixelCircle(c, lx, ly, 23, RETRO.red); pixelCircle(c, rx, ry, 23, RETRO.red)
    c.fillStyle = RETRO.white; c.fillRect(lx - 20, ly + 13, 40, 7); c.fillRect(rx - 20, ry + 13, 40, 7)
  }
}
