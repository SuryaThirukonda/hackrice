// Keyboard controls for every sport: sends input.action directly (bypasses the motion detectors).
import type { ArenaSocket } from './ws'

export type Sport = 'bowling' | 'baseball' | 'boxing' | null
export interface KbState { sport: Sport; aim: number; spin: number; charge: number | null; guard: boolean; last: string | null; hand: 1 | -1 }

export const CONTROLS: Record<string, { key: string; does: string }[]> = {
  boxing: [{ key: 'J', does: 'jab' }, { key: 'K', does: 'hook' }, { key: 'Space (hold)', does: 'block' }, { key: 'P', does: 'parry' }, { key: 'A / D', does: 'dodge' }],
  bowling: [{ key: '← →', does: 'aim' }, { key: 'A / D', does: 'spin' }, { key: 'Space (hold, release)', does: 'charge & roll' }],
  baseball: [{ key: 'Space', does: 'swing' }, { key: '↑ ↓', does: 'swing height' }],
}

export class KeyboardController {
  state: KbState = { sport: null, aim: 0, spin: 150, charge: null, guard: false, last: null, hand: 1 }
  private chargeT0 = 0
  private raf: number | null = null
  private height = 0.5
  private onKey = (e: KeyboardEvent) => this.keydown(e)
  private onUp = (e: KeyboardEvent) => this.keyup(e)

  private socket: ArenaSocket
  private getSport: () => Sport
  private onChange: (s: KbState) => void
  constructor(socket: ArenaSocket, getSport: () => Sport, onChange: (s: KbState) => void) { this.socket = socket; this.getSport = getSport; this.onChange = onChange }

  attach(): void {
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onUp)
    const ready = () => this.socket.send('motion.calib_done', {})
    if (!ready()) this.socket.on('__open', ready)   // declare ready as soon as the socket is up
  }
  detach(): void { window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onUp); if (this.raf) cancelAnimationFrame(this.raf) }

  private send(kind: string, params: Record<string, unknown> = {}): void {
    this.socket.send('input.action', { kind, params, t_client: Date.now() })
    this.state.last = kind === 'punch' ? String(params.type) : kind
    this.emit()
  }
  private emit(): void { this.state.sport = this.getSport(); this.onChange({ ...this.state }) }

  private keydown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
    const sport = this.getSport()
    const k = e.key.toLowerCase()
    if (sport === 'boxing') {
      if (k === 'j') { e.preventDefault(); this.send('punch', { type: 'jab', power: 0.75, duration_ms: 70 }) }
      else if (k === 'k') { e.preventDefault(); this.send('punch', { type: 'hook', power: 0.9, duration_ms: 110 }) }
      else if (k === ' ' && !this.state.guard) { e.preventDefault(); this.state.guard = true; this.send('block_on') }
      else if (k === 'p') { e.preventDefault(); this.send('parry') }
      else if (k === 'a' || k === 'd' || k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); this.send('dodge', { dir: k === 'a' || k === 'arrowleft' ? -1 : 1 }) }
    } else if (sport === 'bowling') {
      if (k === 'arrowleft') { e.preventDefault(); this.state.aim = Math.max(-1, +(this.state.aim - 0.1).toFixed(2)); this.emit() }
      else if (k === 'arrowright') { e.preventDefault(); this.state.aim = Math.min(1, +(this.state.aim + 0.1).toFixed(2)); this.emit() }
      else if (k === 'a') { e.preventDefault(); this.state.spin = Math.max(-400, this.state.spin - 50); this.state.hand = this.state.spin >= 0 ? 1 : -1; this.emit() }
      else if (k === 'd') { e.preventDefault(); this.state.spin = Math.min(400, this.state.spin + 50); this.state.hand = this.state.spin >= 0 ? 1 : -1; this.emit() }
      else if (k === ' ' && this.state.charge === null) { e.preventDefault(); this.chargeT0 = performance.now(); this.state.charge = 0; this.tickCharge() }
    } else if (sport === 'baseball') {
      if (k === ' ') { e.preventDefault(); this.send('swing', { power: 0.85, pitch_angle: this.height }) }
      else if (k === 'arrowup') { this.height = Math.min(1, this.height + 0.1); this.emit() }
      else if (k === 'arrowdown') { this.height = Math.max(0, this.height - 0.1); this.emit() }
    }
  }

  private keyup(e: KeyboardEvent): void {
    const sport = this.getSport()
    if (e.key !== ' ') return
    if (sport === 'boxing' && this.state.guard) { this.state.guard = false; this.send('block_off') }
    if (sport === 'bowling' && this.state.charge !== null) {
      const speed = this.state.charge
      this.state.charge = null
      if (this.raf) cancelAnimationFrame(this.raf)
      this.send('release', { lane: this.state.aim, speed, spin_dps: this.state.spin, power: speed, duration_ms: 120 })
    }
  }

  private tickCharge = (): void => {
    if (this.state.charge === null) return
    const t = (performance.now() - this.chargeT0) / 1000
    this.state.charge = +(0.5 - 0.5 * Math.cos(Math.PI * 2 * t / 1.6)).toFixed(2)   // oscillates 0..1 every 1.6 s
    this.emit()
    this.raf = requestAnimationFrame(this.tickCharge)
  }
}
