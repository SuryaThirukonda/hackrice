/**
 * Camera vitals through Presage SmartSpectra, inside the agent service.
 *
 * The key stays in the service, and raw frames are never stored: the SDK sends preprocessed signal data
 * to Presage's physiology API, and that is stated on the consent screen.
 *
 * Two input paths. The product path is `custom`: the page opens the camera, shows the player the live
 * preview and pushes those same frames here through `pushFrame`, so there is one permission prompt and
 * no hidden sensor. The `camera` path lets the native binding open the laptop camera itself, which is
 * kept for the dev lab and as a fallback. `demo` drives the same reducer with a synthetic source.
 *
 * What is shown as a headline reading: pulse rate and breathing rate, both gated on the SDK's own
 * `stable` flag and a confidence floor. Advanced cardio metrics are deliberately not requested by
 * the product. Everything is a wellness reading; nothing here diagnoses anything.
 *
 * `applyMetrics` is a pure reducer over the decoded metrics message so it can be tested without a
 * camera, and a synthetic source drives the same reducer for demos on machines without one.
 */
import { readdirSync } from 'node:fs'
import { BREATHING_RANGE, metricUsable, PULSE_RANGE } from '../src/wellness/physiology'

export interface Reading { value: number; confidence: number; stable: boolean; at: number }
export interface HrvReading { rmssd: number; sdnn: number; confidence: number; at: number }
export type VitalsStatus = 'off' | 'starting' | 'running' | 'error' | 'unavailable'
/** Where the frames come from: the SDK's own camera, frames pushed from the browser, or the synthetic source. */
export type VitalsInput = 'camera' | 'custom' | 'demo'
/** Face analysis, when the face metrics are on. Presence and expression only: no claims of any kind are
 *  made from these, and no landmarks are kept. */
export interface FaceState {
  facePresent?: boolean
  talking?: boolean
  blinking?: boolean
  /** One of the SDK's expression names, lower-cased: happy, neutral, sad, surprise, angry, contempt, disgust, fear. */
  dominantExpression?: string
  expressionProbs?: Partial<Record<string, number>>
  validFace?: boolean
  faceUpdatedAt?: number
}
export interface VitalsState extends FaceState {
  status: VitalsStatus
  source: 'camera' | 'custom' | 'demo' | null
  startedAt: number | null
  updatedAt: number
  /** The SDK's readiness hint, e.g. "move closer" or "hold still". */
  guidance: string
  validation: string
  error: string | null
  pulse: Reading | null
  breathing: Reading | null
  hrv: HrvReading | null
  /** Latest raw readings even when not stable, so the page can show the sensor is alive. */
  rawPulse: number | null
  rawBreathing: number | null
  pulseHistory: { at: number; bpm: number }[]
  breathingHistory: { at: number; brpm: number }[]
  /** Breathing waveform, the last several seconds, for a live trace. */
  breathingTrace: { at: number; v: number }[]
  baselinePulse: number | null
  baselineBreathing: number | null
  /** 0..1, how far pulse and breathing sit above the resting baseline. */
  exertion: number | null
  /** Pulse a minute ago minus pulse now: positive means coming down. */
  recovery: number | null
  stableReadings: number
  mode: 'live' | 'mock' | 'off'
}

export const MIN_CONFIDENCE = 40

/** Hand-picked SDK MetricType codes for Tempo's product path. The cardio bundle also includes
 * ARTERIAL_PRESSURE_TRACE (16), which loads a separate phasic-BP model and is outside Tempo's
 * wellness scope. Requesting the whole bundle can fail an otherwise valid pulse session when that
 * model is not provisioned. HRV (17) is likewise excluded from product adaptation.
 *
 * Face analysis (11–14) is valuable but not always provisioned on every Presage key. The bridge
 * starts with the full set and silently falls back to CORE metrics if the SDK reports
 * ProcessingFailed (8), so pulse/breathing still work. */
export const CORE_WELLNESS_METRICS = Object.freeze([
  0,  // CHEST_BREATHING
  2,  // BREATHING_RATE
  15, // PULSE_RATE
])
export const FACE_WELLNESS_METRICS = Object.freeze([
  11, // FACE_LANDMARKS
  12, // BLINKING
  13, // TALKING
  14, // EXPRESSIONS
])
export const REQUESTED_WELLNESS_METRICS = Object.freeze([...CORE_WELLNESS_METRICS, ...FACE_WELLNESS_METRICS])

/** SDK SmartSpectraErrorCode.kProcessingFailed — often means a requested model is unavailable or frames are unusable. */
export const PROCESSING_FAILED = 8

/** Video devices the OS exposes. Only Linux enumerates them as files; elsewhere the SDK is the only way to know. */
export function listCameras(): { checked: boolean; devices: string[] } {
  if (process.platform !== 'linux') return { checked: false, devices: [] }
  try { return { checked: true, devices: readdirSync('/dev').filter((n) => /^video\d+$/.test(n)).sort().map((n) => `/dev/${n}`) } }
  catch { return { checked: true, devices: [] } }
}
const HISTORY_MS = 10 * 60_000
const TRACE_MS = 15_000
/** Presage needs about one pulse window to produce a usable stable reading at all, so a dozen of them
 *  meant a minute of standing still before the game would start. Two usable readings, median, is the
 *  resting baseline: everything downstream is a ratio against it, not a clinical number. */
export const BASELINE_READINGS = 2

export function emptyVitals(mode: VitalsState['mode'] = 'live'): VitalsState {
  return {
    status: 'off', source: null, startedAt: null, updatedAt: 0, guidance: 'camera off', validation: '', error: null,
    pulse: null, breathing: null, hrv: null, rawPulse: null, rawBreathing: null,
    pulseHistory: [], breathingHistory: [], breathingTrace: [], baselinePulse: null, baselineBreathing: null,
    exertion: null, recovery: null, stableReadings: 0, mode,
  }
}

/** The decoded protobuf, as much of it as this file reads. Field names follow the SDK's generated types. */
export interface DecodedMetrics {
  breathing?: { rate?: Measured[] | null; upperTrace?: Measured[] | null } | null
  cardio?: { pulseRate?: Measured[] | null; hrv?: { rmssd?: number | null; sdnn?: number | null; confidence?: number | null; stable?: boolean | null; timestamp?: unknown }[] | null } | null
  face?: {
    blinking?: Detected[] | null
    talking?: Detected[] | null
    landmarks?: { value?: unknown[] | null; stable?: boolean | null; timestamp?: unknown }[] | null
    expression?: { stable?: boolean | null; timestamp?: unknown; scores?: { type?: number | string | null; confidence?: number | null }[] | null }[] | null
  } | null
}
interface Measured { value?: number | null; stable?: boolean | null; confidence?: number | null; timestamp?: unknown }
interface Detected { detected?: boolean | null; stable?: boolean | null; timestamp?: unknown }

/** ExpressionType, by integer, as protobufjs decodes it. A build that hands back the enum name instead
 *  is accepted too; anything unrecognised is dropped rather than guessed at. */
const EXPRESSIONS: Readonly<Record<number, string>> = { 1: 'angry', 2: 'contempt', 3: 'disgust', 4: 'fear', 5: 'happy', 6: 'neutral', 7: 'sad', 8: 'surprise' }
const expressionName = (t: number | string | null | undefined): string | null => {
  if (typeof t === 'number') return EXPRESSIONS[t] ?? null
  if (typeof t !== 'string' || !t) return null
  const name = t.replace(/^k/, '').toLowerCase()
  return Object.values(EXPRESSIONS).includes(name) ? name : null
}

/** SDK timestamps are microseconds since the epoch, sometimes as a Long; normalise to milliseconds. */
export function toMs(ts: unknown, fallback: number): number {
  const n = typeof ts === 'number' ? ts : typeof ts === 'object' && ts !== null && 'toNumber' in ts ? (ts as { toNumber: () => number }).toNumber() : Number(ts)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n > 1e14 ? n / 1000 : n > 1e11 ? n : fallback
}

const latest = <T,>(xs: T[] | null | undefined): T | null => (Array.isArray(xs) && xs.length ? xs[xs.length - 1] : null)
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const trim = <T extends { at: number }>(xs: T[], now: number, keepMs: number): T[] => { while (xs.length && xs[0].at < now - keepMs) xs.shift(); return xs }

/** Read the face block, defensively: any of the four face metrics can be absent, and a build that does
 *  not carry them at all must leave the face fields untouched rather than reporting "no face". */
export function applyFace(state: VitalsState, m: DecodedMetrics, now: number): boolean {
  const face = m.face
  if (!face) return false
  let seen = false
  const landmarks = latest(face.landmarks)
  if (landmarks) {
    state.facePresent = Array.isArray(landmarks.value) && landmarks.value.length > 0
    state.validFace = landmarks.stable === true && state.facePresent
    seen = true
  }
  const blinking = latest(face.blinking)
  if (blinking) { state.blinking = blinking.detected === true; seen = true }
  const talking = latest(face.talking)
  if (talking) { state.talking = talking.detected === true; seen = true }
  const expression = latest(face.expression)
  const scores = expression?.scores
  if (Array.isArray(scores) && scores.length) {
    const probs: Record<string, number> = {}
    let best: { name: string; p: number } | null = null
    for (const s of scores) {
      const name = expressionName(s?.type)
      const p = Number(s?.confidence)
      if (!name || !Number.isFinite(p)) continue
      probs[name] = Math.round(clamp01(p / 100) * 1000) / 1000
      if (!best || probs[name] > best.p) best = { name, p: probs[name] }
    }
    if (best) {
      state.expressionProbs = probs
      state.dominantExpression = best.name
      if (state.facePresent === undefined) state.facePresent = true
      seen = true
    }
  }
  if (seen) state.faceUpdatedAt = now
  return seen
}

/** Fold one metrics message into the state. Returns the readings that became stable this call, for logging. */
export function applyMetrics(state: VitalsState, m: DecodedMetrics, now: number, samples: number[] = []): { pulse?: Reading; breathing?: Reading; hrv?: HrvReading } {
  const out: { pulse?: Reading; breathing?: Reading; hrv?: HrvReading } = {}
  applyFace(state, m, now)
  const pr = latest(m.cardio?.pulseRate)
  if (pr && Number.isFinite(Number(pr.value))) {
    const r: Reading = { value: Number(pr.value), confidence: Number(pr.confidence ?? 0), stable: pr.stable === true, at: toMs(pr.timestamp, now) }
    state.rawPulse = r.value
    if (metricUsable(r.value, r.confidence, r.stable, PULSE_RANGE, state.validation, r.at, now)) {
      state.pulse = r; out.pulse = r; state.stableReadings += 1
      if (!state.pulseHistory.length || state.pulseHistory[state.pulseHistory.length - 1].at < r.at) state.pulseHistory.push({ at: r.at, bpm: r.value })
      trim(state.pulseHistory, now, HISTORY_MS)
      if (state.baselinePulse === null) { samples.push(r.value); if (samples.length >= BASELINE_READINGS) state.baselinePulse = median(samples) }
    }
  }
  const br = latest(m.breathing?.rate)
  if (br && Number.isFinite(Number(br.value))) {
    const r: Reading = { value: Number(br.value), confidence: Number(br.confidence ?? 0), stable: br.stable === true, at: toMs(br.timestamp, now) }
    state.rawBreathing = r.value
    if (metricUsable(r.value, r.confidence, r.stable, BREATHING_RANGE, state.validation, r.at, now) && r.confidence >= 45) {
      state.breathing = r; out.breathing = r
      if (!state.breathingHistory.length || state.breathingHistory[state.breathingHistory.length - 1].at < r.at) state.breathingHistory.push({ at: r.at, brpm: r.value })
      trim(state.breathingHistory, now, HISTORY_MS)
      if (state.baselineBreathing === null && state.breathingHistory.length >= BASELINE_READINGS) state.baselineBreathing = median(state.breathingHistory.slice(0, BASELINE_READINGS).map((x) => x.brpm))
    }
  }
  for (const p of m.breathing?.upperTrace ?? []) {
    if (!Number.isFinite(Number(p?.value))) continue
    const at = toMs(p.timestamp, now)
    if (!state.breathingTrace.length || at > state.breathingTrace[state.breathingTrace.length - 1].at) state.breathingTrace.push({ at, v: Number(p.value) })
  }
  trim(state.breathingTrace, now, TRACE_MS)
  const hv = m.cardio?.hrv?.length ? m.cardio.hrv[m.cardio.hrv.length - 1] : null
  if (hv && Number.isFinite(Number(hv.rmssd)) && hv.stable === true && Number(hv.confidence ?? 0) >= 50 && !['ExcessiveMotion', 'NoFaceFound', 'MultipleFacesFound'].includes(state.validation)) {
    state.hrv = { rmssd: Number(hv.rmssd), sdnn: Number(hv.sdnn ?? 0), confidence: Number(hv.confidence ?? 0), at: toMs(hv.timestamp, now) }
    out.hrv = state.hrv
  }
  if (state.baselinePulse !== null && state.pulse) {
    const pulseLoad = clamp01((state.pulse.value - state.baselinePulse) / 50)
    const breathLoad = state.baselineBreathing !== null && state.breathing ? clamp01((state.breathing.value - state.baselineBreathing) / 20) : pulseLoad
    state.exertion = Math.round(clamp01(pulseLoad * 0.65 + breathLoad * 0.35) * 100) / 100
  }
  if (state.pulse) {
    // the most recent reading that is at least 45 s old: "a minute ago" with some slack for gaps
    const cutoff = state.pulse.at - 45_000
    let ago: { at: number; bpm: number } | null = null
    for (let i = state.pulseHistory.length - 1; i >= 0; i--) if (state.pulseHistory[i].at <= cutoff) { ago = state.pulseHistory[i]; break }
    state.recovery = ago ? Math.round(ago.bpm - state.pulse.value) : null
  }
  if (out.pulse || out.breathing || out.hrv) state.updatedAt = now
  return out
}

/** A plausible resting person, for machines without a camera and for the page's own development.
 *  Stamped with the caller's clock, as the real SDK stamps with the wall clock. */
export function demoMetrics(tSeconds: number, nowMs: number, rng: () => number = Math.random): DecodedMetrics {
  const pulse = 68 + 6 * Math.sin(tSeconds / 40) + (rng() - 0.5) * 2
  const breathing = 14 + 2 * Math.sin(tSeconds / 60) + (rng() - 0.5)
  const us = nowMs * 1000
  const trace = Array.from({ length: 10 }, (_, i) => ({ value: Math.sin(2 * Math.PI * (breathing / 60) * (tSeconds + i / 10)), stable: true, timestamp: us + i * 100_000 }))
  const happy = clamp01(0.35 + 0.3 * Math.sin(tSeconds / 30))
  return {
    cardio: { pulseRate: [{ value: pulse, stable: tSeconds > 8, confidence: tSeconds > 8 ? 85 : 30, timestamp: us }], hrv: [{ rmssd: 42 + 8 * Math.sin(tSeconds / 25), sdnn: 55, confidence: 80, stable: tSeconds > 20, timestamp: us }] },
    breathing: { rate: [{ value: breathing, stable: tSeconds > 12, confidence: tSeconds > 12 ? 82 : 25, timestamp: us }], upperTrace: trace },
    face: {
      landmarks: [{ value: [{ x: 0.5, y: 0.45 }], stable: true, timestamp: us }],
      blinking: [{ detected: tSeconds % 4 < 1, stable: true, timestamp: us }],
      talking: [{ detected: false, stable: true, timestamp: us }],
      expression: [{ stable: tSeconds > 6, timestamp: us, scores: [{ type: 5, confidence: happy * 100 }, { type: 6, confidence: (1 - happy) * 100 }] }],
    },
  }
}

type Sdk = {
  on: (event: string, cb: (...args: never[]) => void) => unknown
  useCamera: (o: { deviceIndex?: number; width?: number; height?: number; fps?: number }) => unknown
  useCustomInput: (frameTransform?: number) => unknown
  sendFrame: (buffer: Uint8Array, width: number, height: number, stride: number, pixelFormat: number, timestampUs: number) => boolean
  start: () => unknown
  stopAsync: () => Promise<void>
  destroy: () => Promise<void>
}
type SdkModule = {
  SmartSpectraSDK: new (o: { apiKey?: string; requestedMetrics?: number[]; enableTelemetry?: boolean; enableAccumulatedOutput?: boolean }) => Sdk
  breathingMetrics: readonly number[]; cardioMetrics: readonly number[]
  decodeMetrics: (buf: Buffer) => unknown
  ValidationCode: Record<string, number>; ProcessingStatus: Record<string, number>
  PixelFormat: Record<string, number>
}

export class VitalsBridge {
  state: VitalsState
  /** Called for every reading that passed the stability gate, so the caller can log it. */
  onReading: ((r: { at: number; pulse: number | null; breathing: number | null; hrvRmssd: number | null; confidence: number }) => void) | null = null
  private sdk: Sdk | null = null
  private demo: ReturnType<typeof setInterval> | null = null
  private baselineSamples: number[] = []
  private apiKey: () => string
  private mode: VitalsState['mode']
  /** Set only in custom-input mode: the browser owns the camera and pushes frames through pushFrame. */
  private rgbFormat = 0
  private lastFrameUs = 0
  private custom = false
  private includeFace = true
  private recovering = false
  private startOpts: { cameraIndex?: number; demo?: boolean; input?: VitalsInput } = {}
  framesAccepted = 0
  constructor(apiKey: () => string, mode: VitalsState['mode'] = 'live') { this.apiKey = apiKey; this.mode = mode; this.state = emptyVitals(mode) }

  async start(opts: { cameraIndex?: number; demo?: boolean; input?: VitalsInput } = {}): Promise<VitalsState> {
    await this.stop()
    this.startOpts = opts
    const demo = opts.demo === true || opts.input === 'demo' || this.mode === 'mock'
    const custom = !demo && opts.input === 'custom'
    this.custom = custom
    // Fresh Enable Camera tries face metrics again; internal recovery keeps includeFace=false.
    if (!this.recovering) this.includeFace = true
    this.recovering = false
    this.state = {
      ...emptyVitals(this.mode), status: 'starting', startedAt: Date.now(),
      source: demo ? 'demo' : custom ? 'custom' : 'camera',
      guidance: demo ? 'demo source' : custom ? 'waiting for camera frames…' : 'starting camera…',
    }
    this.baselineSamples = []
    this.lastFrameUs = 0
    this.framesAccepted = 0
    if (this.mode === 'off') { this.state.status = 'unavailable'; this.state.guidance = 'camera sensing is off'; return this.state }
    if (demo) {
      const t0 = Date.now()
      this.demo = setInterval(() => {
        const t = (Date.now() - t0) / 1000
        this.state.status = 'running'; this.state.validation = 'Ok'; this.state.guidance = t < 8 ? 'settling (demo)' : 'Good measurement (demo)'
        this.ingest(demoMetrics(t, Date.now()))
      }, 1000)
      return this.state
    }
    const key = this.apiKey()
    if (!key) { this.state.status = 'error'; this.state.error = 'no Presage key in .env (PRESSAGE_KEY)'; this.state.guidance = this.state.error; return this.state }
    // Do not spin up the native runtime when there is plainly nothing to open: each failed attempt would
    // otherwise leave the SDK's thread pool behind and fill the log with its start-up chatter. In custom
    // mode the browser holds the camera, so this machine's device list says nothing about it.
    const cams = custom ? { checked: false, devices: [] } : listCameras()
    if (cams.checked && cams.devices.length === 0) {
      this.state.status = 'error'
      this.state.error = 'No camera device is present on this machine (nothing under /dev/video*). Plug in a USB webcam, check the camera privacy key or BIOS setting, or use the demo.'
      this.state.guidance = this.state.error
      return this.state
    }
    let mod: SdkModule
    try {
      // @ts-ignore -- optional dependency loaded dynamically at runtime if installed
      mod = await import('@smartspectra/node-sdk') as unknown as SdkModule
    }
    catch (e) { this.state.status = 'unavailable'; this.state.error = `SmartSpectra SDK not available: ${(e as Error).message.slice(0, 160)}`; this.state.guidance = this.state.error; return this.state }
    const validationNames = Object.fromEntries(Object.entries(mod.ValidationCode).map(([k, v]) => [v, k.replace(/^k/, '')]))
    const statusNames = Object.fromEntries(Object.entries(mod.ProcessingStatus).map(([k, v]) => [v, k.replace(/^k/, '').toLowerCase()]))
    const metrics = this.includeFace ? [...REQUESTED_WELLNESS_METRICS] : [...CORE_WELLNESS_METRICS]
    let sdk: Sdk | null = null
    try {
      sdk = new mod.SmartSpectraSDK({ apiKey: key, requestedMetrics: metrics, enableTelemetry: false, enableAccumulatedOutput: false })
      sdk.on('processingStatus', ((status: number) => { const name = statusNames[status] ?? `status ${status}`; this.state.status = name === 'running' ? 'running' : this.state.status === 'error' ? 'error' : 'starting'; this.state.validation = name }) as never)
      sdk.on('validationStatus', ((code: number, _ts: number, hint: string) => { this.state.validation = validationNames[code] ?? `code ${code}`; this.state.guidance = hint || (this.state.validation === 'Ok' ? 'Good measurement' : this.state.validation) }) as never)
      sdk.on('metrics', ((buf: Buffer) => { try { this.ingest(mod.decodeMetrics(buf) as DecodedMetrics) } catch (e) { this.state.guidance = `could not decode metrics: ${(e as Error).message}` } }) as never)
      sdk.on('error', ((code: number, message: string, retryable: boolean) => {
        // Face models are not on every Presage account. Drop them once and restart so pulse still works.
        if (code === PROCESSING_FAILED && this.includeFace && this.custom && retryable) {
          this.includeFace = false
          this.recovering = true
          this.state.guidance = 'Retrying camera sensing without face analysis…'
          void this.start({ ...this.startOpts, input: 'custom' })
          return
        }
        this.state.status = 'error'
        this.state.error = `${message} (${code}${retryable ? ', retryable' : ''})`
        this.state.guidance = code === PROCESSING_FAILED
          ? 'Camera sensing failed. Check lighting and framing, then tap Retry — or play with phone movement only.'
          : this.state.error
      }) as never)
      if (custom) { this.rgbFormat = mod.PixelFormat?.kRGB ?? 0; sdk.useCustomInput() }
      else sdk.useCamera({ deviceIndex: opts.cameraIndex ?? 0, width: 1280, height: 720, fps: 30 })
      sdk.start()
      this.sdk = sdk
      if (!this.includeFace) this.state.guidance = 'camera sensing ready (pulse only)'
    } catch (e) {
      // A failed start must not leave a live native instance behind.
      if (sdk) { try { await sdk.destroy() } catch { /* never started */ } }
      const message = (e as Error).message.slice(0, 200)
      // "input is unavailable" is what the SDK says when it cannot open any camera at all.
      this.state.status = 'error'
      this.state.error = /input is unavailable/i.test(message) && !custom ? `${message} No camera could be opened at index ${opts.cameraIndex ?? 0}: this machine may have no webcam, or another app holds it. Try the demo, or run the service on the laptop with the camera.` : message
      this.state.guidance = this.state.error
    }
    return this.state
  }

  /** One frame from the browser's own camera. Frames are handed straight to the SDK and never stored. */
  pushFrame(buf: Buffer | Uint8Array, width: number, height: number, stride: number, timestampUs: number): boolean {
    const sdk = this.sdk
    if (!sdk || this.state.source !== 'custom') return false
    // A failed session rejects every frame with its own error, so stop pushing and let the page restart.
    if (this.state.status === 'error') return false
    // The SDK rejects the whole session on a non-monotonic timestamp, so drop rather than send late frames.
    if (timestampUs <= this.lastFrameUs) return false
    try {
      if (!sdk.sendFrame(buf, width, height, stride, this.rgbFormat, timestampUs)) return false
    } catch { return false }
    this.lastFrameUs = timestampUs
    if (this.framesAccepted === 0) this.state.guidance = 'reading from your camera…'
    this.framesAccepted += 1
    if (this.state.status === 'starting' && this.framesAccepted >= 8) this.state.status = 'running'
    return true
  }

  private ingest(m: DecodedMetrics): void {
    const now = Date.now()
    const got = applyMetrics(this.state, m, now, this.baselineSamples)
    if (got.pulse || got.breathing || got.hrv) this.onReading?.({ at: now, pulse: got.pulse?.value ?? null, breathing: got.breathing?.value ?? null, hrvRmssd: got.hrv?.rmssd ?? null, confidence: Math.max(got.pulse?.confidence ?? 0, got.breathing?.confidence ?? 0) })
  }

  async stop(): Promise<VitalsState> {
    if (this.demo) { clearInterval(this.demo); this.demo = null }
    const sdk = this.sdk; this.sdk = null
    if (sdk) { try { await sdk.stopAsync() } catch { /* already stopped */ } try { await sdk.destroy() } catch { /* already gone */ } }
    this.lastFrameUs = 0
    this.state = { ...this.state, status: 'off', source: null, guidance: 'camera off' }
    return this.state
  }
}
