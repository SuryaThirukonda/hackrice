import { Container, Graphics, Text, type Application } from 'pixi.js'
import { lerp, type Effects, type Scene, type Tick } from './Scene'

interface F { id: string; name: string; hp: number; stamina: number; guard: boolean; state: string; knockdowns: number }
interface Ev { kind: string; who: string; type?: string; result?: string; ko?: boolean }

class Puppet {
  g = new Graphics()
  x = 0; y = 0; tx = 0; ty = 0
  lead = { x: 0, y: 0 }; rear = { x: 0, y: 0 }
  state = 'idle'; flash = 0; stars = 0; lean = 0; lie = 0
  facing: 1 | -1; color: number; accent: number
  constructor(facing: 1 | -1, color: number, accent: number) { this.facing = facing; this.color = color; this.accent = accent }
}

/** Boxing ring under spotlights with two chunky cartoon fighters. Renders tick.fighters states; never simulates. */
export class BoxingScene implements Scene {
  private root = new Container()
  private bg = new Graphics()
  private ring = new Graphics()
  private crowd = new Graphics()
  private fx = new Graphics()
  private pow = new Text({ text: '', style: { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: 64, fill: 0xffe08a, stroke: { color: 0x5a2f0e, width: 8 } } })
  private stamp = new Text({ text: '', style: { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: 92, fill: 0xffffff, stroke: { color: 0xd8452e, width: 10 } } })
  private a = new Puppet(1, 0x2ba1e8, 0x1d7fc0)
  private b = new Puppet(-1, 0xee6a5f, 0xb3261e)
  private ids: string[] = []
  private w = 800; private h = 600; private t = 0
  private effects: Effects | null
  private powT = 0; private stampT = 0

  constructor(fx?: Effects) { this.effects = fx ?? null }

  mount(_app: Application, root: Container, size: { w: number; h: number }): void {
    root.addChild(this.root)
    this.root.addChild(this.bg, this.crowd, this.ring, this.b.g, this.a.g, this.fx, this.pow, this.stamp)
    this.pow.anchor.set(0.5); this.pow.alpha = 0; this.stamp.anchor.set(0.5); this.stamp.alpha = 0
    this.resize(size)
  }

  resize(size: { w: number; h: number }): void {
    this.w = size.w; this.h = size.h
    this.drawBg(); this.drawRing(); this.drawCrowd(0)
    this.a.tx = this.w * 0.36; this.b.tx = this.w * 0.64; this.a.ty = this.b.ty = this.h * 0.62
    this.a.x = this.a.tx; this.b.x = this.b.tx; this.a.y = this.b.y = this.a.ty
    this.stamp.position.set(this.w / 2, this.h * 0.4)
  }

  private drawBg() {
    const g = this.bg; g.clear()
    g.rect(0, 0, this.w, this.h).fill(0x0b1220)
    g.rect(0, 0, this.w, this.h * 0.55).fill({ color: 0x141f36, alpha: 0.9 })
    // spotlights
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
    for (let row = 0; row < 3; row++) {
      const y = this.h * (0.34 + row * 0.05)
      const n = 18 + row * 4
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * (this.w / n)
        const bob = Math.sin(t * 2 + i * 1.3 + row) * 3
        g.circle(x, y + bob, 12 + row * 2).fill({ color: 0x1a2438, alpha: 0.95 })
        g.roundRect(x - 16 - row, y + 10 + bob, 32 + row * 2, 24, 8).fill({ color: 0x1a2438, alpha: 0.95 })
      }
    }
  }

  onMatch(): void { this.ids = [] }
  onPhase(phase: { phase: string } | null): void {
    if (phase?.phase === 'betting') { this.stamp.text = 'Place your bets'; this.stamp.alpha = 1; this.stampT = 1.2 }
    if (phase?.phase === 'input') { this.stamp.text = 'FIGHT!'; this.stamp.alpha = 1; this.stampT = 1.0 }
  }

  onTick(tick: Tick): void {
    const t = tick as { fighters?: Record<string, F>; events?: Ev[] }
    if (!t.fighters) return
    const fs = Object.values(t.fighters)
    if (!this.ids.length) this.ids = fs.map((f) => f.id)
    const [fa, fb] = [t.fighters[this.ids[0]], t.fighters[this.ids[1]]]
    if (fa) this.a.state = fa.state
    if (fb) this.b.state = fb.state
    for (const e of t.events ?? []) {
      const who = e.who === this.ids[0] ? this.a : this.b
      const other = who === this.a ? this.b : this.a
      if (e.kind === 'punch') {
        if (e.result === 'hit') { other.flash = 1; this.showPow(other, e.type === 'hook' ? 'POW!' : 'BAM!'); this.effects?.shake(e.type === 'hook' ? 12 : 6); if (e.type === 'hook') this.effects?.hitstop(90) }
        else if (e.result === 'blocked') this.showPow(other, 'BLOCK')
        else if (e.result === 'dodged') this.showPow(other, 'MISS')
      } else if (e.kind === 'knockdown') {
        this.stamp.text = e.ko ? 'K.O.!' : 'KNOCKDOWN'; this.stamp.alpha = 1; this.stampT = e.ko ? 4 : 2.5
        this.effects?.shake(24); this.effects?.slowmo(0.3, 1500)
      } else if (e.kind === 'parry' && e.result === 'success') { other.stars = 1.2; this.showPow(who, 'PARRY!'); this.effects?.hitstop(120) }
    }
  }

  private showPow(p: Puppet, text: string) {
    this.pow.text = text; this.pow.alpha = 1; this.powT = 0.7
    this.pow.position.set(p.x + p.facing * 20, p.y - this.h * 0.22)
    this.pow.scale.set(1.3)
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000
    this.t += dt
    this.drawCrowd(this.t)
    for (const p of [this.a, this.b]) {
      const s = p.state
      const reach = this.w * 0.11
      let tx = p === this.a ? this.w * 0.36 : this.w * 0.64
      p.lean = lerp(p.lean, s === 'dodge' ? -1 : s === 'telegraph' ? -0.35 : s === 'strike' ? 0.5 : 0, 0.25)
      p.lie = lerp(p.lie, s === 'down' ? 1 : 0, 0.12)
      if (s === 'strike') tx += p.facing * reach * 0.25
      p.x = lerp(p.x, tx, 0.2)
      p.y = p.ty + (s === 'idle' ? Math.sin(this.t * 6 + (p === this.a ? 0 : 1)) * 3 : 0)
      const leadT = s === 'strike' ? { x: p.facing * reach * 1.5, y: -this.h * 0.12 } : s === 'block' || s === 'telegraph' && false ? { x: p.facing * 22, y: -this.h * 0.17 } : s === 'telegraph' ? { x: -p.facing * 10, y: -this.h * 0.1 } : { x: p.facing * 34, y: -this.h * 0.1 }
      const rearT = s === 'telegraph' ? { x: -p.facing * reach * 0.6, y: -this.h * 0.12 } : s === 'block' ? { x: p.facing * 8, y: -this.h * 0.18 } : { x: p.facing * 12, y: -this.h * 0.08 }
      p.lead.x = lerp(p.lead.x, leadT.x, 0.35); p.lead.y = lerp(p.lead.y, leadT.y, 0.35)
      p.rear.x = lerp(p.rear.x, rearT.x, 0.3); p.rear.y = lerp(p.rear.y, rearT.y, 0.3)
      p.flash = Math.max(0, p.flash - dt * 4); p.stars = Math.max(0, p.stars - dt)
      this.drawPuppet(p)
    }
    if (this.powT > 0) { this.powT -= dt; this.pow.alpha = Math.min(1, this.powT * 2); this.pow.scale.set(lerp(this.pow.scale.x, 1, 0.2)); this.pow.y -= dt * 30 } else this.pow.alpha = 0
    if (this.stampT > 0) { this.stampT -= dt; this.stamp.alpha = Math.min(1, this.stampT * 1.5) } else this.stamp.alpha = 0
  }

  private drawPuppet(p: Puppet) {
    const g = p.g; g.clear()
    const H = this.h * 0.3, f = p.facing
    const lie = p.lie
    g.ellipse(p.x, p.y + 6, 44, 14).fill({ color: 0x000000, alpha: 0.3 })
    const bodyCol = p.flash > 0 ? 0xffffff : p.color
    const rot = lie * f * 1.35
    const cx = p.x + f * lie * 60, cy = p.y - lie * 10
    const R = (x: number, y: number): [number, number] => [cx + (x) * Math.cos(rot) - (y) * Math.sin(rot), cy + (x) * Math.sin(rot) + (y) * Math.cos(rot)]
    // legs
    for (const dx of [-14, 14]) { const [lx, ly] = R(dx + p.lean * 6, -H * 0.18); g.roundRect(lx - 9, ly, 18, H * 0.18, 8).fill(0x22283a) }
    // torso
    const [bx, by] = R(p.lean * 8, -H * 0.55)
    g.roundRect(bx - 30, by, 60, H * 0.4, 20).fill(bodyCol).stroke({ width: 4, color: 0x1a1f2b })
    g.rect(bx - 30, by + H * 0.3, 60, 10).fill(p.accent)
    // head
    const [hx, hy] = R(p.lean * 14, -H * 0.72)
    g.circle(hx, hy, H * 0.14).fill(0xf6c9a0).stroke({ width: 4, color: 0x1a1f2b })
    g.roundRect(hx - H * 0.14, hy - H * 0.16, H * 0.28, H * 0.09, 8).fill(p.accent)     // headgear
    const ex = hx + f * H * 0.05, ey = hy - H * 0.01
    if (p.state === 'down' || p.stars > 0) { g.moveTo(ex - 6, ey - 6).lineTo(ex + 6, ey + 6).moveTo(ex + 6, ey - 6).lineTo(ex - 6, ey + 6).stroke({ width: 3, color: 0x1a1f2b }) }
    else { g.circle(ex, ey, 5).fill(0x1a1f2b); g.circle(ex - f * 16, ey, 4).fill(0x1a1f2b) }
    if (p.stars > 0) for (let i = 0; i < 3; i++) { const a = this.t * 5 + i * 2.1; g.circle(hx + Math.cos(a) * 34, hy - H * 0.2 + Math.sin(a) * 8, 6).fill(0xffe08a) }
    // gloves
    const gr = H * 0.11
    const [lx, ly] = R(p.lead.x, p.lead.y - H * 0.4), [rx, ry] = R(p.rear.x, p.rear.y - H * 0.4)
    const gcol = p.state === 'telegraph' ? 0xffe08a : 0xd8452e
    g.circle(rx, ry, gr).fill(gcol).stroke({ width: 4, color: 0x1a1f2b })
    g.circle(lx, ly, gr * (p.state === 'strike' ? 1.15 : 1)).fill(gcol).stroke({ width: 4, color: 0x1a1f2b })
    if (p.state === 'telegraph') g.circle(rx, ry, gr + 8 + Math.sin(this.t * 20) * 3).stroke({ width: 3, color: 0xffe08a, alpha: 0.9 })
    if (p.state === 'block' || p.state === 'stunned') { /* guard drawn by glove positions */ }
  }

  unmount(): void { this.root.destroy({ children: true }) }
}
