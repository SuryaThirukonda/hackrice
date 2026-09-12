import { Container, Graphics, Text, type Application } from 'pixi.js'
import { lerp, type Effects, type Scene, type Tick } from './Scene'

interface F {
  id: string; name: string; hp: number; stamina: number; guard: boolean; state: string; knockdowns: number
  x?: number; facing?: number; action?: string | null; phase?: string | null; progress?: number; reach?: number; moving?: number; fatigue?: number
}
interface Ev { kind: string; who: string; type?: string; result?: string; ko?: boolean; kb?: number; dir?: number; round?: number }

/** One fighter's render state. The scene interpolates toward the server tick; it never simulates the fight. */
class Puppet {
  g = new Graphics()
  x = 0; y = 0; tx = 0; ty = 0
  lead = { x: 0, y: 0 }; rear = { x: 0, y: 0 }
  state = 'idle'; phase: string | null = null; action: string | null = null; progress = 0; reach = 0.4
  flash = 0; stars = 0; lean = 0; lie = 0; wobble = 0; slide = 0; spark = 0; guardPulse = 0; moving = 0; fatigue = 0; stamina = 100
  facing: 1 | -1; color: number; accent: number
  constructor(facing: 1 | -1, color: number, accent: number) { this.facing = facing; this.color = color; this.accent = accent }
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: number; g: number }
const MAX_PARTICLES = 64

/** Boxing ring under spotlights with two chunky cartoon fighters. Renders positions, punch phases and hit reactions from tick.fighters/events. */
export class BoxingScene implements Scene {
  private root = new Container()
  private bg = new Graphics()
  private ring = new Graphics()
  private crowd = new Graphics()
  private floor = new Graphics()
  private fx = new Graphics()
  private pow = new Text({ text: '', style: { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: 64, fill: 0xffe08a, stroke: { color: 0x5a2f0e, width: 8 } } })
  private stamp = new Text({ text: '', style: { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: 92, fill: 0xffffff, stroke: { color: 0xd8452e, width: 10 } } })
  private a = new Puppet(1, 0x2ba1e8, 0x1d7fc0)
  private b = new Puppet(-1, 0xee6a5f, 0xb3261e)
  private ids: string[] = []
  private w = 800; private h = 600; private t = 0
  private effects: Effects | null
  private powT = 0; private stampT = 0
  private particles: Particle[] = []
  private ringHalf = 1
  private bellFlash = 0

  constructor(fx?: Effects) {
    this.effects = fx ?? null
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 3, color: 0xffffff, g: 0 })
  }

  mount(_app: Application, root: Container, size: { w: number; h: number }): void {
    root.addChild(this.root)
    this.root.addChild(this.bg, this.crowd, this.ring, this.floor, this.b.g, this.a.g, this.fx, this.pow, this.stamp)
    this.pow.anchor.set(0.5); this.pow.alpha = 0; this.stamp.anchor.set(0.5); this.stamp.alpha = 0
    this.resize(size)
  }

  resize(size: { w: number; h: number }): void {
    this.w = size.w; this.h = size.h
    this.drawBg(); this.drawRing(); this.drawCrowd(0)
    this.a.ty = this.b.ty = this.h * 0.64
    this.a.tx = this.ringX(-0.5); this.b.tx = this.ringX(0.5)
    this.a.x = this.a.tx; this.b.x = this.b.tx; this.a.y = this.b.y = this.a.ty
    this.stamp.position.set(this.w / 2, this.h * 0.4)
  }

  /** Normalized ring x (-1..1) to screen x along the fighters' line. */
  private ringX(nx: number): number { return this.w / 2 + (nx / this.ringHalf) * this.w * 0.31 }
  private ringScale(): number { return this.w * 0.31 / this.ringHalf }

  private drawBg() {
    const g = this.bg; g.clear()
    g.rect(0, 0, this.w, this.h).fill(0x0b1220)
    g.rect(0, 0, this.w, this.h * 0.55).fill({ color: 0x141f36, alpha: 0.9 })
    for (const cx of [this.w * 0.3, this.w * 0.7]) {
      g.poly([cx, -10, cx - this.w * 0.28, this.h * 0.75, cx + this.w * 0.28, this.h * 0.75]).fill({ color: 0xfff1b8, alpha: 0.07 })
      g.circle(cx, 0, 28).fill({ color: 0xfff1b8, alpha: 0.6 })
    }
    g.ellipse(this.w / 2, this.h * 0.7, this.w * 0.42, this.h * 0.2).fill({ color: 0xfff1b8, alpha: 0.08 })
  }

  private drawRing() {
    const g = this.ring; g.clear()
    const cx = this.w / 2, top = this.h * 0.5, bot = this.h * 0.86, hb = this.w * 0.42, ht = this.w * 0.3
    g.poly([cx - hb, bot + 30, cx + hb, bot + 30, cx + ht, top + 30, cx - ht, top + 30]).fill(0x2a1e2e)               // apron
    g.poly([cx - hb, bot, cx + hb, bot, cx + ht, top, cx - ht, top]).fill(0xe7e2d3)                                   // canvas
    g.circle(cx, (top + bot) / 2, this.h * 0.09).fill({ color: 0xd8452e, alpha: 0.25 })
    const posts: [number, number][] = [[cx - hb, bot], [cx + hb, bot], [cx + ht, top], [cx - ht, top]]
    for (let i = 0; i < 3; i++) {
      const dy = 26 + i * 22
      const rope = (p: [number, number], q: [number, number], col: number) => g.moveTo(p[0], p[1] - dy).lineTo(q[0], q[1] - dy).stroke({ width: 4, color: col })
      const col = [0xd8452e, 0xffffff, 0x2ba1e8][i]
      rope(posts[3], posts[2], col); rope(posts[0], posts[3], col); rope(posts[1], posts[2], col)
    }
    for (const [x, y] of posts) g.roundRect(x - 6, y - 96, 12, 100, 4).fill(0xdddddd).stroke({ width: 2, color: 0x33393f })
    for (let i = 0; i < 3; i++) { const dy = 26 + i * 22; g.moveTo(posts[0][0], posts[0][1] - dy).lineTo(posts[1][0], posts[1][1] - dy).stroke({ width: 5, color: [0xd8452e, 0xffffff, 0x2ba1e8][i] }) }
  }

  private drawCrowd(t: number) {
    const g = this.crowd; g.clear()
    const excite = this.bellFlash > 0 ? 2.5 : 1
    for (let row = 0; row < 3; row++) {
      const y = this.h * (0.34 + row * 0.05)
      const n = 18 + row * 4
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * (this.w / n)
        const bob = Math.sin(t * 2 * excite + i * 1.3 + row) * 3 * excite
        g.circle(x, y + bob, 12 + row * 2).fill({ color: 0x1a2438, alpha: 0.95 })
        g.roundRect(x - 16 - row, y + 10 + bob, 32 + row * 2, 24, 8).fill({ color: 0x1a2438, alpha: 0.95 })
      }
    }
  }

  onMatch(): void { this.ids = [] }
  onPhase(phase: { phase: string } | null): void {
    if (phase?.phase === 'betting') { this.stamp.text = 'Place your bets'; this.stamp.alpha = 1; this.stampT = 1.2 }
    if (phase?.phase === 'input') { this.stamp.text = 'FIGHT!'; this.stamp.alpha = 1; this.stampT = 1.0; this.bellFlash = 1.2 }
  }

  onTick(tick: Tick): void {
    const t = tick as { fighters?: Record<string, F>; events?: Ev[]; ring?: [number, number] }
    if (!t.fighters) return
    const fs = Object.values(t.fighters)
    if (!this.ids.length) this.ids = fs.map((f) => f.id)
    if (t.ring) this.ringHalf = Math.abs(t.ring[1]) || 1
    const [fa, fb] = [t.fighters[this.ids[0]], t.fighters[this.ids[1]]]
    if (fa) this.applyFighter(this.a, fa)
    if (fb) this.applyFighter(this.b, fb)
    for (const e of t.events ?? []) {
      const who = e.who === this.ids[0] ? this.a : this.b
      const other = who === this.a ? this.b : this.a
      if (e.kind === 'punch') {
        const contact = { x: (who.x + other.x) / 2 + who.facing * 10, y: who.y - this.h * 0.2 }
        if (e.result === 'hit') {
          other.flash = 1; other.wobble = 1
          other.slide = who.facing * (e.type === 'hook' ? 14 : 8)
          this.showPow(other, e.type === 'hook' ? 'POW!' : 'BAM!')
          this.burst(contact.x, contact.y, e.type === 'hook' ? 14 : 8, 0xffe08a, 260, 5, 0)
          this.burst(other.x, other.y + 4, 8, 0xc9b79a, 120, 4, 300)     // dust at the feet as the fighter is shoved
          this.effects?.shake(e.type === 'hook' ? 12 : 6); if (e.type === 'hook') this.effects?.hitstop(90)
        } else if (e.result === 'blocked') { this.showPow(other, 'BLOCK'); other.guardPulse = 1; this.burst(contact.x, contact.y, 5, 0x9fb0c3, 140, 3, 200) }
        else if (e.result === 'dodged') this.showPow(other, 'MISS')
        else if (e.result === 'whiff') this.showPow(who, 'WHIFF', 0.5)
        else if (e.result === 'parried') { other.spark = 1 }
      } else if (e.kind === 'knockdown') {
        this.stamp.text = e.ko ? 'K.O.!' : 'KNOCKDOWN'; this.stamp.alpha = 1; this.stampT = e.ko ? 4 : 2.5
        this.burst(who.x, who.y, 18, 0xc9b79a, 220, 5, 350)
        this.effects?.shake(24); this.effects?.slowmo(0.3, 1500)
      } else if (e.kind === 'parry' && e.result === 'success') {
        other.stars = 1.2; who.spark = 1
        this.showPow(who, 'PARRY!')
        this.burst(who.x + who.facing * 40, who.y - this.h * 0.22, 16, 0x7de3ff, 320, 4, -80)
        this.effects?.hitstop(120)
      } else if (e.kind === 'bell') {
        this.stamp.text = 'DING DING'; this.stamp.alpha = 1; this.stampT = 1.6; this.bellFlash = 1.5
        this.effects?.shake(5)
      } else if (e.kind === 'dodge') {
        this.burst(who.x, who.y + 4, 5, 0xc9b79a, 100, 3, 250)
      }
    }
  }

  private applyFighter(p: Puppet, f: F) {
    p.state = f.state
    p.phase = f.phase ?? null; p.action = f.action ?? null; p.progress = f.progress ?? 0
    p.reach = f.reach ?? 0.4; p.moving = f.moving ?? 0; p.fatigue = f.fatigue ?? 0; p.stamina = f.stamina
    if (typeof f.x === 'number') p.tx = this.ringX(f.x)
    if (f.facing === 1 || f.facing === -1) p.facing = f.facing
  }

  private burst(x: number, y: number, n: number, color: number, speed: number, size: number, gravity: number) {
    let spawned = 0
    for (let i = 0; i < MAX_PARTICLES && spawned < n; i++) {
      const q = this.particles[i]
      if (q.life > 0) continue
      const ang = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.6)
      q.x = x; q.y = y; q.vx = Math.cos(ang) * sp; q.vy = Math.sin(ang) * sp - (gravity > 0 ? speed * 0.3 : 0)
      q.life = q.max = 0.35 + Math.random() * 0.3; q.size = size * (0.6 + Math.random() * 0.8); q.color = color; q.g = gravity
      spawned++
    }
  }

  private showPow(p: Puppet, text: string, scale = 1) {
    this.pow.text = text; this.pow.alpha = 1; this.powT = 0.7
    this.pow.position.set(p.x + p.facing * 20, p.y - this.h * 0.24)
    this.pow.scale.set(1.3 * scale)
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000
    this.t += dt
    this.bellFlash = Math.max(0, this.bellFlash - dt)
    this.drawCrowd(this.t)
    const H = this.h * 0.3
    for (const p of [this.a, this.b]) {
      const s = p.state, f = p.facing
      const reachPx = p.reach * this.ringScale()
      const tired = p.fatigue
      // body: position (server x + knockback slide), lean, lie, wobble
      p.slide = lerp(p.slide, 0, 0.18)
      p.x = lerp(p.x, p.tx, 0.28) + p.slide
      const leanT = s === 'dodge' ? -1 : s === 'stagger' ? -0.7 : s === 'stunned' ? -0.4 : s === 'windup' ? (p.action === 'hook' ? -0.45 : -0.2) : s === 'active' ? (p.action === 'hook' ? 0.6 : 0.45) : s === 'block' ? 0.15 : -0.15 * tired
      p.lean = lerp(p.lean, leanT, 0.3)
      p.lie = lerp(p.lie, s === 'down' ? 1 : 0, 0.12)
      p.wobble = Math.max(0, p.wobble - dt * 2)
      const bobSpeed = 6 * (1 - 0.6 * tired), bobAmp = (s === 'idle' || s === 'block') ? 3 * (1 - 0.5 * tired) : 0
      p.y = p.ty + Math.sin(this.t * bobSpeed + (p === this.a ? 0 : 1)) * bobAmp + (p.moving ? Math.abs(Math.sin(this.t * 14)) * -4 : 0)
      // gloves by phase
      const idleLead = { x: f * 34, y: -this.h * 0.1 - tired * 14 }, idleRear = { x: f * 12, y: -this.h * 0.08 - tired * 10 }
      let leadT = idleLead, rearT = idleRear
      if (s === 'block' || (s === 'idle' && p.guardPulse > 0.5)) { leadT = { x: f * 18, y: -this.h * 0.19 }; rearT = { x: f * 6, y: -this.h * 0.2 } }
      else if (s === 'windup') {
        const q = p.progress
        if (p.action === 'hook') { rearT = { x: -f * reachPx * 0.55 * q, y: -this.h * 0.14 }; leadT = { x: f * 26, y: -this.h * 0.16 } }
        else { leadT = { x: f * (34 - 30 * q), y: -this.h * 0.12 }; rearT = { x: f * 8, y: -this.h * 0.16 } }
      } else if (s === 'active') {
        if (p.action === 'hook') { rearT = { x: f * reachPx * 1.25, y: -this.h * 0.11 }; leadT = { x: f * 20, y: -this.h * 0.16 } }
        else { leadT = { x: f * reachPx * 1.4, y: -this.h * 0.12 }; rearT = { x: f * 8, y: -this.h * 0.16 } }
      } else if (s === 'recover') {
        const q = 1 - p.progress
        if (p.action === 'hook') rearT = { x: lerp(idleRear.x, f * reachPx * 1.25, q), y: -this.h * 0.11 }
        else leadT = { x: lerp(idleLead.x, f * reachPx * 1.4, q), y: -this.h * 0.12 }
      } else if (s === 'parry') { leadT = { x: f * 44, y: -this.h * 0.2 }; rearT = { x: f * 4, y: -this.h * 0.18 } }
      else if (s === 'dodge') { leadT = { x: f * 10, y: -this.h * 0.14 }; rearT = { x: -f * 6, y: -this.h * 0.12 } }
      else if (s === 'stagger' || s === 'stunned') { leadT = { x: f * 30, y: -this.h * 0.04 }; rearT = { x: -f * 10, y: -this.h * 0.02 } }
      const k = s === 'active' ? 0.6 : 0.35
      p.lead.x = lerp(p.lead.x, leadT.x, k); p.lead.y = lerp(p.lead.y, leadT.y, k)
      p.rear.x = lerp(p.rear.x, rearT.x, k); p.rear.y = lerp(p.rear.y, rearT.y, k)
      p.flash = Math.max(0, p.flash - dt * 4); p.stars = Math.max(0, p.stars - dt); p.spark = Math.max(0, p.spark - dt * 3); p.guardPulse = Math.max(0, p.guardPulse - dt * 3)
      this.drawPuppet(p, H)
    }
    this.drawFloor()
    this.updateParticles(dt)
    if (this.powT > 0) { this.powT -= dt; this.pow.alpha = Math.min(1, this.powT * 2); this.pow.scale.set(lerp(this.pow.scale.x, 1, 0.2)); this.pow.y -= dt * 30 } else this.pow.alpha = 0
    if (this.stampT > 0) { this.stampT -= dt; this.stamp.alpha = Math.min(1, this.stampT * 1.5) } else this.stamp.alpha = 0
  }

  /** Floor markers: shadows, footwork arrows and the reach line while a punch is winding up (the telegraph). */
  private drawFloor() {
    const g = this.floor; g.clear()
    for (const p of [this.a, this.b]) {
      g.ellipse(p.x, p.y + 6, 44, 14).fill({ color: 0x000000, alpha: 0.3 })
      if (p.moving) { const d = p.moving > 0 ? 1 : -1; g.poly([p.x + d * 52, p.y + 4, p.x + d * 62, p.y + 10, p.x + d * 52, p.y + 16]).fill({ color: 0xffffff, alpha: 0.35 }) }
      if (p.state === 'windup' || p.state === 'active') {
        const len = p.reach * this.ringScale()
        const col = p.state === 'active' ? 0xffffff : 0xff9c3b
        g.moveTo(p.x, p.y + 8).lineTo(p.x + p.facing * len, p.y + 8).stroke({ width: 3, color: col, alpha: 0.35 + 0.4 * p.progress })
        g.circle(p.x + p.facing * len, p.y + 8, 5).fill({ color: col, alpha: 0.7 })
      }
    }
  }

  private updateParticles(dt: number) {
    const g = this.fx; g.clear()
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const q = this.particles[i]
      if (q.life <= 0) continue
      q.life -= dt
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.g * dt; q.vx *= 0.96
      const a = Math.max(0, q.life / q.max)
      g.circle(q.x, q.y, q.size * (0.5 + a * 0.5)).fill({ color: q.color, alpha: a })
    }
  }

  private drawPuppet(p: Puppet, H: number) {
    const g = p.g; g.clear()
    const f = p.facing, lie = p.lie
    const wob = p.wobble > 0 ? Math.sin(this.t * 40) * 6 * p.wobble : 0
    const bodyCol = p.flash > 0 ? 0xffffff : p.color
    const rot = lie * f * 1.35
    const cx = p.x + f * lie * 60, cy = p.y - lie * 10
    const R = (x: number, y: number): [number, number] => [cx + (x) * Math.cos(rot) - (y) * Math.sin(rot), cy + (x) * Math.sin(rot) + (y) * Math.cos(rot)]
    // legs (stride while moving)
    const stride = p.moving ? Math.sin(this.t * 14) * 8 : 0
    for (const [i, dx] of [-14, 14].entries()) { const [lx, ly] = R(dx + p.lean * 6 + (i ? stride : -stride), -H * 0.18); g.roundRect(lx - 9, ly, 18, H * 0.18, 8).fill(0x22283a) }
    // torso
    const [bx, by] = R(p.lean * 8 + wob * 0.4, -H * 0.55)
    g.roundRect(bx - 30, by, 60, H * 0.4, 20).fill(bodyCol).stroke({ width: 4, color: 0x1a1f2b })
    g.rect(bx - 30, by + H * 0.3, 60, 10).fill(p.accent)
    // head
    const [hx, hy] = R(p.lean * 14 + wob, -H * 0.72)
    g.circle(hx, hy, H * 0.14).fill(0xf6c9a0).stroke({ width: 4, color: 0x1a1f2b })
    g.roundRect(hx - H * 0.14, hy - H * 0.16, H * 0.28, H * 0.09, 8).fill(p.accent)     // headgear
    const ex = hx + f * H * 0.05, ey = hy - H * 0.01
    if (p.state === 'down' || p.stars > 0 || p.state === 'stunned') { g.moveTo(ex - 6, ey - 6).lineTo(ex + 6, ey + 6).moveTo(ex + 6, ey - 6).lineTo(ex - 6, ey + 6).stroke({ width: 3, color: 0x1a1f2b }) }
    else if (p.state === 'windup' || p.state === 'active') { g.roundRect(ex - 7, ey - 3, 12, 5, 2).fill(0x1a1f2b); g.circle(ex - f * 16, ey, 4).fill(0x1a1f2b) }   // squint
    else { g.circle(ex, ey, 5).fill(0x1a1f2b); g.circle(ex - f * 16, ey, 4).fill(0x1a1f2b) }
    if (p.stars > 0 || p.state === 'stunned') for (let i = 0; i < 3; i++) { const a = this.t * 5 + i * 2.1; g.circle(hx + Math.cos(a) * 34, hy - H * 0.2 + Math.sin(a) * 8, 6).fill(0xffe08a) }
    if (p.fatigue > 0.5 && p.state !== 'down') for (let i = 0; i < 2; i++) { const a = this.t * 3 + i * 3; g.circle(hx - f * 26 + Math.cos(a) * 4, hy - H * 0.05 + ((this.t * 40 + i * 20) % 40) - 20, 3).fill({ color: 0x7de3ff, alpha: 0.7 }) }   // sweat
    // gloves
    const gr = H * 0.11
    const [lx, ly] = R(p.lead.x, p.lead.y - H * 0.4), [rx, ry] = R(p.rear.x, p.rear.y - H * 0.4)
    const gcol = p.state === 'windup' ? 0xffb347 : p.state === 'active' ? 0xff6b3b : 0xd8452e
    const strikingRear = p.action === 'hook' && (p.state === 'active' || p.state === 'windup')
    g.circle(rx, ry, gr * (strikingRear && p.state === 'active' ? 1.2 : 1)).fill(gcol).stroke({ width: 4, color: 0x1a1f2b })
    g.circle(lx, ly, gr * (!strikingRear && p.state === 'active' ? 1.15 : 1)).fill(gcol).stroke({ width: 4, color: 0x1a1f2b })
    if (p.state === 'windup') { const [wx, wy] = strikingRear ? [rx, ry] : [lx, ly]; g.circle(wx, wy, gr + 8 + Math.sin(this.t * 20) * 3).stroke({ width: 3, color: 0xffe08a, alpha: 0.5 + 0.5 * p.progress }) }
    if (p.state === 'block' || p.guardPulse > 0) { g.roundRect(hx - H * 0.2 * f - (f > 0 ? 0 : H * 0.04), hy - H * 0.12, H * 0.24, H * 0.3, 10).stroke({ width: 3, color: 0x2ba1e8, alpha: 0.35 + 0.6 * p.guardPulse }) }
    if (p.state === 'parry' || p.spark > 0) { for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + this.t * 6; const r = gr + 6 + (1 - p.spark) * 14; g.moveTo(lx + Math.cos(a) * gr, ly + Math.sin(a) * gr).lineTo(lx + Math.cos(a) * r, ly + Math.sin(a) * r).stroke({ width: 3, color: 0x7de3ff, alpha: p.state === 'parry' ? 0.9 : p.spark }) } }
    if (p.state === 'dodge') { g.moveTo(p.x - f * 30, p.y - H * 0.5).lineTo(p.x - f * 52, p.y - H * 0.55).moveTo(p.x - f * 30, p.y - H * 0.4).lineTo(p.x - f * 56, p.y - H * 0.42).stroke({ width: 3, color: 0xffffff, alpha: 0.5 }) }
  }

  unmount(): void { this.root.destroy({ children: true }) }
}
