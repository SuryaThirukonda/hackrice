// The ring: dark arena under spotlights, animated crowd, two boxers, HUD, 3-2-1, bell, knockdown counts, KO / decision cards.
import Phaser from 'phaser'
import type { GameClient } from '../client'
import { BoxingSim, FD, type Fighter, type SimEvent } from '../sims/boxing'
import { BoxerView } from './BoxerView'
import { sfx } from '../sfx'

export class BoxingScene extends Phaser.Scene {
  private client!: GameClient
  private sim: BoxingSim | null = null
  private viewA!: BoxerView
  private viewB!: BoxerView
  private crowd: Phaser.GameObjects.Arc[] = []
  private spot!: Phaser.GameObjects.Graphics
  private ringG!: Phaser.GameObjects.Graphics
  private ropesFront!: Phaser.GameObjects.Graphics
  private hud!: Record<string, Phaser.GameObjects.GameObject>
  private feed: string[] = []
  private feedText!: Phaser.GameObjects.Text
  private card!: Phaser.GameObjects.Text
  private cardSub!: Phaser.GameObjects.Text
  private countText!: Phaser.GameObjects.Text
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter
  private hitstop = 0
  private slowT = 0
  private shakeT = 0
  private kbSeats: Record<number, string> = {}
  private cursors: Record<string, Phaser.Input.Keyboard.Key> = {}
  private moveDir: Record<number, number> = {}
  private stepAccum = 0
  private unsub: (() => void)[] = []

  constructor() { super('boxing') }

  create(): void {
    this.client = this.registry.get('client') as GameClient
    this.sim = this.client.sim as BoxingSim
    this.feed = []
    this.kbSeats = { ...this.client.keyboardSeats }
    this.buildArena()
    this.buildHud()
    this.buildKeys()
    const onPhase = (phase: string, d: Record<string, unknown>) => this.onPhase(phase, d)
    const onCountdown = (n: number) => this.onCountdown(n)
    const onTurn = (res: { detail: Record<string, unknown> }) => this.onTurn(res)
    const onEnded = (d: Record<string, unknown>) => this.onEnded(d)
    const onTaunt = (d: Record<string, unknown>) => { if (d.line) this.pushFeed(`${this.sim?.b.name ?? 'House'}: "${String(d.line)}"`) }
    const onAborted = () => { this.time.delayedCall(800, () => this.scene.start('menu')) }
    this.client.on('phase', onPhase); this.client.on('countdown', onCountdown); this.client.on('turn', onTurn); this.client.on('ended', onEnded); this.client.on('decision', onTaunt); this.client.on('aborted', onAborted)
    this.unsub = [() => this.client.off('phase', onPhase), () => this.client.off('countdown', onCountdown), () => this.client.off('turn', onTurn), () => this.client.off('ended', onEnded), () => this.client.off('decision', onTaunt), () => this.client.off('aborted', onAborted)]
    this.events.once('shutdown', () => this.unsub.forEach((u) => u()))
    this.showCard(`${this.sim.a.name}  vs  ${this.sim.b.name}`, this.client.start?.mode === 'card' ? 'Fight Night' : 'Bets are open', 2500)
    sfx.crowdSwell(0.2, 2)
  }

  // ---- arena ------------------------------------------------------------------------------------------------------
  private buildArena(): void {
    const { width: W, height: H } = this.scale
    const bg = this.add.graphics().setDepth(0)
    bg.fillStyle(0x0b1220).fillRect(0, 0, W, H)
    bg.fillStyle(0x141f36, 0.9).fillRect(0, 0, W, H * 0.55)
    this.spot = this.add.graphics().setDepth(1)
    for (const cx of [W * 0.3, W * 0.7]) {
      this.spot.fillStyle(0xfff1b8, 0.07).fillTriangle(cx, -10, cx - W * 0.28, H * 0.78, cx + W * 0.28, H * 0.78)
      this.spot.fillStyle(0xfff1b8, 0.6).fillCircle(cx, 0, 26)
    }
    this.crowd = []
    for (let row = 0; row < 3; row++) {
      const y = H * (0.33 + row * 0.05), n = 18 + row * 4
      for (let i = 0; i < n; i++) {
        const c = this.add.circle((i + 0.5) * (W / n), y, 12 + row * 2, 0x1a2438).setDepth(2)
        c.setData('phase', i * 1.3 + row); c.setData('y', y)
        this.crowd.push(c)
      }
    }
    this.ringG = this.add.graphics().setDepth(3)
    const cx = W / 2, top = H * 0.5, bot = H * 0.86, hb = W * 0.42, ht = W * 0.3
    this.ringG.fillStyle(0x2a1e2e).fillPoints([{ x: cx - hb, y: bot + 30 }, { x: cx + hb, y: bot + 30 }, { x: cx + ht, y: top + 30 }, { x: cx - ht, y: top + 30 }], true)
    this.ringG.fillStyle(0xe7e2d3).fillPoints([{ x: cx - hb, y: bot }, { x: cx + hb, y: bot }, { x: cx + ht, y: top }, { x: cx - ht, y: top }], true)
    this.ringG.fillStyle(0xd8452e, 0.25).fillCircle(cx, (top + bot) / 2, H * 0.09)
    const posts = [[cx - hb, bot], [cx + hb, bot], [cx + ht, top], [cx - ht, top]]
    const cols = [0xd8452e, 0xffffff, 0x2ba1e8]
    for (let i = 0; i < 3; i++) {
      const dy = 26 + i * 22
      this.ringG.lineStyle(4, cols[i]).lineBetween(posts[3][0], posts[3][1] - dy, posts[2][0], posts[2][1] - dy).lineBetween(posts[0][0], posts[0][1] - dy, posts[3][0], posts[3][1] - dy).lineBetween(posts[1][0], posts[1][1] - dy, posts[2][0], posts[2][1] - dy)
    }
    for (const [x, y] of posts) this.ringG.fillStyle(0xdddddd).fillRect(x - 6, y - 96, 12, 100)
    this.ropesFront = this.add.graphics().setDepth(20)
    for (let i = 0; i < 3; i++) { const dy = 26 + i * 22; this.ropesFront.lineStyle(5, cols[i]).lineBetween(posts[0][0], posts[0][1] - dy, posts[1][0], posts[1][1] - dy) }
    if (!this.textures.exists('spark')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false); g.fillStyle(0xffffff).fillCircle(4, 4, 4); g.generateTexture('spark', 8, 8); g.destroy()
    }
    this.sparks = this.add.particles(0, 0, 'spark', { speed: { min: 120, max: 380 }, angle: { min: 0, max: 360 }, scale: { start: 1.2, end: 0 }, lifespan: 380, gravityY: 500, tint: [0xffe08a, 0xffffff, 0xff6b5b], emitting: false }).setDepth(30)
    this.dust = this.add.particles(0, 0, 'spark', { speed: { min: 30, max: 120 }, angle: { min: 200, max: 340 }, scale: { start: 1.5, end: 0 }, alpha: { start: 0.5, end: 0 }, lifespan: 600, tint: 0xd9d0c0, emitting: false }).setDepth(5)
    const s = this.sim!
    this.viewA = new BoxerView(this, this.ringX(s.a.x), H * 0.72, 0x2ba1e8, 0x1d7fc0, 1)
    this.viewB = new BoxerView(this, this.ringX(s.b.x), H * 0.72, 0xee6a5f, 0xb3261e, -1)
  }

  private ringX(x: number): number { return this.scale.width / 2 + x * this.scale.width * 0.36 }

  private buildHud(): void {
    const { width: W } = this.scale
    const mk = (x: number, y: number, size: number, color = '#eef2f6', align: 'left' | 'center' | 'right' = 'left', family = 'Nunito, sans-serif') =>
      this.add.text(x, y, '', { fontFamily: family, fontSize: `${size}px`, color, fontStyle: 'bold', align }).setDepth(50)
    const nameA = mk(30, 18, 26); const nameB = mk(W - 30, 18, 26, '#eef2f6', 'right').setOrigin(1, 0)
    const bars = this.add.graphics().setDepth(50)
    const clock = mk(W / 2, 20, 44, '#ffe08a', 'center', 'Lilita One, Nunito, sans-serif').setOrigin(0.5, 0)
    const round = mk(W / 2, 70, 18, '#9fb0c3', 'center').setOrigin(0.5, 0)
    this.feedText = mk(30, 108, 17, '#cbd5e1')
    const hints = mk(30, this.scale.height - 34, 15, '#9fb0c3')
    hints.setText(Object.entries(this.kbSeats).map(([slot]) => `P${slot}: ${slot === '1' ? 'A/D move · J jab · K hook · L block · P parry · W dodge' : '←/→ move · , jab · . hook · / block · Enter parry · ↑ dodge'}`).join('     '))
    this.card = this.add.text(W / 2, this.scale.height * 0.4, '', { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: '84px', color: '#ffffff', stroke: '#d8452e', strokeThickness: 12, align: 'center' }).setOrigin(0.5).setDepth(60).setAlpha(0)
    this.cardSub = this.add.text(W / 2, this.scale.height * 0.4 + 70, '', { fontFamily: 'Nunito, sans-serif', fontSize: '24px', color: '#ffe08a', fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(60).setAlpha(0)
    this.countText = this.add.text(W / 2, this.scale.height * 0.42, '', { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: '140px', color: '#ffe08a', stroke: '#d8452e', strokeThickness: 14 }).setOrigin(0.5).setDepth(61).setAlpha(0)
    this.hud = { nameA, nameB, bars, clock, round, hints }
  }

  private buildKeys(): void {
    const kb = this.input.keyboard!
    const map: Record<string, number> = { A: 65, D: 68, J: 74, K: 75, L: 76, SPACE: 32, P: 80, W: 87, LEFT: 37, RIGHT: 39, COMMA: 188, PERIOD: 190, FORWARD_SLASH: 191, ENTER: 13, UP: 38 }
    for (const [name, code] of Object.entries(map)) this.cursors[name] = kb.addKey(code)
    const bind = (slot: number, jab: string, hook: string, block: string, parry: string, dodge: string) => {
      const seat = () => this.kbSeats[slot]
      this.cursors[jab].on('down', () => seat() && this.client.localInput(seat(), 'punch', { type: 'jab', power: 0.75, duration_ms: 70 }))
      this.cursors[hook].on('down', () => seat() && this.client.localInput(seat(), 'punch', { type: 'hook', power: 0.9, duration_ms: 110 }))
      this.cursors[block].on('down', () => seat() && this.client.localInput(seat(), 'block_on'))
      this.cursors[block].on('up', () => seat() && this.client.localInput(seat(), 'block_off'))
      this.cursors[parry].on('down', () => seat() && this.client.localInput(seat(), 'parry'))
      this.cursors[dodge].on('down', () => { const s = seat(); if (!s) return; const f = this.sim?.fighterForSeat(s); this.client.localInput(s, 'dodge', { dir: f ? -f.facing : -1 }) })
    }
    bind(1, 'J', 'K', 'L', 'P', 'W'); bind(2, 'COMMA', 'PERIOD', 'FORWARD_SLASH', 'ENTER', 'UP')
    this.cursors.SPACE.on('down', () => this.kbSeats[1] && this.client.localInput(this.kbSeats[1], 'block_on'))
    this.cursors.SPACE.on('up', () => this.kbSeats[1] && this.client.localInput(this.kbSeats[1], 'block_off'))
    this.input.once('pointerdown', () => sfx.unlock()); kb.once('keydown', () => sfx.unlock())
  }

  private pollMovement(): void {
    const dirs: Record<number, number> = { 1: (this.cursors.D.isDown ? 1 : 0) - (this.cursors.A.isDown ? 1 : 0), 2: (this.cursors.RIGHT.isDown ? 1 : 0) - (this.cursors.LEFT.isDown ? 1 : 0) }
    for (const slot of [1, 2]) {
      const seat = this.kbSeats[slot]
      if (!seat) continue
      if (this.moveDir[slot] !== dirs[slot]) { this.moveDir[slot] = dirs[slot]; this.client.localInput(seat, dirs[slot] ? 'move' : 'move_stop', { dir: dirs[slot] }) }
    }
  }

  // ---- events ---------------------------------------------------------------------------------------------------
  private onPhase(phase: string, d: Record<string, unknown>): void {
    if (phase === 'betting') { const p = (d as { prompt?: { round?: number } }).prompt ?? {}; this.showCard(`ROUND ${p.round ?? ''}`, 'Bets are open on the rail', 2200) }
    if (phase === 'paused') this.showCard('PAUSED', String(d.reason ?? ''), 1500)
    if (phase === 'resolving') { const res = d as { detail?: { round?: number; winner?: string; ko?: string } }; const det = res.detail ?? {}; const s = this.sim!
      if (!det.ko) { sfx.bell(2); this.showCard(`ROUND ${det.round ?? ''} OVER`, det.winner === s.a.id ? `${s.a.name} takes the round` : det.winner === s.b.id ? `${s.b.name} takes the round` : 'Even round', 2600) } }
  }
  private onCountdown(n: number): void {
    sfx.countdown(n)
    this.countText.setText(n > 0 ? String(n) : 'FIGHT!').setAlpha(1).setScale(1.6)
    this.tweens.add({ targets: this.countText, scale: 1, duration: 300, ease: 'Back.Out' })
    if (n === 0) { sfx.bell(1); this.tweens.add({ targets: this.countText, alpha: 0, delay: 500, duration: 300 }) }
  }
  private onTurn(res: { detail: Record<string, unknown> }): void { void res }
  private onEnded(d: Record<string, unknown>): void {
    const s = this.sim, w = String(d.winner)
    const match = d.match as { players?: Record<string, string> } | undefined
    let title = 'DRAW'
    if (s) title = w === s.a.id ? `${s.a.name.toUpperCase()} WINS` : w === s.b.id ? `${s.b.name.toUpperCase()} WINS` : 'DRAW'
    if (match?.players && match.players[w]) title = `${match.players[w].toUpperCase()} WINS`
    sfx.win()
    this.showCard(title, s?.ko ? 'by knockout' : 'by decision', 4500)
    this.time.delayedCall(4800, () => this.scene.start('menu', { result: d }))
  }

  private onSimEvent(e: SimEvent): void {
    const s = this.sim!
    const view = (id?: string) => (id === s.a.id ? this.viewA : this.viewB)
    const name = (id?: string) => (id === s.a.id ? s.a.name : s.b.name)
    const other = (id?: string) => (id === s.a.id ? s.b.id : s.a.id)
    switch (e.kind) {
      case 'windup': sfx.whoosh(e.type === 'hook'); break
      case 'punch': {
        const v = view(other(e.who))
        if (e.result === 'hit') {
          sfx.thud(e.type !== 'jab', 0.9); v.flash(); this.sparks.explode(e.type === 'jab' ? 10 : 18, v.x + v.facing * -30, v.y - 150); this.shake(e.type === 'jab' ? 6 : 12); sfx.crowdSwell(0.12, 0.6)
          this.pushFeed(`${name(e.who)} lands a ${e.type} (${e.dmg})`)
        } else if (e.result === 'blocked') { sfx.block(); this.sparks.explode(4, v.x, v.y - 150); this.pushFeed(`${name(other(e.who))} blocks the ${e.type}`) }
        else if (e.result === 'whiff') this.pushFeed(`${name(e.who)} swings at air`)
        else if (e.result === 'dodged') { sfx.dodge(); this.pushFeed(`${name(other(e.who))} slips the ${e.type}`) }
        break }
      case 'parry': if (e.result === 'success') { sfx.parry(); this.sparks.explode(24, view(e.who).x, view(e.who).y - 150); this.hitstop = 0.12; this.pushFeed(`${name(e.who)} PARRIES!`) } else this.pushFeed(`${name(e.who)} whiffs the parry`); break
      case 'dodge': sfx.dodge(); this.dust.explode(8, view(e.who).x, view(e.who).y); break
      case 'knockdown': sfx.knockdown(); this.shake(22); this.slowT = 1.4; this.dust.explode(20, view(e.who).x, view(e.who).y); this.showCard(e.ko ? 'K.O.!' : 'KNOCKDOWN!', e.ko ? `${name(e.who)} is out` : `${name(e.who)} is down`, e.ko ? 4000 : 2000); if (e.ko) sfx.ko(); break
      case 'count': sfx.count(); this.countText.setText(String(e.count)).setAlpha(1).setScale(1.3); this.tweens.add({ targets: this.countText, scale: 1, alpha: 0, duration: 420 }); break
      case 'getup': this.pushFeed(`${name(e.who)} beats the count`); sfx.crowdSwell(0.2, 1.5); break
      case 'gassed': sfx.gassed(); this.pushFeed(`${name(e.who)} is gassed`); break
      case 'bell': sfx.bell(1); break
      case 'rhythm': this.pushFeed(`${name(e.who)} read the rhythm`); break
      case 'second_wind': this.pushFeed(`${name(e.who)} gets a second wind`); break
    }
  }

  private shake(px: number): void { this.shakeT = Math.max(this.shakeT, px); this.cameras.main.shake(120, px / 4000) }
  private pushFeed(line: string): void { this.feed.push(line); if (this.feed.length > 4) this.feed.shift(); this.feedText.setText(this.feed.join('\n')) }
  private showCard(text: string, sub: string, ms: number): void {
    this.card.setText(text).setAlpha(1).setScale(1.25); this.cardSub.setText(sub).setAlpha(1)
    this.tweens.killTweensOf([this.card, this.cardSub])
    this.tweens.add({ targets: this.card, scale: 1, duration: 260, ease: 'Back.Out' })
    this.tweens.add({ targets: [this.card, this.cardSub], alpha: 0, delay: ms, duration: 400 })
  }

  // ---- frame ------------------------------------------------------------------------------------------------------
  update(_t: number, deltaMs: number): void {
    const s = this.client.sim as BoxingSim | null
    if (!s) return
    this.sim = s
    let dt = deltaMs / 1000
    if (this.hitstop > 0) { this.hitstop -= dt; dt = 0 }
    else if (this.slowT > 0) { this.slowT -= dt; dt *= 0.3 }
    this.pollMovement()
    if (dt > 0) {
      // fixed-step the sim so physics is frame-rate independent
      this.stepAccum += dt
      const h = 1 / 120
      let n = 0
      while (this.stepAccum >= h && n < 8) {
        this.client.update(h)
        for (const e of s.events) this.onSimEvent(e)
        if (s.flags.hitstop) this.hitstop = 0.09
        if (s.flags.slowmo) this.slowT = 1.4
        this.stepAccum -= h; n++
        if (this.client.phase !== 'input' && this.client.phase !== 'countdown') break
      }
      if (this.client.phase !== 'input') this.client.update(dt)
    }
    // crowd bob
    for (const c of this.crowd) c.y = (c.getData('y') as number) + Math.sin(this.time.now / 500 + (c.getData('phase') as number)) * 3
    // boxers
    const rdt = deltaMs / 1000
    const reachPx = (id: string) => (FD[(id === s.a.id ? s.a : s.b).punch] ?? FD.jab).reach * this.scale.width * 0.36
    this.viewA.x += (this.ringX(s.a.x) - this.viewA.x) * Math.min(1, rdt * 20); this.viewA.render(s.a, rdt, reachPx(s.a.id))
    this.viewB.x += (this.ringX(s.b.x) - this.viewB.x) * Math.min(1, rdt * 20); this.viewB.render(s.b, rdt, reachPx(s.b.id))
    this.viewA.setDepth(s.a.x <= s.b.x ? 10 : 11); this.viewB.setDepth(s.a.x <= s.b.x ? 11 : 10)
    this.drawHud(s)
  }

  private drawHud(s: BoxingSim): void {
    const { width: W } = this.scale
    const g = this.hud.bars as Phaser.GameObjects.Graphics
    g.clear()
    const bar = (x: number, y: number, w: number, h: number, v: number, col: number, right: boolean) => {
      g.fillStyle(0x1a1f2b).fillRoundedRect(x, y, w, h, 5)
      const fw = w * Math.max(0, Math.min(1, v / 100))
      g.fillStyle(col).fillRoundedRect(right ? x + w - fw : x, y, fw, h, 5)
    }
    const hpCol = (v: number) => (v > 50 ? 0x63c26a : v > 25 ? 0xffe08a : 0xd8452e)
    bar(30, 52, W * 0.38, 18, s.a.hp, hpCol(s.a.hp), false); bar(30, 76, W * 0.38, 9, s.a.stamina, 0x2ba1e8, false)
    bar(W - 30 - W * 0.38, 52, W * 0.38, 18, s.b.hp, hpCol(s.b.hp), true); bar(W - 30 - W * 0.38, 76, W * 0.38, 9, s.b.stamina, 0x2ba1e8, true)
    const st = (f: Fighter) => (f.state === 'block' ? ' · GUARD' : f.state !== 'idle' ? ` · ${f.state.toUpperCase()}` : '')
    ;(this.hud.nameA as Phaser.GameObjects.Text).setText(`${s.a.name}${st(s.a)}`)
    ;(this.hud.nameB as Phaser.GameObjects.Text).setText(`${st(s.b)} ${s.b.name}`)
    const secs = Math.max(0, Math.ceil(s.roundS - s.clock))
    ;(this.hud.clock as Phaser.GameObjects.Text).setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`)
    ;(this.hud.round as Phaser.GameObjects.Text).setText(`ROUND ${s.roundNo} OF ${s.rounds}   ·   KD ${s.a.knockdowns}-${s.b.knockdowns}`)
  }
}
