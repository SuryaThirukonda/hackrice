/**
 * Sends the preview's own frames to the local service for the SDK's custom input.
 *
 * Small and slow on purpose: 480×270 RGB at ~12 fps is plenty for rPPG and cheap to sample. Latest
 * frame wins — if the socket has not drained the previous one, this frame is dropped rather than
 * queued, so a slow moment can never build a backlog of stale frames. Frames leave the machine
 * nowhere: the socket is the loopback service, which never stores them.
 */
import { encodeFrameHeader, FRAME_FORMAT_RGB, FRAME_HEADER_BYTES } from '../../server/vitalsFrames'

export type FramePumpState = 'off' | 'connecting' | 'pumping' | 'error'

const WIDTH = 480
const HEIGHT = 270
const FPS = 12

export function framesUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/vitals-frames-ws`
}

export class FramePump {
  state: FramePumpState = 'off'
  error: string | null = null
  sent = 0
  dropped = 0
  private video: HTMLVideoElement
  private width: number
  private height: number
  private periodMs: number
  private url: string
  private socket: WebSocket | null = null
  private timer: number | undefined
  private ctx: CanvasRenderingContext2D | null = null
  private payload: Uint8Array
  private lastUs = 0

  constructor(video: HTMLVideoElement, opts: { url?: string; fps?: number; width?: number; height?: number } = {}) {
    this.video = video
    this.width = opts.width ?? WIDTH
    this.height = opts.height ?? HEIGHT
    this.periodMs = Math.round(1000 / (opts.fps ?? FPS))
    this.url = opts.url ?? framesUrl()
    this.payload = new Uint8Array(FRAME_HEADER_BYTES + this.width * this.height * 3)
  }

  /** The service must already be running in custom-input mode: it refuses the socket otherwise. */
  start(): void {
    if (this.socket) return
    this.state = 'connecting'
    this.error = null
    const socket = new WebSocket(this.url)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.onopen = () => { socket.send('hello') }
    socket.onmessage = (message) => {
      if (typeof message.data !== 'string') return
      let packet: { type?: string; ok?: boolean; message?: string }
      try { packet = JSON.parse(message.data) as typeof packet } catch { return }
      if (packet.type === 'hello' && packet.ok) { this.state = 'pumping'; this.timer = window.setInterval(() => this.tick(), this.periodMs) }
      else if (packet.type === 'error') { this.state = 'error'; this.error = packet.message ?? 'the service refused the camera frames' }
    }
    socket.onerror = () => { if (this.state !== 'error') { this.state = 'error'; this.error = 'could not reach the local service' } }
    socket.onclose = () => { window.clearInterval(this.timer); this.timer = undefined; if (this.state === 'pumping' || this.state === 'connecting') this.state = 'off'; this.socket = null }
  }

  stop(): void {
    window.clearInterval(this.timer)
    this.timer = undefined
    const socket = this.socket
    this.socket = null
    this.state = 'off'
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.close() }
  }

  private tick(): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    // HAVE_CURRENT_DATA: before that there is nothing to sample.
    if (this.video.readyState < 2) return
    if (socket.bufferedAmount > 0) { this.dropped += 1; return }
    const ctx = this.context()
    if (!ctx) return
    ctx.drawImage(this.video, 0, 0, this.width, this.height)
    const rgba = ctx.getImageData(0, 0, this.width, this.height).data
    const rgb = this.payload
    for (let i = 0, o = FRAME_HEADER_BYTES; i < rgba.length; i += 4, o += 3) {
      rgb[o] = rgba[i]; rgb[o + 1] = rgba[i + 1]; rgb[o + 2] = rgba[i + 2]
    }
    // The SDK rejects a timestamp that does not strictly increase, and two samples can land on one tick.
    const us = Math.max(this.lastUs + 1, Math.round((performance.timeOrigin + performance.now()) * 1000))
    this.lastUs = us
    encodeFrameHeader({ width: this.width, height: this.height, stride: this.width * 3, timestampUs: us, format: FRAME_FORMAT_RGB }, rgb)
    socket.send(rgb)
    this.sent += 1
  }

  private context(): CanvasRenderingContext2D | null {
    if (this.ctx) return this.ctx
    const canvas = document.createElement('canvas')
    canvas.width = this.width
    canvas.height = this.height
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })
    return this.ctx
  }
}
