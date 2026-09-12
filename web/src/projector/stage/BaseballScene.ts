import { Container, Graphics, Text, type Application } from 'pixi.js'
import { clamp01, easeOut, lerp, type Effects, type Scene, type Tick } from './Scene'

interface Pitch { kind: string; release_ts: number; arrival_ts: number; travel_ms: number; height: number; brk: number; no: number }
interface Ev { kind: string; result?: string; dir?: number; dist?: number; dt_ms?: number | null; swung?: boolean; strikes?: number; no?: number; kind_?: string }

/** Night ballpark: lights, outfield, diamond; pitch flight from server timestamps; hit arcs from dir/dist. */
export class BaseballScene implements Scene {
  private root = new Container()
  private bg = new Graphics()
  private field = new Graphics()
  private actors = new Graphics()
  private ball = new Graphics()
  private stamp = new Text({ text: '', style: { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: 80, fill: 0xffffff, stroke: { color: 0x1d7fc0, width: 9 } } })
  private label = new Text({ text: '', style: { fontFamily: 'Nunito, sans-serif', fontSize: 20, fill: 0xeef2f6, fontWeight: '900' } })
  private w = 800; private h = 600; private t = 0
  private pitch: Pitch | null = null
  private serverNow: () => number
  private swingT = 0; private stampT = 0
  private hit: { t: number; dir: number; dist: number; result: string } | null = null
  private houseHit: { t: number; dir: number; dist: number; result: string } | null = null
  private fx: Effects | null

  constructor(fx: Effects | undefined, serverNow: () => number) { this.fx = fx ?? null; this.serverNow = serverNow }

  mount(_app: Application, root: Container, size: { w: number; h: number }): void {
    root.addChild(this.root)
    this.root.addChild(this.bg, this.field, this.actors, this.ball, this.stamp, this.label)
    this.stamp.anchor.set(0.5); this.stamp.alpha = 0; this.label.anchor.set(0.5)
    this.resize(size)
  }

  resize(size: { w: number; h: number }): void {
    this.w = size.w; this.h = size.h
    this.drawBg(); this.drawField()
    this.stamp.position.set(this.w / 2, this.h * 0.38); this.label.position.set(this.w / 2, this.h * 0.95)
  }

  private mound() { return { x: this.w / 2, y: this.h * 0.47 } }
  private plate() { return { x: this.w / 2, y: this.h * 0.86 } }

  private drawBg() {
    const g = this.bg; g.clear()
    g.rect(0, 0, this.w, this.h).fill(0x0a1020)
    g.rect(0, 0, this.w, this.h * 0.4).fill(0x0f1a33)
    for (let i = 0; i < 60; i++) { const x = ((i * 7919) % 1000) / 1000 * this.w, y = ((i * 104729) % 1000) / 1000 * this.h * 0.3; g.circle(x, y, 1.2).fill({ color: 0xffffff, alpha: 0.6 }) }
    for (const cx of [this.w * 0.12, this.w * 0.88]) {
      g.rect(cx - 4, this.h * 0.05, 8, this.h * 0.32).fill(0x2a3648)
      g.roundRect(cx - 40, this.h * 0.03, 80, 22, 6).fill(0xfff1b8)
      g.poly([cx - 40, this.h * 0.05, cx + 40, this.h * 0.05, cx + this.w * 0.3, this.h * 0.7, cx - this.w * 0.3, this.h * 0.7]).fill({ color: 0xfff1b8, alpha: 0.06 })
    }
    // scoreboard silhouette
    g.roundRect(this.w * 0.38, this.h * 0.08, this.w * 0.24, this.h * 0.12, 8).fill(0x16203a).stroke({ width: 3, color: 0x2a3648 })
    // outfield wall + crowd band
    g.rect(0, this.h * 0.3, this.w, this.h * 0.08).fill(0x1a2438)
    g.rect(0, this.h * 0.38, this.w, this.h * 0.03).fill(0x2f6b3a)
  }

  private drawField() {
    const g = this.field; g.clear()
    g.rect(0, this.h * 0.41, this.w, this.h * 0.6).fill(0x2e7d3c)
    for (let i = 0; i < 8; i++) g.rect(0, this.h * (0.41 + i * 0.075), this.w, this.h * 0.037).fill({ color: 0x35913f, alpha: 0.5 })
    const p = this.plate(), m = this.mound()
    const dx = this.w * 0.28, dy = this.h * 0.24
    g.poly([p.x, p.y, p.x + dx, p.y - dy, p.x, m.y - dy * 0.9, p.x - dx, p.y - dy]).fill(0xc48447)         // infield dirt diamond
    g.poly([p.x, p.y - 10, p.x + dx - 24, p.y - dy, p.x, m.y - dy * 0.9 + 22, p.x - dx + 24, p.y - dy]).fill(0x2e7d3c)
    for (const [x, y] of [[p.x + dx, p.y - dy], [p.x, m.y - dy * 0.9], [p.x - dx, p.y - dy]]) g.rect(x - 8, y - 8, 16, 16).fill(0xffffff)
    g.ellipse(m.x, m.y, 44, 16).fill(0xc48447); g.rect(m.x - 10, m.y - 3, 20, 6).fill(0xffffff)
    g.poly([p.x - 14, p.y, p.x + 14, p.y, p.x + 14, p.y + 10, p.x, p.y + 20, p.x - 14, p.y + 10]).fill(0xffffff)
    g.rect(p.x - 70, p.y - 40, 40, 70).stroke({ width: 2, color: 0xffffff, alpha: 0.5 }); g.rect(p.x + 30, p.y - 40, 40, 70).stroke({ width: 2, color: 0xffffff, alpha: 0.5 })
  }

  onMatch(): void { this.pitch = null; this.hit = null; this.houseHit = null }
  onPhase(phase: { phase: string; prompt?: Record<string, unknown> } | null): void {
    if (!phase) return
    if (phase.phase === 'betting') { this.label.text = 'Bets are open'; this.pitch = null }
    if (phase.phase === 'input') { const p = (phase.prompt ?? {}) as { inning?: number; outs?: number; sudden_death?: boolean }; this.label.text = p.sudden_death ? 'SUDDEN DEATH · three strikes and it is over' : `Inning ${p.inning ?? ''} · ${p.outs ?? 0} out` }
  }

  onTick(tick: Tick): void {
    const t = tick as { pitch?: Pitch | null; events?: Ev[]; who?: string; result?: string; dir?: number; dist?: number; strikes?: number; human?: { outs: number; runs: number }; house?: { runs: number } }
    if (t.who === 'house') { this.houseHit = { t: 0, dir: t.dir ?? 0, dist: t.dist ?? 0, result: t.result ?? 'out' }; this.showStamp(t.result === 'out' ? 'OUT' : (t.result ?? '').replace('_', ' ').toUpperCase(), 0xee6a5f); return }
    if (t.pitch) this.pitch = t.pitch
    for (const e of t.events ?? []) {
      if (e.kind === 'pitch') { this.pitch = e as unknown as Pitch; this.hit = null }
      if (e.kind === 'result') {
        if (e.swung) this.swingT = 0.35
        const r = e.result ?? ''
        if (r === 'miss' || r === 'called') this.showStamp(`STRIKE ${e.strikes ?? ''}`, 0xffe08a)
        else if (r === 'foul') this.showStamp('FOUL', 0xffe08a)
        else if (r === 'out') { this.showStamp('OUT', 0xee6a5f); this.hit = { t: 0, dir: e.dir ?? 0, dist: e.dist ?? 0.3, result: 'out' } }
        else { this.showStamp(r === 'home_run' ? 'HOME RUN!' : r.toUpperCase() + '!', 0x7ddc9a); this.hit = { t: 0, dir: e.dir ?? 0, dist: e.dist ?? 0.5, result: r }; this.fx?.shake(r === 'home_run' ? 18 : 8); if (r === 'home_run') this.fx?.hitstop(120) }
        if (r !== 'foul' && r !== 'miss' && r !== 'called') this.pitch = null
        else this.pitch = null
      }
    }
    if (t.events?.some((e) => e.kind === 'swing' && (e as { no_pitch?: boolean }).no_pitch)) this.swingT = 0.3
  }

  private showStamp(text: string, color: number) { this.stamp.text = text; this.stamp.style.stroke = { color, width: 9 }; this.stamp.alpha = 1; this.stampT = 1.3; this.stamp.scale.set(1.35) }

  update(dtMs: number): void {
    const dt = dtMs / 1000
    this.t += dt
    this.drawActors()
    const g = this.ball; g.clear()
    const m = this.mound(), p = this.plate()
    if (this.pitch) {
      const now = this.serverNow()
      const k = clamp01((now - this.pitch.release_ts) / Math.max(1, this.pitch.arrival_ts - this.pitch.release_ts))
      const x = lerp(m.x, p.x + this.pitch.brk * 60 * k, k), y = lerp(m.y - 30, p.y - 40 - (this.pitch.height - 0.5) * 60, k)
      const r = lerp(5, 16, k)
      g.circle(x, y, r).fill(0xffffff).stroke({ width: 2, color: 0xd8452e })
      if (k >= 1) this.pitch = null
    }
    for (const h of [this.hit, this.houseHit]) {
      if (!h) continue
      h.t += dt
      const k = clamp01(h.t / 1.4), e = easeOut(k)
      const endX = p.x + h.dir * this.w * 0.42 * h.dist, endY = p.y - this.h * 0.5 * h.dist
      const x = lerp(p.x, endX, e), y = lerp(p.y - 40, endY, e) - Math.sin(k * Math.PI) * this.h * 0.25 * h.dist
      g.circle(x, y, lerp(14, 6, k)).fill(0xffffff).stroke({ width: 2, color: 0xd8452e })
      if (k >= 1) { if (h === this.hit) this.hit = null; else this.houseHit = null }
    }
    if (this.swingT > 0) this.swingT -= dt
    if (this.stampT > 0) { this.stampT -= dt; this.stamp.alpha = Math.min(1, this.stampT); this.stamp.scale.set(lerp(this.stamp.scale.x, 1, 0.2)) } else this.stamp.alpha = 0
  }

  private drawActors() {
    const g = this.actors; g.clear()
    const m = this.mound(), p = this.plate()
    // pitcher
    g.ellipse(m.x, m.y + 8, 22, 8).fill({ color: 0x000000, alpha: 0.25 })
    g.roundRect(m.x - 14, m.y - 46, 28, 36, 10).fill(0xee6a5f).stroke({ width: 3, color: 0x1a1f2b })
    g.circle(m.x, m.y - 58, 13).fill(0xf6c9a0).stroke({ width: 3, color: 0x1a1f2b })
    g.roundRect(m.x - 14, m.y - 72, 28, 10, 4).fill(0xb3261e)
    // batter (right of plate), bat swings when swingT > 0
    const bx = p.x + 52, by = p.y - 20
    g.ellipse(bx, by + 10, 26, 9).fill({ color: 0x000000, alpha: 0.25 })
    g.roundRect(bx - 18, by - 60, 36, 50, 12).fill(0x2ba1e8).stroke({ width: 3, color: 0x1a1f2b })
    g.circle(bx, by - 76, 16).fill(0xf6c9a0).stroke({ width: 3, color: 0x1a1f2b })
    g.roundRect(bx - 18, by - 94, 36, 12, 5).fill(0x1d7fc0)
    const ang = this.swingT > 0 ? -2.4 + (0.35 - this.swingT) / 0.35 * 3.2 : -2.4
    const bl = 62
    g.moveTo(bx - 10, by - 50).lineTo(bx - 10 + Math.cos(ang) * bl, by - 50 + Math.sin(ang) * bl).stroke({ width: 9, color: 0xc48447 })
  }

  unmount(): void { this.root.destroy({ children: true }) }
}
