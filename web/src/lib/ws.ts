import type { ClientType, Envelope, Role, ServerType } from '../protocol'

type Handler = (env: Envelope) => void

export function deviceId(): string {
  try {
    let id = localStorage.getItem('hap.device')
    if (!id) { id = crypto.randomUUID().replace(/-/g, '').slice(0, 20); localStorage.setItem('hap.device', id) }
    return id
  } catch { return 'dev' + Math.random().toString(36).slice(2, 14) }
}

export interface SocketOpts { role: Role; token?: string | null; nickname?: string | null; onOpen?: () => void; url?: string }

/** One WebSocket per page. Tracks seq, asks for a snapshot on gaps, reconnects with backoff, keeps a clock offset. */
export class ArenaSocket {
  ws: WebSocket | null = null
  readonly device = deviceId()
  role: Role
  token: string | null
  nickname: string | null
  lastSeq = 0
  cseq = 0
  connected = false
  offsetMs = 0            // t_server ≈ t_client + offsetMs (client-side estimate from pongs)
  rttMs = 0
  private handlers = new Map<string, Set<Handler>>()
  private backoff = 250
  private pingTimer: number | null = null
  private closed = false
  private opts: SocketOpts
  private offsets: number[] = []

  constructor(opts: SocketOpts) {
    this.opts = opts
    this.role = opts.role; this.token = opts.token ?? null; this.nickname = opts.nickname ?? null
  }

  url(): string {
    if (this.opts.url) return this.opts.url
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}/ws?role=${this.role}&device=${this.device}`
  }

  connect(): void {
    this.closed = false
    const ws = new WebSocket(this.url())
    this.ws = ws
    ws.onopen = () => {
      this.connected = true; this.backoff = 250
      this.sendRaw('session.hello', { role: this.role, device_id: this.device, token: this.token, nickname: this.nickname, ua: navigator.userAgent.slice(0, 200), time_origin: performance.timeOrigin, last_seq: this.lastSeq })
      this.startPings()
      this.opts.onOpen?.()
      this.dispatch({ t: 'session.welcome' as ServerType, seq: this.lastSeq, match: null, ts: Date.now(), d: { __open: true } } as Envelope, '__open')
    }
    ws.onmessage = (ev) => {
      let env: Envelope
      try { env = JSON.parse(ev.data) } catch { return }
      if (env.seq > 0) {
        if (this.lastSeq > 0 && env.seq > this.lastSeq + 1 && env.t !== 'session.snapshot') this.sendRaw('session.resync', { last_seq: this.lastSeq })
        if (env.seq > this.lastSeq) this.lastSeq = env.seq
      }
      if (env.t === 'session.pong') this.onPong(env.d as { t_client: number; t_server: number })
      this.dispatch(env, env.t)
    }
    ws.onclose = () => {
      this.connected = false
      this.stopPings()
      this.dispatch({ t: 'session.error' as ServerType, seq: this.lastSeq, match: null, ts: Date.now(), d: { __closed: true } } as Envelope, '__close')
      if (!this.closed) { setTimeout(() => this.connect(), this.backoff); this.backoff = Math.min(3000, this.backoff * 2) }
    }
    ws.onerror = () => { /* onclose follows */ }
  }

  close(): void { this.closed = true; this.stopPings(); this.ws?.close() }

  send(t: ClientType, d: Record<string, unknown> = {}): boolean { return this.sendRaw(t, d) }

  private sendRaw(t: string, d: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.cseq += 1
    this.ws.send(JSON.stringify({ t, cseq: this.cseq, d }))
    return true
  }

  on(t: ServerType | '__open' | '__close' | '*', fn: Handler): () => void {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set())
    this.handlers.get(t)!.add(fn)
    return () => this.handlers.get(t)?.delete(fn)
  }

  private dispatch(env: Envelope, key: string): void {
    this.handlers.get(key)?.forEach((h) => h(env))
    if (key !== '*') this.handlers.get('*')?.forEach((h) => h(env))
  }

  // ---- clock sync ----
  private startPings(): void {
    let n = 0
    const ping = () => this.sendRaw('session.ping', { t_client: Date.now(), rtt_ms: this.rttMs })
    ping()
    const burst = window.setInterval(() => { ping(); if (++n >= 4) window.clearInterval(burst) }, 300)
    this.pingTimer = window.setInterval(ping, 10_000)
  }
  private stopPings(): void { if (this.pingTimer) { window.clearInterval(this.pingTimer); this.pingTimer = null } }
  private onPong(d: { t_client: number; t_server: number }): void {
    const now = Date.now()
    const rtt = now - d.t_client
    this.rttMs = this.rttMs ? this.rttMs * 0.7 + rtt * 0.3 : rtt
    this.offsets.push(d.t_server - (d.t_client + rtt / 2))
    if (this.offsets.length > 7) this.offsets.shift()
    const s = [...this.offsets].sort((a, b) => a - b)
    this.offsetMs = s[Math.floor(s.length / 2)]
  }
  /** Server-timeline "now" in ms, for aligning animations to server timestamps. */
  serverNow(): number { return Date.now() + this.offsetMs }
}
