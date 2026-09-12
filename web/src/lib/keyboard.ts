// Keyboard controls for every sport: sends input.action directly (bypasses the motion detectors).
import type { ArenaSocket } from './ws'

export type Sport = 'bowling' | 'baseball' | 'boxing' | null
export interface KbState {
  sport: Sport; aim: number; spin: number; charge: number | null; guard: boolean; last: string | null; hand: 1 | -1
  moving: -1 | 0 | 1; hookCharge: number | null; height: number
}

export const CONTROLS: Record<string, { key: string; does: string }[]> = {
  boxing: [
    { key: 'J', does: 'jab' }, { key: 'K', does: 'hook (hold to charge)' }, { key: 'Space (hold)', does: 'guard' }, { key: 'P', does: 'parry' },
    { key: 'A / D', does: 'move' }, { key: 'Q / E', does: 'dodge' },
  ],
  bowling: [{ key: '← →', does: 'aim' }, { key: 'A / D', does: 'spin' }, { key: 'Space (hold, release)', does: 'charge & roll' }],
  baseball: [{ key: 'Space', does: 'swing' }, { key: '↑ ↓', does: 'swing height' }],
}

const HOOK_CHARGE_MS = 500
const MOVE_RESEND_MS = 250     // the engine holds a move for ~350 ms; re-send while the key stays down

export class KeyboardController {
  state: KbState = { sport: null, aim: 0, spin: 150, charge: null, guard: false, last: null, hand: 1, moving: 0, hookCharge: null, height: 0.5 }
  private chargeT0 = 0
  private raf: number | null = null
  private hookT0 = 0
  private hookRaf: number | null = null
  private moveTimer: number | null = null
  private heldDirs = new Set<-1 | 1>()
  private onKey = (e: KeyboardEvent) => this.keydown(e)
  private onUp = (e: KeyboardEvent) => this.keyup(e)
  private onBlur = () => this.releaseAll()

  private socket: ArenaSocket
  private getSport: () => Sport
  private onChange: (s: KbState) => void
  constructor(socket: ArenaSocket, getSport: () => Sport, onChange: (s: KbState) => void) { this.socket = socket; this.getSport = getSport; this.onChange = onChange }

  attach(): void {
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onUp); window.addEventListener('blur', this.onBlur)
    const ready = () => this.socket.send('motion.calib_done', {})
    if (!ready()) this.socket.on('__open', ready)   // declare ready as soon as the socket is up (and again after every reconnect)
    else this.socket.on('__open', ready)
  }
  detach(): void {
    this.releaseAll()
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onUp); window.removeEventListener('blur', this.onBlur)
    if (this.raf) cancelAnimationFrame(this.raf); if (this.hookRaf) cancelAnimationFrame(this.hookRaf)
  }

  private send(kind: string, params: Record<string, unknown> = {}): void {
    this.socket.send('input.action', { kind, params, t_client: Date.now() })
    if (kind !== 'move') this.state.last = kind === 'punch' ? String(params.type) : kind
    this.emit()
  }
  private emit(): void { this.state.sport = this.getSport(); this.onChange({ ...this.state }) }

  /** Focus lost or controller detached: never leave the fighter walking or guarding. */
  private releaseAll(): void {
    if (this.state.guard) { this.state.guard = false; this.send('block_off') }
    if (this.state.moving !== 0 || this.heldDirs.size) { this.heldDirs.clear(); this.setMove(0) }
    if (this.state.hookCharge !== null) { this.state.hookCharge = null; if (this.hookRaf) cancelAnimationFrame(this.hookRaf); this.emit() }
    if (this.state.charge !== null) { this.state.charge = null; if (this.raf) cancelAnimationFrame(this.raf); this.emit() }
  }

  private setMove(dir: -1 | 0 | 1): void {
    if (this.moveTimer) { window.clearInterval(this.moveTimer); this.moveTimer = null }
    this.state.moving = dir
    this.send('move', { dir })
    if (dir !== 0) this.moveTimer = window.setInterval(() => this.send('move', { dir }), MOVE_RESEND_MS)
  }

  private keydown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
    const sport = this.getSport()
    const k = e.key.toLowerCase()
    if (sport === 'boxing') {
      const dirKey = k === 'a' || k === 'arrowleft' ? -1 : k === 'd' || k === 'arrowright' ? 1 : 0
      if (k === 'j') { e.preventDefault(); if (!e.repeat) this.send('punch', { type: 'jab', power: 0.75, duration_ms: 70 }) }
      else if (k === 'k') { e.preventDefault(); if (!e.repeat && this.state.hookCharge === null) { this.hookT0 = performance.now(); this.state.hookCharge = 0; this.tickHook() } }
      else if (k === ' ') { e.preventDefault(); if (!this.state.guard) { this.state.guard = true; this.send('block_on') } }
      else if (k === 'p') { e.preventDefault(); if (!e.repeat) this.send('parry') }
      else if (k === 'q' || k === 'e') { e.preventDefault(); if (!e.repeat) this.send('dodge', { dir: k === 'q' ? -1 : 1 }) }
      else if (dirKey !== 0) {
        e.preventDefault()
        if (e.shiftKey) { if (!e.repeat) this.send('dodge', { dir: dirKey }); return }
        if (!this.heldDirs.has(dirKey)) { this.heldDirs.add(dirKey); this.setMove(dirKey) }
      }
    } else if (sport === 'bowling') {
      if (k === 'arrowleft') { e.preventDefault(); this.state.aim = Math.max(-1, +(this.state.aim - 0.1).toFixed(2)); this.emit() }
      else if (k === 'arrowright') { e.preventDefault(); this.state.aim = Math.min(1, +(this.state.aim + 0.1).toFixed(2)); this.emit() }
      else if (k === 'a') { e.preventDefault(); this.state.spin = Math.max(-400, this.state.spin - 50); this.state.hand = this.state.spin >= 0 ? 1 : -1; this.emit() }
      else if (k === 'd') { e.preventDefault(); this.state.spin = Math.min(400, this.state.spin + 50); this.state.hand = this.state.spin >= 0 ? 1 : -1; this.emit() }
      else if (k === ' ') { e.preventDefault(); if (this.state.charge === null) { this.chargeT0 = performance.now(); this.state.charge = 0; this.tickCharge() } }
    } else if (sport === 'baseball') {
      if (k === ' ') { e.preventDefault(); if (!e.repeat) this.send('swing', { power: 0.85, pitch_angle: this.state.height }) }
      else if (k === 'arrowup') { e.preventDefault(); this.state.height = Math.min(1, +(this.state.height + 0.1).toFixed(2)); this.emit() }
      else if (k === 'arrowdown') { e.preventDefault(); this.state.height = Math.max(0, +(this.state.height - 0.1).toFixed(2)); this.emit() }
    }
  }

  private keyup(e: KeyboardEvent): void {
    const sport = this.getSport()
    const k = e.key.toLowerCase()
    if (sport === 'boxing') {
      if (k === ' ' && this.state.guard) { this.state.guard = false; this.send('block_off') }
      else if (k === 'k' && this.state.hookCharge !== null) {
        const held = performance.now() - this.hookT0
        this.state.hookCharge = null; if (this.hookRaf) cancelAnimationFrame(this.hookRaf)
        this.send('punch', { type: 'hook', power: +(0.7 + 0.3 * Math.min(1, held / HOOK_CHARGE_MS)).toFixed(2), duration_ms: 110, charged_ms: Math.round(held) })
      } else {
        const dirKey = k === 'a' || k === 'arrowleft' ? -1 : k === 'd' || k === 'arrowright' ? 1 : 0
        if (dirKey !== 0 && this.heldDirs.has(dirKey)) {
          this.heldDirs.delete(dirKey)
          const next = this.heldDirs.values().next()
          this.setMove(next.done ? 0 : next.value)
        }
      }
      return
    }
    if (k !== ' ') return
    if (sport === 'bowling' && this.state.charge !== null) {
      const speed = this.chargeAt(performance.now())     // from elapsed hold time: correct even when rAF was throttled
      this.state.charge = null
      if (this.raf) cancelAnimationFrame(this.raf)
      this.send('release', { lane: this.state.aim, speed, spin_dps: this.state.spin, power: speed, duration_ms: 120 })
    }
  }

  /** Oscillating power meter: 0..1 and back every 1.6 s of holding Space. */
  private chargeAt(now: number): number { return +(0.5 - 0.5 * Math.cos(Math.PI * 2 * ((now - this.chargeT0) / 1000) / 1.6)).toFixed(2) }

  private tickCharge = (): void => {
    if (this.state.charge === null) return
    this.state.charge = this.chargeAt(performance.now())
    this.emit()
    this.raf = requestAnimationFrame(this.tickCharge)
  }

  private tickHook = (): void => {
    if (this.state.hookCharge === null) return
    this.state.hookCharge = +Math.min(1, (performance.now() - this.hookT0) / HOOK_CHARGE_MS).toFixed(2)
    this.emit()
    this.hookRaf = requestAnimationFrame(this.tickHook)
  }
}
