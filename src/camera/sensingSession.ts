/**
 * Owns the optional camera sensing session for Ready-Up and in-game Tempo Sense.
 * One Enable Camera click: browser permission + custom-input start + frame pump. No second consent.
 */
import { BrowserCamera } from '../camera/browserCamera'
import { FramePump } from '../camera/framePump'
import { consumerCameraError, consumerValidation } from '../camera/validationCopy'
import { ExpressionAggregator, type ExpressionSummary } from '../wellness/expressions'
import { pulseTier, type PulseTier } from '../wellness/presageQuality'

export type SensingPhase = 'off' | 'requesting' | 'preview' | 'warming' | 'good' | 'unavailable' | 'error'

export interface SensingSnapshot {
  phase: SensingPhase
  guidance: string
  validation: string
  pulse: number | null
  pulseTier: PulseTier
  baselinePulse: number | null
  breathing: number | null
  hrvRmssd: number | null
  facePresent: boolean
  dominantExpression: string | null
  expressionSummary: ExpressionSummary | null
  headMotion: number
  mode: 'live' | 'mock' | 'off'
  mock: boolean
  error: string | null
}

type VitalsWire = {
  status: string
  source: 'camera' | 'custom' | 'demo' | null
  guidance: string
  validation: string
  pulse: { value: number; at: number; confidence?: number; stable?: boolean } | null
  rawPulse?: number | null
  breathing?: { value: number; at: number; confidence?: number; stable?: boolean } | null
  hrv?: { rmssd: number; at: number } | null
  baselinePulse: number | null
  facePresent?: boolean
  validFace?: boolean
  dominantExpression?: string | null
  expressionProbs?: Partial<Record<string, number>> | null
  faceUpdatedAt?: number
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
  private expressions = new ExpressionAggregator()
  private lastPollAt = 0
  private headMotion = 0

  get snapshot(): SensingSnapshot { return this.last }
  get cameraReady(): boolean { return this.camera.state === 'ready' }
  get phaseNow(): SensingPhase { return this.phase }
  get expressionSummary(): ExpressionSummary { return this.expressions.summary() }
  get latestHeadMotion(): number { return this.headMotion }

  /** Enable camera: one Tempo action → OS permission → custom Presage input. */
  async enable(host: HTMLElement, previewRect: DOMRect): Promise<SensingSnapshot> {
    this.phase = 'requesting'
    this.expressions.reset()
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
          error: vitals.error ?? vitals.guidance,
          guidance: consumerCameraError(vitals.error, vitals.guidance),
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

  hidePreview(): void { this.camera.hidePreview() }
  setPreviewRect(rect: DOMRect): void { this.camera.setRect(rect) }

  async retry(host: HTMLElement, previewRect: DOMRect): Promise<SensingSnapshot> {
    await this.stop(false)
    return this.enable(host, previewRect)
  }

  async stop(keepPreview = false): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    this.pump?.stop(); this.pump = null
    try { await fetch('/vitals/stop', { method: 'POST' }) } catch { /* offline */ }
    if (!keepPreview) {
      this.camera.stop()
      this.phase = 'off'
      this.last = blank()
      this.expressions.reset()
      this.headMotion = 0
    }
  }

  continueIntoPlay(): void { this.camera.hidePreview() }

  private startPoll(): void {
    if (this.pollTimer) return
    this.lastPollAt = performance.now()
    this.pollTimer = setInterval(() => { void this.pollOnce() }, 400)
  }

  private async pollOnce(): Promise<SensingSnapshot> {
    try {
      const r = await fetch('/vitals', { cache: 'no-store' })
      if (!r.ok) return this.last
      const v = await r.json() as VitalsWire
      const now = Date.now()
      const wall = performance.now()
      const dt = Math.max(0.05, Math.min(2, (wall - this.lastPollAt) / 1000))
      this.lastPollAt = wall

      const conf = v.pulse?.confidence ?? 0
      const stable = v.pulse?.stable === true
      const pulseAt = v.pulse?.at ?? 0
      const displayValue = v.pulse?.value ?? v.rawPulse ?? null
      const tier = pulseTier(displayValue, conf, stable, v.validation, pulseAt || now, now)
      // Trusted pulse marks "good"; estimating still counts as warming with a live number.
      const trustedOk = tier === 'trusted' && v.validation === 'Ok'
      if (v.status === 'error') this.phase = 'error'
      else if (v.status === 'unavailable') this.phase = 'unavailable'
      else if (trustedOk) this.phase = 'good'
      else if (this.camera.state === 'ready') this.phase = v.status === 'running' || v.status === 'starting' || tier === 'estimating' ? 'warming' : 'preview'

      const usableFace = v.validFace === true || (v.facePresent === true && v.validation === 'Ok')
      this.expressions.sample(dt, usableFace, v.expressionProbs ?? null)
      const liveExpr = this.expressions.liveExpression()
      const summary = this.expressions.summary()

      // Without landmark centers on the wire yet, keep a decaying head-motion placeholder (boxing can still boost when set).
      this.headMotion = Math.max(0, this.headMotion * 0.85)

      const guidance = this.phase === 'error' || this.phase === 'unavailable'
        ? consumerCameraError(v.error, v.guidance)
        : consumerValidation(v.validation, v.guidance)

      this.last = {
        phase: this.phase,
        guidance,
        validation: v.validation,
        pulse: tier === 'none' ? null : displayValue,
        pulseTier: tier,
        baselinePulse: v.baselinePulse,
        breathing: v.breathing?.value ?? null,
        hrvRmssd: v.hrv?.rmssd ?? null,
        facePresent: v.facePresent === true,
        dominantExpression: liveExpr ?? v.dominantExpression ?? null,
        expressionSummary: summary.coverage >= 0.15 ? summary : null,
        headMotion: this.headMotion,
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
    phase: 'off', guidance: 'Camera off', validation: '', pulse: null, pulseTier: 'none', baselinePulse: null,
    breathing: null, hrvRmssd: null, facePresent: false, dominantExpression: null, expressionSummary: null,
    headMotion: 0, mode: 'off', mock: false, error: null,
  }
}

export const sensingSession = new SensingSession()
