export type ControllerSport = 'boxing' | 'bowling' | 'golf'
/** One second of phone movement, as the phone summarises it (see src/health/energy.ts). */
export interface ActivityEpoch { t: number; mean: number; peak: number; swings: number; rotation: number }
export type ControllerId = 'controller_1' | 'controller_2' | 'head_tracker'

export interface ControllerStick {
  x: number
  y: number
  fresh: boolean
}

export interface ControllerGesture {
  kind: 'gesture'
  controllerId: ControllerId
  sport: ControllerSport
  gesture: 'punch' | 'bowling_swing' | 'golf_swing'
  power: number
  direction: readonly [number, number, number]
  peakAcceleration: number
  peakRotation: number
  duration: number
  eventId: string
}

export interface ControllerButton {
  kind: 'action'
  controllerId: ControllerId
  sport: ControllerSport
  action: 'block_start' | 'block_end' | 'emergency_power' | 'placeholder_primary' | 'placeholder_secondary' | 'duck' | 'sway_left' | 'sway_right'
  eventId: string
}

export type ControllerEvent = ControllerGesture | ControllerButton

type WirePacket = Record<string, unknown>

const STALE_MS = 250
const EVENT_CACHE = 256
const ZERO_DIRECTION: readonly [number, number, number] = [0, 0, 0]

const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value))

function controllerId(value: unknown): ControllerId | null {
  return value === 'controller_1' || value === 'controller_2' || value === 'head_tracker' ? value : null
}

function sport(value: unknown): ControllerSport | null {
  return value === 'boxing' || value === 'bowling' || value === 'golf' ? value : null
}

function direction(value: unknown): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return ZERO_DIRECTION
  const vector: [number, number, number] = [finite(value[0]), finite(value[1]), finite(value[2])]
  const length = Math.hypot(...vector)
  return length > 1 ? [vector[0] / length, vector[1] / length, vector[2] / length] : vector
}

/**
 * Latest-state-wins continuous input plus an exactly-once queue for normalized
 * gestures/actions. It deliberately knows nothing about PlayCanvas or game rules.
 */
export class ControllerInput {
  private activeSport: ControllerSport = 'bowling'
  private sticks = new Map<ControllerId, { x: number; y: number; receivedAt: number }>()
  private online = new Set<ControllerId>()
  /** Movement summaries waiting for the health tracker, per controller. */
  private activity = new Map<ControllerId, { epochs: ActivityEpoch[]; roms: number[] }>()
  private events: ControllerEvent[] = []
  private seen = new Set<string>()
  private seenOrder: string[] = []
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private stopped = true

  setSport(next: ControllerSport): void {
    if (this.activeSport === next) return
    this.activeSport = next
    this.events = []
    this.send({ type: 'game_state', sport: next })
  }

  getSport(): ControllerSport { return this.activeSport }

  stick(id: ControllerId, now = performance.now()): ControllerStick {
    const value = this.sticks.get(id)
    if (!value || now - value.receivedAt > STALE_MS) return { x: 0, y: 0, fresh: false }
    return { x: value.x, y: value.y, fresh: true }
  }

  drain(id: ControllerId, wantedSport = this.activeSport): ControllerEvent[] {
    const matching: ControllerEvent[] = []
    const retained: ControllerEvent[] = []
    for (const event of this.events) {
      if (event.controllerId === id && event.sport === wantedSport) matching.push(event)
      else retained.push(event)
    }
    this.events = retained
    return matching
  }

  /** True while a phone holds this slot. Held state (a guard latch) must key off this, not off stick
   *  freshness: a phone that is idle on the D-pad still has its guard up. */
  connected(id: ControllerId): boolean { return this.online.has(id) }

  /** Everything the phone has reported about its movement since the last drain. */
  drainActivity(id: ControllerId): { epochs: ActivityEpoch[]; roms: number[] } {
    const out = this.activity.get(id) ?? { epochs: [], roms: [] }
    this.activity.delete(id)
    return out
  }

  /** True while the game's own socket to the relay is open. When this is false no phone can reach the
   *  game at all, however good its tunnel is, so the connect screen says to start the agent service. */
  linked(): boolean { return this.socket?.readyState === WebSocket.OPEN }

  clear(id?: ControllerId): void {
    if (id) {
      this.sticks.delete(id)
      this.activity.delete(id)
      this.events = this.events.filter((event) => event.controllerId !== id)
    } else {
      this.sticks.clear()
      this.activity.clear()
      this.online.clear()
      this.events = []
    }
  }

  connect(): void {
    if (typeof WebSocket === 'undefined' || !this.stopped) return
    this.stopped = false
    this.open()
  }

  disconnect(): void {
    this.stopped = true
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    socket?.close(1000, 'game closed')
    this.clear()
  }

  /** Test/dev hook; production packets arrive through the relay socket. */
  ingest(packet: WirePacket, receivedAt = performance.now()): void {
    if (packet.type === 'controller_status') {
      const sid = controllerId(packet.controllerId)
      if (sid) { if (packet.connected === true) this.online.add(sid); else this.online.delete(sid) }
      const id = controllerId(packet.controllerId)
      if (id && packet.connected === false) this.clear(id)
      return
    }
    const id = controllerId(packet.controllerId)
    if (!id) return
    if (packet.type === 'activity') {
      const bucket = this.activity.get(id) ?? { epochs: [], roms: [] }
      for (const raw of Array.isArray(packet.epochs) ? packet.epochs : []) {
        const e = raw as Record<string, unknown>
        bucket.epochs.push({ t: Math.max(0, finite(e.t)), mean: Math.max(0, finite(e.mean)), peak: Math.max(0, finite(e.peak)), swings: Math.max(0, Math.round(finite(e.swings))), rotation: Math.max(0, finite(e.rotation)) })
      }
      for (const r of Array.isArray(packet.roms) ? packet.roms : []) bucket.roms.push(Math.max(0, finite(r)))
      // a phone that reports for an hour while no match is running must not grow without bound
      if (bucket.epochs.length > 3600) bucket.epochs.splice(0, bucket.epochs.length - 3600)
      if (bucket.roms.length > 2000) bucket.roms.splice(0, bucket.roms.length - 2000)
      this.activity.set(id, bucket)
      return
    }
    if (packet.type === 'stick') {
      if (!Array.isArray(packet.stick) || packet.stick.length < 2) return
      let x = clamp(finite(packet.stick[0]), -1, 1)
      let y = clamp(finite(packet.stick[1]), -1, 1)
      const length = Math.hypot(x, y)
      if (length > 1) { x /= length; y /= length }
      this.sticks.set(id, { x, y, receivedAt })
      return
    }
    const eventId = typeof packet.eventId === 'string' ? packet.eventId : ''
    if (!eventId || this.seen.has(eventId)) return
    const packetSport = sport(packet.sport) ?? this.activeSport
    let event: ControllerEvent | null = null
    if (packet.type === 'gesture' && (packet.gesture === 'punch' || packet.gesture === 'bowling_swing' || packet.gesture === 'golf_swing')) {
      event = {
        kind: 'gesture', controllerId: id, sport: packetSport, gesture: packet.gesture,
        power: clamp(finite(packet.power), 0, 100), direction: direction(packet.direction),
        peakAcceleration: Math.max(0, finite(packet.peakAcceleration)),
        peakRotation: Math.max(0, finite(packet.peakRotation)), duration: Math.max(0, finite(packet.duration)), eventId,
      }
    } else if (packet.type === 'action' && (packet.action === 'block_start' || packet.action === 'block_end' || packet.action === 'emergency_power' || packet.action === 'placeholder_primary' || packet.action === 'placeholder_secondary' || packet.action === 'duck' || packet.action === 'sway_left' || packet.action === 'sway_right')) {
      event = { kind: 'action', controllerId: id, sport: packetSport, action: packet.action, eventId }
    }
    if (!event) return
    this.remember(eventId)
    this.events.push(event)
  }

  private remember(eventId: string): void {
    this.seen.add(eventId)
    this.seenOrder.push(eventId)
    if (this.seenOrder.length > EVENT_CACHE) {
      const expired = this.seenOrder.shift()
      if (expired) this.seen.delete(expired)
    }
  }

  private open(): void {
    if (this.stopped) return
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${location.host}/controller-game-ws`)
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.reconnectAttempt = 0
      this.send({ type: 'game_state', sport: this.activeSport })
    }
    socket.onmessage = (message) => {
      if (this.socket !== socket || typeof message.data !== 'string') return
      try {
        const packet: unknown = JSON.parse(message.data)
        if (packet && typeof packet === 'object' && !Array.isArray(packet)) this.ingest(packet as WirePacket)
      } catch { /* malformed relay traffic is ignored */ }
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.clear()
      if (this.stopped) return
      const delay = Math.min(4_000, 250 * 2 ** this.reconnectAttempt++)
      this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; this.open() }, delay)
    }
    socket.onerror = () => { /* close schedules the retry */ }
  }

  private send(packet: WirePacket): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(packet))
  }
}

export const controllerInput = new ControllerInput()

export function phonePunchKind(event: ControllerGesture): 'jab' | 'cross' {
  // The Godot path emitted a generic punch. Preserve its rotation signal by
  // mapping hook-like motions to the deterministic sim's heavy cross.
  return event.peakRotation >= 200 ? 'cross' : 'jab'
}
