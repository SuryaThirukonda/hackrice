// A boxer drawn from shapes (no external art): container of legs, trunks, torso, head, headgear, gloves; tweens per state.
import Phaser from 'phaser'
import type { Fighter } from '../sims/boxing'

export class BoxerView extends Phaser.GameObjects.Container {
  private shadow: Phaser.GameObjects.Ellipse
  private legL: Phaser.GameObjects.Rectangle
  private legR: Phaser.GameObjects.Rectangle
  private torso: Phaser.GameObjects.Rectangle
  private trunks: Phaser.GameObjects.Rectangle
  private head: Phaser.GameObjects.Arc
  private eye1: Phaser.GameObjects.Arc
  private eye2: Phaser.GameObjects.Arc
  private brow: Phaser.GameObjects.Rectangle
  private gear: Phaser.GameObjects.Rectangle
  private gloveLead: Phaser.GameObjects.Arc
  private gloveRear: Phaser.GameObjects.Arc
  private trail: Phaser.GameObjects.Graphics
  private stars: Phaser.GameObjects.Text
  private rig: Phaser.GameObjects.Container
  private walkT = 0
  private flashT = 0
  private baseColor: number
  facing: 1 | -1 = 1
  H = 220

  constructor(scene: Phaser.Scene, x: number, y: number, color: number, accent: number, facing: 1 | -1) {
    super(scene, x, y)
    this.baseColor = color; this.facing = facing
    const H = this.H
    this.shadow = scene.add.ellipse(0, 8, 90, 26, 0x000000, 0.35)
    this.rig = scene.add.container(0, 0)
    this.legL = scene.add.rectangle(-14, -H * 0.09, 18, H * 0.18, 0x22283a).setOrigin(0.5, 0)
    this.legR = scene.add.rectangle(14, -H * 0.09, 18, H * 0.18, 0x22283a).setOrigin(0.5, 0)
    this.trunks = scene.add.rectangle(0, -H * 0.2, 62, H * 0.11, accent)
    this.torso = scene.add.rectangle(0, -H * 0.42, 60, H * 0.36, color).setStrokeStyle(4, 0x1a1f2b)
    this.head = scene.add.circle(0, -H * 0.72, H * 0.14, 0xf6c9a0).setStrokeStyle(4, 0x1a1f2b)
    this.gear = scene.add.rectangle(0, -H * 0.72 - H * 0.12, H * 0.28, H * 0.08, accent)
    this.eye1 = scene.add.circle(0, 0, 5, 0x1a1f2b); this.eye2 = scene.add.circle(0, 0, 4, 0x1a1f2b)
    this.brow = scene.add.rectangle(0, -H * 0.72 - 12, 30, 5, 0x1a1f2b)
    this.trail = scene.add.graphics()
    this.gloveRear = scene.add.circle(0, 0, H * 0.11, 0xd8452e).setStrokeStyle(4, 0x1a1f2b)
    this.gloveLead = scene.add.circle(0, 0, H * 0.11, 0xd8452e).setStrokeStyle(4, 0x1a1f2b)
    this.stars = scene.add.text(0, -H * 0.95, '★ ★ ★', { fontFamily: 'Nunito, sans-serif', fontSize: '22px', color: '#ffe08a' }).setOrigin(0.5).setVisible(false)
    this.rig.add([this.legL, this.legR, this.trunks, this.torso, this.head, this.gear, this.eye1, this.eye2, this.brow, this.gloveRear, this.trail, this.gloveLead, this.stars])
    this.add([this.shadow, this.rig])
    scene.add.existing(this as unknown as Phaser.GameObjects.GameObject)
    this.setDepth(10)
  }

  /** Called every frame with the sim fighter and the ring x mapping already applied to this.x by the scene. */
  render(f: Fighter, dt: number, reachPx: number): void {
    const H = this.H, fc = f.facing
    this.facing = fc
    const moving = f.moveDir !== 0 && (f.state === 'idle' || f.state === 'block' || f.state === 'recover')
    this.walkT += dt * (moving ? 9 : 0)
    // targets by state
    let lead = { x: fc * 34, y: -H * 0.5 }, rear = { x: fc * 12, y: -H * 0.48 }, lean = 0, rot = 0, gcol = 0xd8452e, bob = Math.sin(this.scene.time.now / 160) * 3
    switch (f.state) {
      case 'windup': { const k = 1 - Math.min(1, f.stateT / (f.punch === 'jab' ? 0.12 : 0.22)); rear = { x: -fc * (60 + 30 * k), y: -H * 0.5 }; lead = { x: fc * (30 - 8 * k), y: -H * 0.5 }; lean = -0.25 - 0.15 * k; gcol = 0xffe08a; break }
      case 'active': lead = { x: fc * reachPx * (f.punch === 'jab' ? 1.05 : 1.15), y: -H * (f.punch === 'uppercut' ? 0.72 : 0.52) }; rear = { x: -fc * 20, y: -H * 0.45 }; lean = 0.55; break
      case 'recover': lead = { x: fc * 50, y: -H * 0.5 }; lean = 0.15; break
      case 'block': lead = { x: fc * 22, y: -H * 0.68 }; rear = { x: fc * 6, y: -H * 0.7 }; gcol = 0x2ba1e8; lean = -0.1; break
      case 'parry': lead = { x: fc * 46, y: -H * 0.62 }; gcol = 0xffffff; lean = 0.2; break
      case 'dodge': lean = -0.9; lead = { x: fc * 20, y: -H * 0.55 }; break
      case 'stagger': lean = -0.5; rot = Math.sin(this.scene.time.now / 40) * 0.08; lead = { x: fc * 20, y: -H * 0.4 }; rear = { x: -fc * 30, y: -H * 0.4 }; break
      case 'stunned': lean = -0.2; rot = Math.sin(this.scene.time.now / 120) * 0.12; lead = { x: fc * 10, y: -H * 0.35 }; rear = { x: -fc * 10, y: -H * 0.35 }; break
      case 'down': rot = fc * 1.4; lean = 0; bob = 0; lead = { x: fc * 40, y: -H * 0.3 }; rear = { x: -fc * 20, y: -H * 0.3 }; break
      case 'victory': lead = { x: fc * 30, y: -H * 0.95 }; rear = { x: -fc * 30, y: -H * 0.95 }; bob = Math.sin(this.scene.time.now / 90) * 8; break
    }
    if (f.stamina < 30 && f.state === 'idle') bob *= 0.5
    // smooth toward targets
    const s = Math.min(1, dt * 18)
    this.gloveLead.x += (lead.x - this.gloveLead.x) * s; this.gloveLead.y += (lead.y - this.gloveLead.y) * s
    this.gloveRear.x += (rear.x - this.gloveRear.x) * s; this.gloveRear.y += (rear.y - this.gloveRear.y) * s
    this.rig.rotation += (rot - this.rig.rotation) * Math.min(1, dt * 12)
    this.rig.y = bob
    const leanPx = lean * 14
    this.torso.x += (leanPx * 0.6 - this.torso.x) * s; this.head.x += (leanPx - this.head.x) * s; this.gear.x = this.head.x; this.brow.x = this.head.x + fc * 4
    this.trunks.x = this.torso.x * 0.5
    // walk cycle
    const w = Math.sin(this.walkT)
    this.legL.scaleY = moving ? 1 - 0.18 * Math.max(0, w) : 1; this.legR.scaleY = moving ? 1 - 0.18 * Math.max(0, -w) : 1
    this.legL.x = -14 + (moving ? 6 * w : 0); this.legR.x = 14 - (moving ? 6 * w : 0)
    // face
    this.eye1.setPosition(this.head.x + fc * 12, this.head.y - 2); this.eye2.setPosition(this.head.x - fc * 4, this.head.y - 2)
    const angry = f.state === 'windup' || f.state === 'active'
    this.brow.rotation = angry ? fc * 0.35 : 0
    this.eye1.setVisible(f.state !== 'down' && f.state !== 'stunned'); this.eye2.setVisible(f.state !== 'down' && f.state !== 'stunned')
    this.stars.setVisible(f.state === 'stunned'); this.stars.rotation = this.scene.time.now / 300
    // glove color + motion trail while active
    this.gloveLead.fillColor = gcol; this.gloveRear.fillColor = gcol
    this.trail.clear()
    if (f.state === 'active') {
      this.trail.lineStyle(10, 0xffffff, 0.35); this.trail.lineBetween(this.gloveLead.x - fc * reachPx * 0.6, this.gloveLead.y + 4, this.gloveLead.x, this.gloveLead.y)
    }
    // hit flash
    this.flashT = Math.max(0, this.flashT - dt * 4)
    const fl = this.flashT
    const tint = Phaser.Display.Color.IntegerToColor(this.baseColor).lighten(Math.round(fl * 60)).color
    this.torso.fillColor = tint
    this.head.fillColor = fl > 0 ? 0xffffff : 0xf6c9a0
    this.shadow.setScale(f.state === 'down' ? 1.6 : 1, 1)
  }

  flash(): void { this.flashT = 1 }
}
