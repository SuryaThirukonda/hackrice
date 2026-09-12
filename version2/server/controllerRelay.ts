import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'

type ControllerId = 'controller_1' | 'controller_2'
type Sport = 'boxing' | 'bowling' | 'golf'
type Packet = Record<string, unknown>

const ids: readonly ControllerId[] = ['controller_1', 'controller_2']
const gestures = new Set(['punch', 'bowling_swing', 'golf_swing'])
const actions = new Set(['block_start', 'block_end', 'emergency_power', 'placeholder_primary', 'placeholder_secondary'])

interface Slot { socket: WebSocket; lastSequence: number }

/** Low-latency normalized-input relay. It never interprets motion or game outcomes. */
export class ControllerRelay {
  readonly controllers = new WebSocketServer({ noServer: true })
  readonly games = new WebSocketServer({ noServer: true })
  private slots = new Map<ControllerId, Slot>()
  private gameSockets = new Set<WebSocket>()
  private seen = new Map<ControllerId, Set<string>>(ids.map((id) => [id, new Set()]))
  private seenOrder = new Map<ControllerId, string[]>(ids.map((id) => [id, []]))
  private activeSport: Sport = 'bowling'
  private guards = new Map<ControllerId, boolean>(ids.map((id) => [id, false]))

  constructor() {
    this.controllers.on('connection', (socket) => this.onController(socket))
    this.games.on('connection', (socket) => this.onGame(socket))
  }

  handles(pathname: string): boolean {
    return pathname === '/controller-ws' || pathname === '/controller-game-ws'
  }

  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    const server = pathname === '/controller-ws' ? this.controllers : this.games
    server.handleUpgrade(request, socket, head, (ws) => server.emit('connection', ws, request))
  }

  private onController(socket: WebSocket): void {
    let claimed: ControllerId | null = null
    socket.on('message', (raw) => {
      const packet = this.parse(raw)
      if (!packet) return
      if (packet.type === 'hello') {
        const requested = ids.includes(packet.controllerId as ControllerId) ? packet.controllerId as ControllerId : null
        if (!requested || (this.slots.has(requested) && this.slots.get(requested)?.socket !== socket)) {
          this.error(socket, requested ? 'controller_in_use' : 'invalid_controller_id')
          return
        }
        claimed = requested
        const sequence = this.sequence(packet.seq)
        this.slots.set(requested, { socket, lastSequence: sequence ?? -1 })
        socket.send(JSON.stringify({ type: 'hello', ok: true, controllerId: requested, sport: this.activeSport, blocking: this.guards.get(requested) ?? false, serverTime: Date.now() }))
        this.broadcastGames({ type: 'controller_status', controllerId: requested, connected: true })
        return
      }
      if (!claimed || packet.controllerId !== claimed) { this.error(socket, 'hello_required'); return }
      if (packet.type === 'ping') { socket.send(JSON.stringify({ type: 'pong', id: packet.id })); return }
      const slot = this.slots.get(claimed)
      const sequence = this.sequence(packet.seq)
      if (!slot || sequence === null || sequence <= slot.lastSequence) return
      if (packet.type === 'stick') {
        if (!Array.isArray(packet.stick) || packet.stick.length < 2) return
      } else if (packet.type === 'gesture') {
        if (!gestures.has(String(packet.gesture)) || !this.acceptEvent(claimed, packet.eventId)) return
      } else if (packet.type === 'action') {
        if (!actions.has(String(packet.action)) || !this.acceptEvent(claimed, packet.eventId)) return
      } else if (packet.type !== 'motion') return
      slot.lastSequence = sequence
      this.broadcastGames({ ...packet, sport: this.activeSport })
    })
    socket.on('close', () => {
      if (!claimed || this.slots.get(claimed)?.socket !== socket) return
      this.slots.delete(claimed)
      this.broadcastGames({ type: 'controller_status', controllerId: claimed, connected: false })
    })
  }

  private onGame(socket: WebSocket): void {
    this.gameSockets.add(socket)
    socket.on('message', (raw) => {
      const packet = this.parse(raw)
      if (!packet || packet.type !== 'game_state') return
      if (packet.sport === 'boxing' || packet.sport === 'bowling' || packet.sport === 'golf') this.activeSport = packet.sport
      const target = ids.includes(packet.controllerId as ControllerId) ? packet.controllerId as ControllerId : null
      if (target && typeof packet.blocking === 'boolean') this.guards.set(target, packet.blocking)
      this.broadcastControllers({ type: 'game_state', sport: this.activeSport, ...(target ? { controllerId: target, blocking: this.guards.get(target) } : {}) })
    })
    socket.on('close', () => this.gameSockets.delete(socket))
  }

  private parse(raw: unknown): Packet | null {
    try {
      const value: unknown = JSON.parse(String(raw))
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Packet : null
    } catch { return null }
  }

  private sequence(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  }

  private acceptEvent(id: ControllerId, value: unknown): boolean {
    if (typeof value !== 'string' || value.length === 0) return false
    const cache = this.seen.get(id)!
    if (cache.has(value)) return false
    const order = this.seenOrder.get(id)!
    cache.add(value); order.push(value)
    if (order.length > 256) cache.delete(order.shift()!)
    return true
  }

  private broadcastGames(packet: Packet): void {
    const text = JSON.stringify(packet)
    for (const socket of this.gameSockets) if (socket.readyState === WebSocket.OPEN) socket.send(text)
  }

  private broadcastControllers(packet: Packet): void {
    const text = JSON.stringify(packet)
    for (const slot of this.slots.values()) if (slot.socket.readyState === WebSocket.OPEN) slot.socket.send(text)
  }

  private error(socket: WebSocket, code: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'error', code, message: code.replaceAll('_', ' ') }))
  }
}
