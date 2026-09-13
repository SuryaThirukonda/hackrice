/**
 * Sends the preview's own frames to the local service for the SDK's custom input.
 *
 * SmartSpectra measures frame rate from the timestamps we attach — not from the webcam's native Hz.
 * It rejects feeds under ~25 fps (FrameRateTooLow). Target 30 fps to match the SDK camera default.
 * Latest-frame wins only when the socket is already more than one frame behind.
 */
import { encodeFrameHeader, FRAME_FORMAT_RGB, FRAME_HEADER_BYTES } from '../../server/vitalsFrames'

export type FramePumpState = 'off' | 'connecting' | 'pumping' | 'error'

const WIDTH = 640
const HEIGHT = 360
/** Must stay above SmartSpectra's ~25 fps floor; 24 fps was reporting FrameRateTooLow on a 60 Hz Mac camera. */
const FPS = 30

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
  private raf = 0
  private lastSendMs = 0
  private ctx: CanvasRenderingContext2D | null = null
  private payload: Uint8Array
  private frameBytes: number
  private lastUs = 0

  constructor(video: HTMLVideoElement, opts: { url?: string; fps?: number; width?: number; height?: number } = {}) {
    this.video = video
    this.width = opts.width ?? WIDTH
    this.height = opts.height ?? HEIGHT
    this.periodMs = 1000 / (opts.fps ?? FPS)
    this.url = opts.url ?? framesUrl()
    this.frameBytes = FRAME_HEADER_BYTES + this.width * this.height * 3
    this.payload = new Uint8Array(this.frameBytes)
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
      if (packet.type === 'hello' && packet.ok) {
        this.state = 'pumping'
        this.lastSendMs = 0
        this.raf = requestAnimationFrame((t) => this.loop(t))
      } else if (packet.type === 'error') {
        this.state = 'error'
        this.error = packet.message ?? 'the service refused the camera frames'
      }
    }
    socket.onerror = () => { if (this.state !== 'error') { this.state = 'error'; this.error = 'could not reach the local service' } }
    socket.onclose = () => {
      cancelAnimationFrame(this.raf)
      this.raf = 0
      if (this.state === 'pumping' || this.state === 'connecting') this.state = 'off'
      this.socket = null
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    const socket = this.socket
    this.socket = null
    this.state = 'off'
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.close() }
  }

  private loop(now: number): void {
    this.raf = requestAnimationFrame((t) => this.loop(t))
    if (this.state !== 'pumping') return
    if (now - this.lastSendMs < this.periodMs) return
    this.lastSendMs = now
    this.tick()
  }

  private tick(): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    // HAVE_CURRENT_DATA: before that there is nothing to sample.
    if (this.video.readyState < 2 || this.video.videoWidth < 2) return
    // One in-flight frame is fine; only drop when we are already a full frame behind.
    if (socket.bufferedAmount >= this.frameBytes) { this.dropped += 1; return }
    const ctx = this.context()
    if (!ctx) return
    ctx.drawImage(this.video, 0, 0, this.width, this.height)
    const rgba = ctx.getImageData(0, 0, this.width, this.height).data
    // Skip near-black frames (camera still starting) — they push the SDK into ProcessingFailed.
    // Do this only briefly; skipping forever would also tank the measured fps.
    let lum = 0
    for (let i = 0; i < rgba.length; i += 16) lum += rgba[i] + rgba[i + 1] + rgba[i + 2]
    if (this.sent < 3 && lum / (rgba.length / 16 * 3) < 8) { this.dropped += 1; return }
    const rgb = this.payload
    for (let i = 0, o = FRAME_HEADER_BYTES; i < rgba.length; i += 4, o += 3) {
      rgb[o] = rgba[i]; rgb[o + 1] = rgba[i + 1]; rgb[o + 2] = rgba[i + 2]
    }
    // Wall-clock microseconds so the SDK sees a real ~30 fps stream (it rejects non-monotonic stamps).
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
