/**
 * Owns the optional camera sensing session for Ready-Up and in-game Tempo Sense.
 * One Enable Camera click: browser permission + custom-input start + frame pump. No second consent.
 */
import { BrowserCamera } from '../camera/browserCamera'
import { FramePump } from '../camera/framePump'
import { consumerValidation } from '../camera/validationCopy'

export type SensingPhase = 'off' | 'requesting' | 'preview' | 'warming' | 'good' | 'unavailable' | 'error'

export interface SensingSnapshot {
  phase: SensingPhase
  guidance: string
  validation: string
  pulse: number | null
  baselinePulse: number | null
  facePresent: boolean
  dominantExpression: string | null
  mode: 'live' | 'mock' | 'off'
  mock: boolean
  error: string | null
}

type VitalsWire = {
  status: string
  source: 'camera' | 'demo' | null
  guidance: string
  validation: string
  pulse: { value: number; at: number } | null
  baselinePulse: number | null
  facePresent?: boolean
  dominantExpression?: string | null
  mode?: 'live' | 'mock' | 'off'
  error?: string | null
}

const CONSENT = 'Tempo can use your camera to estimate pulse, breathing, and facial expressions. Video is processed for sensing and is not stored by Tempo.'

class SensingSession {
  readonly consentCopy = CONSENT
  private camera = new BrowserCamera()
  private pump: FramePump | null = null
  private phase: SensingPhase = 'off'
  private last: SensingSnapshot = blank()
  private pollTimer: ReturnType<typeof setInterval> | null = null

  get snapshot(): SensingSnapshot { return this.last }
  get cameraReady(): boolean { return this.camera.state === 'ready' }
  get phaseName(): SensingPhase { return this.phase }

  /** Enable camera: one Tempo action → OS permission → custom Presage input. */
  async enable(host: HTMLElement, previewRect: DOMRect): Promise<SensingSnapshot> {
    this.phase = 'requesting'
    this.publish()
    const cam = await this.camera.start()
    if (cam !== 'ready') {
      this.phase = cam === 'error' ? 'error' : 'unavailable'
      this.last = { ...blank(), phase: this.phase, error: this.camera.error, guidance: this.camera.error ?? 'Camera unavailable' }
      return this.last
    }
    this.camera.mountPreview(host, previewRect)
    this.phase = 'preview'
    this.publish({ guidance: 'Starting sensing…' })
    try {
      const r = await fetch('/vitals/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'custom' }) })
      const vitals = await r.json() as VitalsWire
      if (vitals.status === 'error' || vitals.status === 'unavailable') {
        this.phase = vitals.status === 'unavailable' ? 'unavailable' : 'error'
        this.last = {
          ...blank(), phase: this.phase, mode: vitals.mode ?? 'off', mock: vitals.source === 'demo',
          error: vitals.error ?? vitals.guidance, guidance: vitals.guidance || 'Camera wellness unavailable',
        }
        this.startPoll()
        return this.last
      }
      const video = this.camera.getVideo()
      if (video) {
        this.pump?.stop()
        this.pump = new FramePump(video)
        this.pump.start()
      }
      this.phase = 'warming'
      this.startPoll()
      return this.pollOnce()
    } catch {
      this.phase = 'unavailable'
      this.last = { ...blank(), phase: 'unavailable', guidance: 'Camera wellness unavailable. You can still play.', error: 'service offline' }
      return this.last
    }
  }

  /** Hide DOM preview but keep the stream + pump for in-game Tempo Sense. */
  hidePreview(): void {
    this.camera.hidePreview()
  }

  setPreviewRect(rect: DOMRect): void { this.camera.setRect(rect) }

  async retry(host: HTMLElement, previewRect: DOMRect): Promise<SensingSnapshot> {
    await this.stop(false)
    return this.enable(host, previewRect)
  }

  /** Stop sensing; keepPreview=false also releases the MediaStream. */
  async stop(keepPreview = false): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    this.pump?.stop(); this.pump = null
    try { await fetch('/vitals/stop', { method: 'POST' }) } catch { /* offline */ }
    if (!keepPreview) {
      this.camera.stop()
      this.phase = 'off'
      this.last = blank()
    }
  }

  /** Keep sensing alive into gameplay: hide preview, continue poll + pump. */
  continueIntoPlay(): void {
    this.camera.hidePreview()
  }

  private startPoll(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => { void this.pollOnce() }, 500)
  }

  private async pollOnce(): Promise<SensingSnapshot> {
    try {
      const r = await fetch('/vitals', { cache: 'no-store' })
      if (!r.ok) return this.last
      const v = await r.json() as VitalsWire
      const guidance = consumerValidation(v.validation, v.guidance)
      const good = v.validation === 'Ok' && v.pulse && Date.now() - v.pulse.at <= 5000
      if (v.status === 'error') this.phase = 'error'
      else if (v.status === 'unavailable') this.phase = 'unavailable'
      else if (good) this.phase = 'good'
      else if (this.camera.state === 'ready') this.phase = v.status === 'running' || v.status === 'starting' ? 'warming' : 'preview'
      this.last = {
        phase: this.phase,
        guidance,
        validation: v.validation,
        pulse: v.pulse?.value ?? null,
        baselinePulse: v.baselinePulse,
        facePresent: v.facePresent === true,
        dominantExpression: v.dominantExpression ?? null,
        mode: v.mode ?? 'off',
        mock: v.source === 'demo' || v.mode === 'mock',
        error: v.error ?? null,
      }
    } catch { /* keep last */ }
    return this.last
  }

  private publish(partial: Partial<SensingSnapshot> = {}): void {
    this.last = { ...this.last, phase: this.phase, ...partial }
  }
}

function blank(): SensingSnapshot {
  return {
    phase: 'off', guidance: 'Camera off', validation: '', pulse: null, baselinePulse: null,
    facePresent: false, dominantExpression: null, mode: 'off', mock: false, error: null,
  }
}

export const sensingSession = new SensingSession()
