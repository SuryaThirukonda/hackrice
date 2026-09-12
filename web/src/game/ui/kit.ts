// Small Phaser UI kit shared by every page: text styles, panels, buttons (plank / pill), bars, QR images, toasts.
import Phaser from 'phaser'

export const FONT = 'Nunito, "Segoe UI", system-ui, sans-serif'
export const DISPLAY = 'Lilita One, Nunito, sans-serif'
export const C = { bg: 0x0b1220, bg2: 0x101a2c, tile: 0x16203a, line: 0x2a3648, ink: '#eef2f6', ink2: '#9fb0c3', gold: '#ffe08a', goldN: 0xffe08a, blue: 0x2ba1e8, blueN: '#7cc4f0', green: 0x63c26a, red: 0xd8452e, redN: '#ff9c8f', wood: 0xb7763b, woodHi: 0xd9a05a, woodDark: 0x5a2f0e, woodInk: '#4a2a0f' }

export function text(scene: Phaser.Scene, x: number, y: number, s: string, size = 18, color = C.ink, opts: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}): Phaser.GameObjects.Text {
  return scene.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: 'bold', ...opts })
}
export function display(scene: Phaser.Scene, x: number, y: number, s: string, size = 40, color = C.gold): Phaser.GameObjects.Text {
  return scene.add.text(x, y, s, { fontFamily: DISPLAY, fontSize: `${size}px`, color, stroke: '#6b3d16', strokeThickness: Math.max(3, size / 8) })
}

export class Panel extends Phaser.GameObjects.Container {
  bg: Phaser.GameObjects.Graphics
  title?: Phaser.GameObjects.Text
  w: number; h: number
  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, title?: string, color = C.tile) {
    super(scene, x, y)
    this.w = w; this.h = h
    this.bg = scene.add.graphics()
    this.bg.fillStyle(0x000000, 0.35).fillRoundedRect(4, 8, w, h, 18)
    this.bg.fillStyle(color).fillRoundedRect(0, 0, w, h, 18)
    this.bg.lineStyle(2, C.line).strokeRoundedRect(0, 0, w, h, 18)
    this.add(this.bg)
    if (title) { this.title = text(scene, 16, 12, title.toUpperCase(), 12, C.ink2, { letterSpacing: 2 } as never); this.add(this.title) }
    scene.add.existing(this as unknown as Phaser.GameObjects.GameObject)
  }
}

export interface ButtonOpts { style?: 'plank' | 'pill' | 'ghost'; size?: number; selected?: boolean; enabled?: boolean; color?: number; textColor?: string; sub?: string }
export class Button extends Phaser.GameObjects.Container {
  label: Phaser.GameObjects.Text
  g: Phaser.GameObjects.Graphics
  w: number; h: number
  opts: ButtonOpts
  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: string, onClick: () => void, opts: ButtonOpts = {}) {
    super(scene, x, y)
    this.w = w; this.h = h; this.opts = opts
    this.g = scene.add.graphics()
    this.label = scene.add.text(0, opts.sub ? -8 : 0, label, { fontFamily: opts.style === 'plank' ? DISPLAY : FONT, fontSize: `${opts.size ?? (opts.style === 'plank' ? 28 : 16)}px`, color: opts.textColor ?? (opts.style === 'plank' ? C.woodInk : C.ink), fontStyle: 'bold' }).setOrigin(0.5)
    this.add([this.g, this.label])
    if (opts.sub) this.add(scene.add.text(0, 14, opts.sub, { fontFamily: FONT, fontSize: '12px', color: opts.style === 'plank' ? '#6b3d16' : C.ink2, fontStyle: 'bold' }).setOrigin(0.5))
    this.draw(false)
    this.setSize(w, h)
    this.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains)
    this.on('pointerover', () => this.draw(true)); this.on('pointerout', () => this.draw(false))
    this.on('pointerdown', () => { if (opts.enabled !== false) { this.setScale(0.97); onClick() } }); this.on('pointerup', () => this.setScale(1))
    scene.add.existing(this as unknown as Phaser.GameObjects.GameObject)
  }
  setSelected(v: boolean): void { this.opts.selected = v; this.draw(false) }
  setLabel(s: string): void { this.label.setText(s) }
  draw(hover: boolean): void {
    const g = this.g, w = this.w, h = this.h, o = this.opts, sel = !!o.selected
    g.clear()
    const a = o.enabled === false ? 0.45 : 1
    if (o.style === 'plank') {
      g.fillStyle(C.woodDark, a).fillRoundedRect(-w / 2, -h / 2 + 7, w, h, 14)
      g.fillStyle(sel || hover ? C.woodHi : C.wood, a).fillRoundedRect(-w / 2, -h / 2, w, h, 14)
      g.fillStyle(0x7a4519, 0.6 * a).fillRect(-w / 2 + 12, h / 2 - 7, w - 24, 3)
      g.fillStyle(0x3b3b3b, a).fillCircle(-w / 2 + 16, 0, 5).fillCircle(w / 2 - 16, 0, 5)
    } else if (o.style === 'ghost') {
      g.lineStyle(2, sel ? C.goldN : C.line, a).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2)
      if (sel || hover) g.fillStyle(sel ? C.goldN : 0xffffff, sel ? 0.15 : 0.06).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2)
    } else {
      g.fillStyle(sel ? C.goldN : (o.color ?? C.bg2), a).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2)
      g.lineStyle(2, sel ? C.goldN : (hover ? C.goldN : C.line), a).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2)
      this.label.setColor(sel ? '#0b1220' : (o.textColor ?? C.ink))
    }
  }
}

export class Bar extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics
  constructor(scene: Phaser.Scene, x: number, y: number, private w: number, private h: number, private color = C.blue, private right = false) {
    super(scene, x, y); this.g = scene.add.graphics(); this.add(this.g); scene.add.existing(this as unknown as Phaser.GameObjects.GameObject); this.set(0)
  }
  set(v: number, color?: number): void {
    const g = this.g, w = this.w, h = this.h; g.clear()
    g.fillStyle(0x1a1f2b).fillRoundedRect(0, 0, w, h, h / 2)
    const fw = w * Math.max(0, Math.min(1, v))
    if (fw > 0) g.fillStyle(color ?? this.color).fillRoundedRect(this.right ? w - fw : 0, 0, fw, h, h / 2)
  }
}

/** Loads a QR PNG from the arena (`/api/qr.png`) and shows it as an image with a label. */
export function qrImage(scene: Phaser.Scene, apiBase: string, url: string, x: number, y: number, size: number, label: string): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y)
  const key = 'qr:' + url
  const ph = scene.add.rectangle(0, 0, size, size, 0xffffff, 0.08); c.add(ph)
  const l = text(scene, 0, size / 2 + 8, label, 14, C.gold).setOrigin(0.5, 0); c.add(l)
  const show = () => { if (!c.active) return; ph.destroy(); const img = scene.add.image(0, 0, key).setDisplaySize(size, size); c.addAt(img, 0) }
  if (scene.textures.exists(key)) show()
  else { scene.load.image(key, `${apiBase}/api/qr.png?size=6&text=${encodeURIComponent(url)}`); scene.load.once(Phaser.Loader.Events.COMPLETE, show); scene.load.start() }
  return c
}

export function apiBase(wsUrl: string): string { return wsUrl.replace(/^wss?:\/\//, (m) => (m === 'wss://' ? 'https://' : 'http://')).replace(/\/ws(\?.*)?$/, '') }

export class Toast {
  private t: Phaser.GameObjects.Text
  private timer?: Phaser.Time.TimerEvent
  constructor(private scene: Phaser.Scene, y = 40) {
    this.t = scene.add.text(scene.scale.width / 2, y, '', { fontFamily: FONT, fontSize: '18px', color: '#0b1220', backgroundColor: '#ffe08a', padding: { x: 16, y: 8 }, fontStyle: 'bold' }).setOrigin(0.5).setDepth(100).setAlpha(0)
  }
  show(s: string, ms = 2200): void {
    this.t.setText(s).setAlpha(1).setPosition(this.scene.scale.width / 2, this.t.y)
    this.timer?.remove(); this.timer = this.scene.time.delayedCall(ms, () => this.scene.tweens.add({ targets: this.t, alpha: 0, duration: 300 }))
  }
}

export function fmtSecs(ms: number): string { return String(Math.max(0, Math.ceil(ms / 1000))) }
