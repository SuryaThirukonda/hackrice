import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'
import { loadSettings, saveSettings, type GameSettings, type Quality } from '../agent/sliders'
import { Engine3D } from '../engine3d/Engine3D'
import { BOXING_HELP, BOXING_KEYS, keyLabel } from '../games/boxing/keymap'
import { BOWLING_HELP, BOWLING_KEYS } from '../games/bowling/keymap'
import { GOLF_HELP, GOLF_KEYS } from '../games/golf/keymap'

/** Every rebindable action across games, in display order. */
interface Row { game: string; action: string; label: string; keys: string[] }
function allRows(bindings: Record<string, Record<string, string[]>>): Row[] {
  const rows: Row[] = []
  const merge = (game: string, defaults: Record<string, string[]>, help: { action: string; label: string }[]) => {
    const b = { ...defaults, ...(bindings[game] ?? {}) }
    for (const h of help) rows.push({ game, action: h.action, label: h.label, keys: b[h.action] ?? [] })
  }
  merge('boxing', BOXING_KEYS as unknown as Record<string, string[]>, BOXING_HELP)
  merge('bowling', BOWLING_KEYS as unknown as Record<string, string[]>, BOWLING_HELP)
  merge('golf', GOLF_KEYS as unknown as Record<string, string[]>, GOLF_HELP)
  return rows
}

/** Sound toggle, key rebinding for boxing (Enter on a row, then press the new key), reset. */
export class SettingsScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private s!: GameSettings
  private row = 0
  private waiting = false
  private content: Phaser.GameObjects.GameObject[] = []
  constructor() { super('settings') }
  init(): void { this.s = loadSettings(); this.row = 0; this.waiting = false }
  create(): void {
    ensureTextures(this)
    this.city = new ComicBackdrop(this, 44)
    const kb = this.input.keyboard!
    const rows = allRows(this.s.bindings).length + 3 // sound, quality, bindings..., reset
    kb.on('keydown', (e: KeyboardEvent) => {
      if (this.waiting) {
        if (e.code !== 'Escape') {
          const r = allRows(this.s.bindings)[this.row - 2]
          this.s.bindings[r.game] = { ...(this.s.bindings[r.game] ?? {}), [r.action]: [e.code] }
          saveSettings(this.s); sfx.select()
        }
        this.waiting = false; this.draw(); return
      }
      if (e.code === 'ArrowDown') { this.row = (this.row + 1) % rows; sfx.hover(); this.draw() }
      else if (e.code === 'ArrowUp') { this.row = (this.row - 1 + rows) % rows; sfx.hover(); this.draw() }
      else if (e.code === 'Enter' || e.code === 'Space') this.activate()
      else if (e.code === 'Escape') wipeTo(this, 'menu')
    })
    this.draw()
  }
  private activate(): void {
    if (this.row === 0) { this.s.sound = !this.s.sound; saveSettings(this.s); sfx.select() }
    else if (this.row === 1) { const q: Quality[] = ['low', 'medium', 'high']; this.s.quality = q[(q.indexOf(this.s.quality) + 1) % 3]; saveSettings(this.s); Engine3D.peek()?.setQuality(this.s.quality); sfx.select() }
    else if (this.row === allRows(this.s.bindings).length + 2) { this.s.bindings = {}; saveSettings(this.s); sfx.back() }
    else { this.waiting = true }
    this.draw()
  }
  private draw(): void {
    for (const o of this.content) o.destroy()
    this.content = []
    const { width: W, height: H } = this.scale
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.content.push(o); return o }
    add(comicPanel(this, W / 2 - 440, 24, 880, H - 48, P.paper, -1))
    add(new ComicButton(this, 90, 48, '◀ BACK', () => { sfx.back(); wipeTo(this, 'menu') }, { color: P.blue, w: 110, h: 42, size: 16 }))
    add(this.add.text(W / 2, 64, 'SETTINGS', { fontFamily: DISPLAY, fontSize: '44px', color: HEX(P.ink) }).setOrigin(0.5).setAngle(-1))
    const rows = allRows(this.s.bindings)
    const total = rows.length + 3
    // scroll so the focused row stays visible
    const dy = 30, maxVisible = Math.floor((H - 170) / dy)
    const first = Math.max(0, Math.min(this.row - Math.floor(maxVisible / 2), total - maxVisible))
    const y0 = 104
    const line = (i: number, label: string, value: string, tag = '') => {
      if (i < first || i >= first + maxVisible) return
      const y = y0 + (i - first) * dy
      if (tag) add(this.add.text(W / 2 - 400, y, tag, { fontFamily: FONT, fontSize: '12px', color: HEX(P.blue), fontStyle: '900' }).setOrigin(0, 0.5))
      add(this.add.text(W / 2 - 320, y, label, { fontFamily: DISPLAY, fontSize: '19px', color: HEX(this.row === i ? P.red : P.ink) }).setOrigin(0, 0.5))
      add(new ComicButton(this, W / 2 + 250, y, value, () => { this.row = i; this.activate() }, { color: this.row === i ? P.gold : P.paper, w: 300, h: 26, size: 14 }))
    }
    line(0, 'SOUND', this.s.sound ? 'ON' : 'OFF')
    line(1, '3D QUALITY', this.s.quality.toUpperCase() + (this.s.quality === 'medium' ? ' (laptop)' : this.s.quality === 'high' ? ' (SSAO, 2K shadows)' : ' (no post, no shadows)'))
    rows.forEach((r, i) => line(i + 2, r.label.toUpperCase(), this.waiting && this.row === i + 1 ? 'press a key…' : r.keys.map(keyLabel).join(' / '), r.game.toUpperCase()))
    line(rows.length + 2, 'RESET KEYS', 'defaults')
    add(this.add.text(W / 2, H - 46, '↑↓ rows · Enter change · Esc back', { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 10, y: 4 } }).setOrigin(0.5))
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}
