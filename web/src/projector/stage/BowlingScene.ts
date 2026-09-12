import { Container, Graphics, Text, type Application } from 'pixi.js'
import { clamp01, easeOut, lerp, type Effects, type Scene, type Tick } from './Scene'

const S = 0.289
const PIN_X: Record<number, number> = { 1: 0, 2: -S, 3: S, 4: -2 * S, 5: 0, 6: 2 * S, 7: -3 * S, 8: -S, 9: S, 10: 3 * S }
const PIN_ROW: Record<number, number> = { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3 }

interface Roll { path: [number, number][]; t: number; dur: number; knocked: number[]; after: number[]; before: number[]; who: string; outcome: string; done: boolean; stamped: boolean }

export class BowlingScene implements Scene {
  private root = new Container()
  private lane = new Graphics()
  private oil = new Graphics()
  private pinLayer = new Container()
  private rerackShake = 0          // ms left of pin-deck jitter after a Pin King re-rack
  private pins = new Map<number, Graphics>()
  private pinState = new Map<number, number>()   // 1 = standing, 0 = down
  private ball = new Graphics()
  private stamp = new Text({ text: '', style: { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: 72, fill: 0xffffff, stroke: { color: 0x1d7fc0, width: 8 }, fontWeight: '900' } })
  private roll: Roll | null = null
  private w = 800; private h = 600
  private fx: Effects | null = null
  private drift = 0
  private banner = new Text({ text: '', style: { fontFamily: 'Nunito, sans-serif', fontSize: 22, fill: 0xeef2f6, fontWeight: '900' } })

  constructor(fx?: Effects) { this.fx = fx ?? null }

  mount(_app: Application, root: Container, size: { w: number; h: number }): void {
    root.addChild(this.root)
    this.root.addChild(this.lane, this.oil, this.pinLayer)
    for (let i = 1; i <= 10; i++) { const g = new Graphics(); this.pins.set(i, g); this.pinState.set(i, 1); this.pinLayer.addChild(g) }
    this.root.addChild(this.ball, this.stamp, this.banner)
    this.stamp.anchor.set(0.5); this.stamp.alpha = 0
    this.banner.anchor.set(0.5)
    this.resize(size)
  }

  resize(size: { w: number; h: number }): void {
    this.w = size.w; this.h = size.h
    this.drawLane(); this.drawPins(); this.placeBall(0, 0, 'human')
    this.stamp.position.set(this.w / 2, this.h * 0.45)
    this.banner.position.set(this.w / 2, this.h * 0.96)
  }

  // lane geometry: x in [-1,1] across the lane, d in [0,1] from foul line to pin deck, drawn in perspective
  private yOf(d: number) { return lerp(this.h * 0.92, this.h * 0.2, d) }
  private halfW(d: number) { return lerp(this.w * 0.26, this.w * 0.13, d) }
  private xOf(x: number, d: number) { return this.w / 2 + x * this.halfW(d) }

  private drawLane() {
    const g = this.lane; g.clear()
    // neon alley surround
    g.rect(0, 0, this.w, this.h).fill(0x0b1220)
    g.rect(0, 0, this.w, this.h * 0.22).fill({ color: 0x141f36, alpha: 0.95 })
    g.rect(0, this.h * 0.2, this.w, 6).fill({ color: 0xff3d8a, alpha: 0.9 })
    g.rect(0, this.h * 0.2 - 10, this.w, 26).fill({ color: 0xff3d8a, alpha: 0.12 })
    for (let i = 0; i < 9; i++) { const x = (i + 0.5) * (this.w / 9); g.circle(x, this.h * 0.11, 10).fill({ color: 0x2ba1e8, alpha: 0.9 }); g.circle(x, this.h * 0.11, 26).fill({ color: 0x2ba1e8, alpha: 0.12 }) }
    const b = this.yOf(0), t = this.yOf(1.08), hb = this.halfW(0) * 1.12, ht = this.halfW(1.08) * 1.12
    g.poly([this.w / 2 - hb, b, this.w / 2 + hb, b, this.w / 2 + ht, t, this.w / 2 - ht, t]).fill(0x8b6a3e)             // gutters + approach
    const hb2 = this.halfW(0), ht2 = this.halfW(1.08)
    g.poly([this.w / 2 - hb2, b, this.w / 2 + hb2, b, this.w / 2 + ht2, t, this.w / 2 - ht2, t]).fill(0xe9c98a)         // boards
    for (let i = -6; i <= 6; i++) { const x = i / 7; g.moveTo(this.xOf(x, 0), b).lineTo(this.xOf(x, 1.08), t).stroke({ width: 1, color: 0xd9b371, alpha: 0.7 }) }
    g.moveTo(this.w / 2 - hb, b).lineTo(this.w / 2 + hb, b).stroke({ width: 4, color: 0x33393f })                     // foul line
    const ay = this.yOf(0.55); for (let i = -3; i <= 3; i++) { const x = i * 0.25; g.poly([this.xOf(x, 0.55), ay - 10, this.xOf(x, 0.55) + 6, ay, this.xOf(x, 0.55), ay + 10, this.xOf(x, 0.55) - 6, ay]).fill(0x6b3d16) }  // arrows
    this.drawOil()
  }

  private drawOil() {
    const g = this.oil; g.clear()
    if (Math.abs(this.drift) < 0.01) return
    const b = this.yOf(0.1), t = this.yOf(0.9)
    const off = this.drift * this.halfW(0.5)
    // the Pin King's oil: a slick that leans the way the drift pushes the ball, with a brighter core
    g.poly([this.w / 2 + off - this.halfW(0.1) * 0.4, b, this.w / 2 + off + this.halfW(0.1) * 0.4, b, this.w / 2 + off * 0.3 + this.halfW(0.9) * 0.4, t, this.w / 2 + off * 0.3 - this.halfW(0.9) * 0.4, t]).fill({ color: 0x2ba1e8, alpha: 0.16 })
    g.poly([this.w / 2 + off - this.halfW(0.1) * 0.18, b, this.w / 2 + off + this.halfW(0.1) * 0.18, b, this.w / 2 + off * 0.3 + this.halfW(0.9) * 0.18, t, this.w / 2 + off * 0.3 - this.halfW(0.9) * 0.18, t]).fill({ color: 0x7cc4f0, alpha: 0.14 })
  }

  private drawPins() {
    for (let i = 1; i <= 10; i++) {
      const g = this.pins.get(i)!; g.clear()
      const d = 1 + PIN_ROW[i] * 0.022
      const x = this.xOf(PIN_X[i] * 0.82, d), y = this.yOf(d)
      const s = this.pinState.get(i) ?? 1
      const r = this.h * 0.016
      if (s > 0.5) {
        g.ellipse(x, y + r * 1.4, r * 0.55, r * 0.25).fill({ color: 0x000000, alpha: 0.15 })
        g.roundRect(x - r * 0.55, y - r * 1.6, r * 1.1, r * 3.2, r * 0.5).fill(0xfafafa).stroke({ width: 2, color: 0x33393f })
        g.rect(x - r * 0.5, y - r * 0.5, r, r * 0.35).fill(0xee6a5f)
      } else {
        g.roundRect(x - r * 1.6, y + r * 0.6, r * 3.2, r * 0.9, r * 0.4).fill({ color: 0xdddddd, alpha: 0.9 }).stroke({ width: 1, color: 0x888888 })
      }
    }
  }

  private placeBall(x: number, d: number, who: string) {
    const g = this.ball; g.clear()
    const r = lerp(this.h * 0.032, this.h * 0.016, clamp01(d))
    const sx = this.xOf(x, d), sy = this.yOf(d)
    g.ellipse(sx, sy + r * 0.9, r * 1.1, r * 0.4).fill({ color: 0x000000, alpha: 0.2 })
    g.circle(sx, sy, r).fill(who === 'house' ? 0xee6a5f : 0x2ba1e8).stroke({ width: 3, color: 0x33393f })
    g.circle(sx - r * 0.3, sy - r * 0.3, r * 0.12).fill(0x33393f); g.circle(sx + r * 0.05, sy - r * 0.4, r * 0.12).fill(0x33393f); g.circle(sx - r * 0.12, sy - r * 0.05, r * 0.12).fill(0x33393f)
  }

  onTick(tick: Tick): void {
    const t = tick as { path?: [number, number][]; knocked?: number[]; pins_after?: number[]; pins_before?: number[]; who?: string; outcome?: string; anim_s?: number; lane_drift?: number; rerack?: boolean }
    if (typeof t.lane_drift === 'number') { this.drift = t.lane_drift; this.drawOil() }
    if (t.rerack) {
      // Pin King twist: the deck snaps to a 7-10 split mid-frame
      const after = t.pins_after ?? [7, 10]
      for (let i = 1; i <= 10; i++) this.pinState.set(i, after.includes(i) ? 1 : 0)
      this.drawPins()
      this.roll = null
      this.rerackShake = 650
      this.fx?.hitstop(90); this.fx?.shake(12)
      this.stamp.text = 'RE-RACK!'; this.stamp.tint = 0xffe08a; this.stamp.alpha = 1; this.stamp.scale.set(1.6)
      this.banner.text = 'The Pin King re-racks the deck: 7-10 split'
      return
    }
    if (!t.path || t.path.length < 2) return
    const before = t.pins_before ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    for (let i = 1; i <= 10; i++) this.pinState.set(i, before.includes(i) ? 1 : 0)
    this.drawPins()
    this.roll = { path: t.path, t: 0, dur: Math.max(600, (t.anim_s ?? 2.5) * 1000 * 0.62), knocked: t.knocked ?? [], after: t.pins_after ?? [], before, who: t.who ?? 'human', outcome: t.outcome ?? '', done: false, stamped: false }
    this.stamp.alpha = 0; this.stamp.tint = 0xffffff
    this.banner.text = t.who === 'house' ? 'The House rolls' : ''
  }

  onPhase(phase: { phase: string; prompt?: Record<string, unknown>; turn_no: number } | null): void {
    if (!phase) return
    if (phase.phase === 'input') {
      const p = (phase.prompt ?? {}) as { ball?: number; standing?: number[]; frame?: number; rerack?: boolean }
      if (p.standing) { for (let i = 1; i <= 10; i++) this.pinState.set(i, p.standing.includes(i) ? 1 : 0); this.drawPins() }
      this.banner.text = `Frame ${p.frame ?? phase.turn_no} · Ball ${p.ball ?? 1}` + (Math.abs(this.drift) >= 0.05 ? ` · oil drifts ${this.drift > 0 ? 'right' : 'left'}` : '')
      this.placeBall(0, 0, 'human')
    } else if (phase.phase === 'betting') {
      for (let i = 1; i <= 10; i++) this.pinState.set(i, 1); this.drawPins(); this.banner.text = 'Bets are open'; this.placeBall(0, 0, 'human')
    }
  }

  onMatch(): void { this.roll = null; this.stamp.alpha = 0 }

  update(dtMs: number): void {
    if (this.rerackShake > 0) {
      this.rerackShake -= dtMs
      const k = Math.max(0, this.rerackShake / 650)
      this.pinLayer.position.set((Math.random() - 0.5) * 10 * k, (Math.random() - 0.5) * 6 * k)
      if (this.rerackShake <= 0) this.pinLayer.position.set(0, 0)
    }
    const r = this.roll
    if (r && !r.done) {
      r.t += dtMs
      const k = clamp01(r.t / r.dur)
      const e = easeOut(k)
      const n = r.path.length - 1
      const idx = Math.min(n - 1, Math.floor(e * n))
      const f = e * n - idx
      const d = lerp(r.path[idx][0], r.path[idx + 1][0], f)
      const x = lerp(r.path[idx][1], r.path[idx + 1][1], f)
      this.placeBall(x, d, r.who)
      if (k >= 1) {
        r.done = true
        for (const p of r.knocked) this.pinState.set(p, 0)
        this.drawPins()
        if (r.knocked.length >= 6 && this.fx) this.fx.hitstop(110)
        if (r.outcome === 'strike' && this.fx) this.fx.shake(14)
        else if (r.knocked.length >= 6 && this.fx) this.fx.shake(6)
        const label = r.outcome === 'strike' ? 'STRIKE!' : r.outcome === 'spare' ? 'SPARE!' : r.outcome === 'gutter' || r.outcome === 'no_swing' ? (r.outcome === 'gutter' ? 'GUTTER' : 'NO ROLL') : r.knocked.length ? `${r.knocked.length}` : 'MISS'
        this.stamp.text = label; this.stamp.alpha = 1; this.stamp.scale.set(1.4)
      }
    } else if (!r || r.done) {
      this.stamp.alpha = Math.max(0, this.stamp.alpha - dtMs / 1400)
      this.stamp.scale.set(lerp(this.stamp.scale.x, 1, 0.2))
    }
  }

  unmount(): void { this.root.destroy({ children: true }) }
}
