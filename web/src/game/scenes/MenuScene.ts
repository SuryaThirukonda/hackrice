// Player flow: title -> mode (1P / 2P / Fight Night) -> game -> remote (keyboard or phone QR per player) -> start.
import Phaser from 'phaser'
import type { GameClient } from '../client'
import { sfx } from '../sfx'

type Screen = 'title' | 'mode' | 'game' | 'remote' | 'results'
interface Item { label: string; act: () => void; enabled?: boolean }

export class MenuScene extends Phaser.Scene {
  private client!: GameClient
  private screen: Screen = 'title'
  private mode: '1p' | '2p' | 'card' = '1p'
  private sport = 'boxing'
  private tier = 'rookie'
  private remotes: Record<number, 'keyboard' | 'phone'> = {}
  private index = 0
  private items: Item[] = []
  private title!: Phaser.GameObjects.Text
  private hint!: Phaser.GameObjects.Text
  private status!: Phaser.GameObjects.Text
  private planks: Phaser.GameObjects.Container[] = []
  private qrs: Phaser.GameObjects.GameObject[] = []
  private result: Record<string, unknown> | null = null
  private unsub: (() => void)[] = []

  constructor() { super('menu') }

  init(data: { result?: Record<string, unknown> }): void { this.result = data?.result ?? null }

  create(): void {
    this.client = this.registry.get('client') as GameClient
    const { width: W, height: H } = this.scale
    const bg = this.add.graphics()
    bg.fillStyle(0x0b1220).fillRect(0, 0, W, H)
    bg.fillGradientStyle(0x1b2a4a, 0x1b2a4a, 0x0b1220, 0x0b1220, 1).fillRect(0, 0, W, H * 0.6)
    for (const cx of [W * 0.2, W * 0.8]) bg.fillStyle(0xfff1b8, 0.05).fillTriangle(cx, -10, cx - W * 0.25, H, cx + W * 0.25, H)
    this.title = this.add.text(W / 2, 70, '', { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: '56px', color: '#ffe08a', stroke: '#6b3d16', strokeThickness: 8 }).setOrigin(0.5)
    this.hint = this.add.text(W / 2, H - 70, '', { fontFamily: 'Nunito, sans-serif', fontSize: '18px', color: '#9fb0c3', fontStyle: 'bold', align: 'center' }).setOrigin(0.5)
    this.status = this.add.text(W / 2, H - 36, '', { fontFamily: 'Nunito, sans-serif', fontSize: '15px', color: '#7f8a94' }).setOrigin(0.5)
    const kb = this.input.keyboard!
    kb.on('keydown-DOWN', () => this.move(1)); kb.on('keydown-UP', () => this.move(-1))
    kb.on('keydown-ENTER', () => this.activate()); kb.on('keydown-SPACE', () => this.activate()); kb.on('keydown-ESC', () => this.back())
    kb.once('keydown', () => sfx.unlock()); this.input.once('pointerdown', () => sfx.unlock())
    const onSeats = () => { if (this.screen === 'remote') this.rebuild() }
    const onMatch = () => this.scene.start('boxing')
    const onError = (m: string) => { this.status.setText(m) }
    const onConn = () => this.status.setText('connected to the arena')
    const onDisc = () => this.status.setText('arena disconnected: reconnecting')
    const onAborted = (reason: string) => this.status.setText(`could not start: ${reason}`)
    this.client.on('seats', onSeats); this.client.on('snapshot', onSeats); this.client.on('match', onMatch); this.client.on('error', onError); this.client.on('connected', onConn); this.client.on('disconnected', onDisc); this.client.on('aborted', onAborted)
    this.unsub = [() => { this.client.off('seats', onSeats); this.client.off('snapshot', onSeats); this.client.off('match', onMatch); this.client.off('error', onError); this.client.off('connected', onConn); this.client.off('disconnected', onDisc); this.client.off('aborted', onAborted) }]
    this.events.once('shutdown', () => this.unsub.forEach((u) => u()))
    this.status.setText(this.client.socket.connected ? 'connected to the arena' : 'connecting to the arena…')
    this.go(this.result ? 'results' : 'title')
  }

  private slots(): number[] { return this.mode === '2p' ? [1, 2] : [1] }
  private seatFor(slot: number): string { return this.mode === '2p' ? (slot === 1 ? 'A' : 'B') : 'P1' }
  private tiers = ['rookie', 'contender', 'champion', 'boss']

  private go(s: Screen): void {
    this.screen = s; this.index = 0
    switch (s) {
      case 'title': this.items = [{ label: 'Play', act: () => this.go('mode') }]; break
      case 'mode': this.items = [
        { label: '1 Player  ·  vs the House', act: () => { this.mode = '1p'; this.go('game') } },
        { label: '2 Players  ·  head to head', act: () => { this.mode = '2p'; this.go('game') } },
        { label: 'Fight Night  ·  the House fights itself', act: () => { this.mode = 'card'; this.sport = 'boxing'; this.startMatch() } }]; break
      case 'game': this.items = [
        { label: 'Boxing', act: () => { this.sport = 'boxing'; this.go('remote') } },
        { label: 'Bowling  ·  coming to the Phaser client', act: () => {}, enabled: false },
        { label: 'Baseball  ·  coming to the Phaser client', act: () => {}, enabled: false },
        ...(this.mode === '1p' ? [{ label: `Opponent: ${this.tier}`, act: () => { this.tier = this.tiers[(this.tiers.indexOf(this.tier) + 1) % 4]; this.rebuild() } }] : []),
        { label: 'Back', act: () => this.go('mode') }]; break
      case 'remote': this.remotes = {}; this.client.unbindKeyboard(); this.client.setSeats(this.mode === '2p' ? '2p' : '1p'); this.items = this.remoteItems(); break
      case 'results': this.items = [{ label: 'Rematch', act: () => this.go('remote') }, { label: 'Game select', act: () => this.go('game') }, { label: 'Title', act: () => this.go('title') }]; break
    }
    this.rebuild()
  }

  private remoteItems(): Item[] {
    const items: Item[] = []
    for (const slot of this.slots()) {
      const seat = this.client.seat(this.seatFor(slot))
      const claimed = seat.status === 'claimed'
      let label = `Player ${slot}:  `
      if (this.remotes[slot] === 'keyboard') label += `keyboard ✓   (${slot === 1 ? 'A/D · J · K · L · P · W' : '←/→ · , · . · / · Enter · ↑'})`
      else if (claimed) label += `phone ✓  ${String(seat.nickname ?? '')}`
      else label += 'press Enter for keyboard, or scan the QR with a phone'
      items.push({ label, act: () => { this.remotes[slot] = 'keyboard'; this.client.bindKeyboard(this.seatFor(slot), slot); this.rebuild() } })
    }
    items.push({ label: this.allReady() ? 'Start the fight' : 'Start  (waiting for players)', act: () => { if (this.allReady()) this.startMatch(); else this.status.setText('each player needs a keyboard or a phone first') } })
    items.push({ label: 'Back', act: () => this.go('game') })
    return items
  }
  private allReady(): boolean { return this.slots().every((slot) => this.remotes[slot] === 'keyboard' || this.client.seat(this.seatFor(slot)).status === 'claimed') }
  private startMatch(): void { this.status.setText('starting…'); this.client.requestStart(this.sport, this.mode, this.mode === '1p' ? this.tier : '') }

  private move(d: number): void { if (!this.items.length) return; this.index = (this.index + d + this.items.length) % this.items.length; sfx.menuMove(); this.rebuild() }
  private activate(): void { const it = this.items[this.index]; if (it && it.enabled !== false) { sfx.menuSelect(); it.act() } }
  private back(): void { const m: Record<Screen, Screen | null> = { title: null, mode: 'title', game: 'mode', remote: 'game', results: 'game' }; const t = m[this.screen]; if (t) this.go(t) }

  private rebuild(): void {
    if (this.screen === 'remote') this.items = this.remoteItems()
    const { width: W, height: H } = this.scale
    for (const p of this.planks) p.destroy(); this.planks = []
    for (const q of this.qrs) q.destroy(); this.qrs = []
    const titles: Record<Screen, string> = { title: 'THE HOUSE ALWAYS PLAYS', mode: 'Choose a mode', game: `Choose a game${this.mode === '2p' ? '  ·  2 players' : ''}`, remote: 'Choose your remote', results: this.resultTitle() }
    this.title.setText(titles[this.screen])
    const hints: Record<Screen, string> = { title: 'Enter to play  ·  phones scan the rail QR on the projector to bet', mode: '↑↓ choose  ·  Enter confirm  ·  Esc back', game: '↑↓ choose  ·  Enter confirm  ·  Esc back', remote: 'Select a player line and press Enter for keyboard, or scan that player\'s QR with a phone', results: JSON.stringify(this.result?.score ?? {}).slice(0, 140) }
    this.hint.setText(hints[this.screen])
    const startY = H / 2 - (this.items.length * 76) / 2 + 20
    this.items.forEach((it, i) => this.planks.push(this.plank(W / 2, startY + i * 76, it.label, i === this.index, it.enabled !== false, () => { this.index = i; this.activate() })))
    if (this.screen === 'remote') {
      let x = W - 40
      for (const slot of [...this.slots()].reverse()) {
        const seat = this.client.seat(this.seatFor(slot))
        const url = seat.join_url ? String(seat.join_url) : ''
        if (url && this.remotes[slot] !== 'keyboard') { this.addQr(url, `Player ${slot}`, x - 110, H - 200); x -= 240 }
      }
    }
  }

  private resultTitle(): string {
    const r = this.result as { winner?: string; score?: Record<string, unknown>; match?: { players?: Record<string, string>; tier?: { name?: string }; tier_b?: { name?: string } } } | null
    if (!r) return ''
    const w = r.winner ?? ''
    if (w === 'human') return `${Object.values(r.match?.players ?? {}).join(', ')} beat the House!`
    if (w === 'house' || w === 'a') return `${r.match?.tier?.name ?? 'The House'} wins`
    if (w === 'b') return `${r.match?.tier_b?.name ?? 'The House'} wins`
    if (r.match?.players?.[w]) return `${r.match.players[w]} wins!`
    return 'Dead heat'
  }

  private plank(x: number, y: number, label: string, selected: boolean, enabled: boolean, onClick: () => void): Phaser.GameObjects.Container {
    const w = 640, h = 62
    const c = this.add.container(x, y)
    const g = this.add.graphics()
    g.fillStyle(0x5a2f0e).fillRoundedRect(-w / 2, -h / 2 + 8, w, h, 16)
    g.fillStyle(selected ? 0xd9a05a : 0xb7763b, enabled ? 1 : 0.5).fillRoundedRect(-w / 2, -h / 2, w, h, 16)
    g.fillStyle(0x7a4519, 0.6).fillRect(-w / 2 + 12, h / 2 - 8, w - 24, 4)
    g.fillStyle(0x3b3b3b).fillCircle(-w / 2 + 18, 0, 6).fillCircle(w / 2 - 18, 0, 6)
    const t = this.add.text(0, 0, label, { fontFamily: 'Lilita One, Nunito, sans-serif', fontSize: '28px', color: enabled ? '#4a2a0f' : '#7a5a3a' }).setOrigin(0.5)
    c.add([g, t]); c.setSize(w, h); c.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
    c.on('pointerdown', onClick); c.setAngle(selected ? 0 : (Math.random() > 0.5 ? 1 : -1) * 0.8)
    if (selected) this.tweens.add({ targets: c, scaleX: 1.03, scaleY: 1.03, duration: 200, ease: 'Back.Out' })
    return c
  }

  private addQr(url: string, label: string, x: number, y: number): void {
    const key = 'qr:' + url
    const show = () => { if (!this.scene.isActive()) return; const img = this.add.image(x, y, key).setDisplaySize(190, 190); const t = this.add.text(x, y + 112, `${label} · scan to play`, { fontFamily: 'Nunito, sans-serif', fontSize: '16px', color: '#ffe08a', fontStyle: 'bold' }).setOrigin(0.5); this.qrs.push(img, t) }
    if (this.textures.exists(key)) { show(); return }
    const base = this.client.socket.url().replace(/^wss?:\/\//, (m) => (m === 'wss://' ? 'https://' : 'http://')).replace(/\/ws\?.*$/, '')
    this.load.image(key, `${base}/api/qr.png?size=6&text=${encodeURIComponent(url)}`)
    this.load.once('complete', show); this.load.start()
  }
}
