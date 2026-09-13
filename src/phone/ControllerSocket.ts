import { CONTROLLER_CONFIG, type Sport } from './config'
import type { DetectedGesture, ProcessedMotion, Vector3 } from './motionProcessor'
import type { StickSnapshot } from './tiltStick'

export type ControllerId = 'controller_1' | 'controller_2'
export type ControllerAction =
  | 'block_start'
  | 'block_end'
  | 'emergency_power'
  | 'placeholder_primary'
  | 'placeholder_secondary'
export type ControllerConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'awaiting-ack'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface RttMetrics {
  now: number | null
  median: number | null
  p95: number | null
  sampleCount: number
}

export interface ControllerSocketOptions {
  controllerId: ControllerId
  onState: (state: ControllerConnectionState, detail?: string) => void
  onMetrics: (metrics: RttMetrics) => void
  onSport?: (sport: Sport) => void
  onBlocking?: (blocking: boolean) => void
  /** The game (or the motion test page) asking this phone to stream raw motion. */
  onTelemetry?: (enabled: boolean) => void
}

type WireObject = Record<string, unknown>

const sequences = new Map<ControllerId, number>()
const eventNonce = (() => {
  try {
    return crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  }
})()

function sequenceKey(controllerId: ControllerId): string {
  return `hap.controller.sequence.${controllerId}`
}

function currentSequence(controllerId: ControllerId): number {
  const cached = sequences.get(controllerId)
  if (cached !== undefined) return cached
  let sequence = 0
  try {
    const stored = Number(localStorage.getItem(sequenceKey(controllerId)))
    if (Number.isSafeInteger(stored) && stored >= 0) sequence = stored
  } catch {
    // The in-memory value still preserves sequence across reconnects.
  }
  sequences.set(controllerId, sequence)
  return sequence
}

function nextSequence(controllerId: ControllerId): number {
  const sequence = currentSequence(controllerId) + 1
  sequences.set(controllerId, sequence)
  try {
    localStorage.setItem(sequenceKey(controllerId), String(sequence))
  } catch {
    // Storage can be unavailable in private browsing; memory is sufficient.
  }
  return sequence
}

function percentile(sorted: number[], ratio: number): number | null {
  if (sorted.length === 0) return null
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  return sorted[index]
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function asWireVector(vector: Vector3): Vector3 {
  return [
    rounded(vector[0]),
    rounded(vector[1]),
    rounded(vector[2]),
  ]
}

function rounded(value: number): number {
  const factor = 10 ** CONTROLLER_CONFIG.socket.wirePrecision
  return Math.round(value * factor) / factor
}

function websocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${location.host}/controller-ws`
}

export class ControllerSocket {
  private controllerId: ControllerId
  private onState: ControllerSocketOptions['onState']
  private onMetrics: ControllerSocketOptions['onMetrics']
  private onSport: ControllerSocketOptions['onSport']
  private onBlocking: ControllerSocketOptions['onBlocking']
  private onTelemetry: ControllerSocketOptions['onTelemetry']
  private ws: WebSocket | null = null
  private acknowledged = false
  private manuallyClosed = true
  private reconnectAttempt = 0
  private reconnectTimer: number | null = null
  private helloTimer: number | null = null
  private pingTimer: number | null = null
  private nextPingId = 1
  private pendingPings = new Map<number, number>()
  private rttSamples: number[] = []
  private sensorHz = 0
  private lastMotionSentAt = Number.NEGATIVE_INFINITY
  private lastStickSentAt = Number.NEGATIVE_INFINITY

  constructor(options: ControllerSocketOptions) {
    this.controllerId = options.controllerId
    this.onState = options.onState
    this.onMetrics = options.onMetrics
    this.onSport = options.onSport
    this.onBlocking = options.onBlocking
    this.onTelemetry = options.onTelemetry
  }

  connect(): void {
    if (
      this.ws?.readyState === WebSocket.CONNECTING
      || this.ws?.readyState === WebSocket.OPEN
    ) return
    this.manuallyClosed = false
    this.reconnectAttempt = 0
    this.clearReconnectTimer()
    this.open(false)
  }

  disconnect(): void {
    this.manuallyClosed = true
    this.acknowledged = false
    this.clearReconnectTimer()
    this.stopConnectionTimers()
    const socket = this.ws
    this.ws = null
    socket?.close(1000, 'Controller disconnected')
    this.onState('disconnected')
  }

  setSensorHz(sensorHz: number): void {
    this.sensorHz = Number.isFinite(sensorHz) ? sensorHz : 0
  }

  getMetrics(): RttMetrics {
    const sorted = [...this.rttSamples].sort((a, b) => a - b)
    return {
      now: this.rttSamples.at(-1) ?? null,
      median: median(sorted),
      p95: percentile(sorted, 0.95),
      sampleCount: this.rttSamples.length,
    }
  }

  /** Movement summaries for the health record: whole seconds and per-swing rotations, a few numbers a
   *  second instead of the raw stream. Sequenced like stick state; a lost report only loses those seconds. */
  sendActivity(epochs: readonly { t: number; mean: number; peak: number; swings: number; rotation: number }[], roms: readonly number[]): boolean {
    if (!this.canSend() || (epochs.length === 0 && roms.length === 0)) return false
    return this.sendSequenced({
      v: CONTROLLER_CONFIG.socket.protocolVersion,
      type: 'activity',
      controllerId: this.controllerId,
      epochs: epochs.map((e) => ({ t: Math.round(e.t), mean: rounded(e.mean), peak: rounded(e.peak), swings: e.swings, rotation: rounded(e.rotation) })),
      roms: roms.map((r) => rounded(r)),
    })
  }

  sendMotion(motion: ProcessedMotion): boolean {
    if (!this.canSend()) return false
    const now = performance.now()
    const minimumInterval = 1_000 / CONTROLLER_CONFIG.socket.rawTelemetryMaxHz
    if (now - this.lastMotionSentAt < minimumInterval) return false
    const sent = this.sendSequenced({
      v: CONTROLLER_CONFIG.socket.protocolVersion,
      type: 'motion',
      controllerId: this.controllerId,
      t: rounded(motion.t),
      a: asWireVector(motion.acceleration),
      r: asWireVector(motion.rotation),
      interval: rounded(motion.intervalMs),
      metrics: this.wireMetrics(),
    })
    if (sent) this.lastMotionSentAt = now
    return sent
  }

  sendStick(stick: StickSnapshot): boolean {
    if (!this.canSend()) return false
    const now = performance.now()
    const minimumInterval = 1_000 / CONTROLLER_CONFIG.stick.maxHz
    if (now - this.lastStickSentAt < minimumInterval) return false
    const sent = this.sendSequenced({
      v: CONTROLLER_CONFIG.socket.protocolVersion,
      type: 'stick',
      controllerId: this.controllerId,
      t: rounded(now),
      stick: [rounded(stick.vector[0]), rounded(stick.vector[1])],
      calibrated: stick.calibration === 'calibrated',
      metrics: this.wireMetrics(),
    })
    if (sent) this.lastStickSentAt = now
    return sent
  }

  sendGesture(gesture: DetectedGesture): boolean {
    if (!this.canSend()) return false
    const sequence = nextSequence(this.controllerId)
    const packet = {
      v: CONTROLLER_CONFIG.socket.protocolVersion,
      type: 'gesture',
      controllerId: this.controllerId,
      seq: sequence,
      eventId: `${this.controllerId}_${eventNonce}_${sequence}`,
      t: rounded(gesture.t),
      gesture: gesture.gesture,
      power: gesture.power,
      direction: asWireVector(gesture.direction),
      axis: gesture.dominantAxis,
      directionLabel: gesture.directionLabel,
      peakAcceleration: rounded(gesture.peakAcceleration),
      peakRotation: rounded(gesture.peakRotation),
      duration: rounded(gesture.duration),
      emergencyBoostApplied: gesture.emergencyBoostApplied === true,
      metrics: this.wireMetrics(),
    }
    // Gestures are intentionally attempted once and never queued for replay.
    return this.sendPacket(packet)
  }

  sendAction(action: ControllerAction, sport: Sport): boolean {
    if (!this.canSend()) return false
    const sequence = nextSequence(this.controllerId)
    return this.sendPacket({
      v: CONTROLLER_CONFIG.socket.protocolVersion,
      type: 'action',
      controllerId: this.controllerId,
      seq: sequence,
      eventId: `${this.controllerId}_${eventNonce}_action_${sequence}`,
      t: rounded(performance.now()),
      sport,
      action,
    })
  }

  private open(isReconnect: boolean): void {
    this.onState(isReconnect ? 'reconnecting' : 'connecting')
    let socket: WebSocket
    try {
      socket = new WebSocket(websocketUrl())
    } catch {
      this.scheduleReconnect('Could not open the controller socket')
      return
    }
    this.ws = socket
    this.acknowledged = false

    socket.onopen = () => {
      if (this.ws !== socket) return
      this.onState('awaiting-ack')
      this.sendPacket({
        v: CONTROLLER_CONFIG.socket.protocolVersion,
        type: 'hello',
        controllerId: this.controllerId,
        seq: currentSequence(this.controllerId),
        metrics: this.wireMetrics(),
      })
      this.helloTimer = window.setTimeout(() => {
        if (this.ws === socket && !this.acknowledged) {
          socket.close(4000, 'Hello acknowledgement timed out')
        }
      }, CONTROLLER_CONFIG.socket.helloTimeoutMs)
    }

    socket.onmessage = (event) => {
      if (this.ws !== socket || typeof event.data !== 'string') return
      let message: WireObject
      try {
        const parsed: unknown = JSON.parse(event.data)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
        message = parsed as WireObject
      } catch {
        return
      }
      this.handleMessage(message, socket)
    }

    socket.onclose = () => {
      if (this.ws !== socket) return
      this.ws = null
      this.acknowledged = false
      this.stopConnectionTimers()
      if (this.manuallyClosed) {
        this.onState('disconnected')
      } else {
        this.scheduleReconnect('Connection lost')
      }
    }

    socket.onerror = () => {
      // Browsers expose useful WebSocket failures through close, not error.
    }
  }

  private handleMessage(message: WireObject, socket: WebSocket): void {
    if ((message.type === 'game_state' && this.acknowledged)
      || (message.type === 'hello' && message.ok === true && message.controllerId === this.controllerId)) {
      if (message.sport === 'boxing' || message.sport === 'golf' || message.sport === 'bowling') {
        this.onSport?.(message.sport)
      }
      if (typeof message.blocking === 'boolean') this.onBlocking?.(message.blocking)
      if (typeof message.telemetry === 'boolean') this.onTelemetry?.(message.telemetry)
    }
    if (
      message.type === 'hello'
      && message.ok === true
      && message.controllerId === this.controllerId
    ) {
      this.acknowledged = true
      this.reconnectAttempt = 0
      this.clearHelloTimer()
      this.onState('connected')
      this.lastMotionSentAt = Number.NEGATIVE_INFINITY
      this.lastStickSentAt = Number.NEGATIVE_INFINITY
      this.startPings()
      return
    }
    if (message.type === 'pong' && typeof message.id === 'number') {
      this.handlePong(message.id)
      return
    }
    if (message.type === 'error') {
      const code = typeof message.code === 'string' ? message.code : 'receiver_error'
      const description = typeof message.message === 'string'
        ? message.message
        : 'Controller receiver rejected the connection'
      const detail = `${code}: ${description}`
      // Receiver rejections require an explicit retry. In particular, an
      // occupied controller must not enter an endless reconnect loop.
      this.manuallyClosed = true
      this.acknowledged = false
      this.ws = null
      this.stopConnectionTimers()
      this.onState('error', detail)
      socket.close(4001, 'Receiver error')
    }
  }

  private canSend(): boolean {
    return this.acknowledged
      && this.ws !== null
      && this.ws.readyState === WebSocket.OPEN
  }

  private sendSequenced(packet: WireObject): boolean {
    if (!this.canSend()) return false
    return this.sendPacket({
      ...packet,
      seq: nextSequence(this.controllerId),
    })
  }

  private sendPacket(packet: WireObject): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify(packet))
      return true
    } catch {
      return false
    }
  }

  private startPings(): void {
    this.stopPings()
    const ping = () => {
      if (!this.canSend()) return
      const id = this.nextPingId
      this.nextPingId += 1
      this.pendingPings.set(id, performance.now())
      this.sendPacket({
        v: CONTROLLER_CONFIG.socket.protocolVersion,
        type: 'ping',
        controllerId: this.controllerId,
        id,
        t: rounded(performance.now()),
        metrics: this.wireMetrics(),
      })
    }
    ping()
    this.pingTimer = window.setInterval(ping, CONTROLLER_CONFIG.socket.pingIntervalMs)
  }

  private handlePong(id: number): void {
    const sentAt = this.pendingPings.get(id)
    if (sentAt === undefined) return
    this.pendingPings.delete(id)
    this.rttSamples.push(performance.now() - sentAt)
    if (this.rttSamples.length > CONTROLLER_CONFIG.socket.rttWindowSize) {
      this.rttSamples.shift()
    }
    this.onMetrics(this.getMetrics())
  }

  private wireMetrics(): WireObject {
    const metrics = this.getMetrics()
    return {
      sensorHz: rounded(this.sensorHz),
      rttNow: rounded(metrics.now ?? 0),
      rttMedian: rounded(metrics.median ?? 0),
      rttP95: rounded(metrics.p95 ?? 0),
    }
  }

  private scheduleReconnect(detail: string): void {
    if (this.manuallyClosed || this.reconnectTimer !== null) return
    this.onState('reconnecting', detail)
    const baseDelay = Math.min(
      CONTROLLER_CONFIG.socket.reconnectMaxMs,
      CONTROLLER_CONFIG.socket.reconnectInitialMs * (2 ** this.reconnectAttempt),
    )
    this.reconnectAttempt += 1
    const jitter = 1 + (
      (Math.random() * 2 - 1) * CONTROLLER_CONFIG.socket.reconnectJitter
    )
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.open(true)
    }, baseDelay * jitter)
  }

  private stopConnectionTimers(): void {
    this.clearHelloTimer()
    this.stopPings()
  }

  private stopPings(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    this.pendingPings.clear()
  }

  private clearHelloTimer(): void {
    if (this.helloTimer !== null) {
      window.clearTimeout(this.helloTimer)
      this.helloTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
