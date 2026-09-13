/**
 * Camera vitals through Presage SmartSpectra, inside the agent service.
 *
 * The SDK is a native binding that opens the laptop camera itself and runs headless in Node, so the
 * browser never touches the sensor: it only turns the reading on and off and shows the numbers. The
 * key stays in the service. Raw frames are never stored; the SDK sends preprocessed signal data to
 * Presage's physiology API, and that is stated on the consent screen.
 *
 * What is shown as a headline reading: pulse rate and breathing rate, both gated on the SDK's own
 * `stable` flag and a confidence floor. Heart-rate variability is shown labelled as an uncleared
 * metric. Everything is a wellness reading; nothing here diagnoses anything.
 *
 * `applyMetrics` is a pure reducer over the decoded metrics message so it can be tested without a
 * camera, and a synthetic source drives the same reducer for demos on machines without one.
 */
import { readdirSync } from 'node:fs'

export interface Reading { value: number; confidence: number; stable: boolean; at: number }
export interface HrvReading { rmssd: number; sdnn: number; confidence: number; at: number }
export type VitalsStatus = 'off' | 'starting' | 'running' | 'error' | 'unavailable'
export interface VitalsState {
  status: VitalsStatus
  source: 'camera' | 'demo' | null
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
}

export const MIN_CONFIDENCE = 60

/** Video devices the OS exposes. Only Linux enumerates them as files; elsewhere the SDK is the only way to know. */
export function listCameras(): { checked: boolean; devices: string[] } {
  if (process.platform !== 'linux') return { checked: false, devices: [] }
  try { return { checked: true, devices: readdirSync('/dev').filter((n) => /^video\d+$/.test(n)).sort().map((n) => `/dev/${n}`) } }
  catch { return { checked: true, devices: [] } }
}
const HISTORY_MS = 10 * 60_000
const TRACE_MS = 15_000
const BASELINE_READINGS = 12

export function emptyVitals(): VitalsState {
  return {
    status: 'off', source: null, startedAt: null, updatedAt: 0, guidance: 'camera off', validation: '', error: null,
    pulse: null, breathing: null, hrv: null, rawPulse: null, rawBreathing: null,
    pulseHistory: [], breathingHistory: [], breathingTrace: [], baselinePulse: null, baselineBreathing: null,
    exertion: null, recovery: null, stableReadings: 0,
  }
}

/** The decoded protobuf, as much of it as this file reads. Field names follow the SDK's generated types. */
export interface DecodedMetrics {
  breathing?: { rate?: Measured[] | null; upperTrace?: Measured[] | null } | null
  cardio?: { pulseRate?: Measured[] | null; hrv?: { rmssd?: number | null; sdnn?: number | null; confidence?: number | null; stable?: boolean | null; timestamp?: unknown }[] | null } | null
}
interface Measured { value?: number | null; stable?: boolean | null; confidence?: number | null; timestamp?: unknown }

/** SDK timestamps are microseconds since the epoch, sometimes as a Long; normalise to milliseconds. */
export function toMs(ts: unknown, fallback: number): number {
  const n = typeof ts === 'number' ? ts : typeof ts === 'object' && ts !== null && 'toNumber' in ts ? (ts as { toNumber: () => number }).toNumber() : Number(ts)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n > 1e14 ? n / 1000 : n > 1e11 ? n : fallback
}

const latest = (xs: Measured[] | null | undefined): Measured | null => (Array.isArray(xs) && xs.length ? xs[xs.length - 1] : null)
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const trim = <T extends { at: number }>(xs: T[], now: number, keepMs: number): T[] => { while (xs.length && xs[0].at < now - keepMs) xs.shift(); return xs }

/** Fold one metrics message into the state. Returns the readings that became stable this call, for logging. */
export function applyMetrics(state: VitalsState, m: DecodedMetrics, now: number, samples: number[] = []): { pulse?: Reading; breathing?: Reading; hrv?: HrvReading } {
  const out: { pulse?: Reading; breathing?: Reading; hrv?: HrvReading } = {}
  const pr = latest(m.cardio?.pulseRate)
  if (pr && Number.isFinite(Number(pr.value))) {
    const r: Reading = { value: Number(pr.value), confidence: Number(pr.confidence ?? 0), stable: pr.stable === true, at: toMs(pr.timestamp, now) }
    state.rawPulse = r.value
    if (r.stable && r.confidence >= MIN_CONFIDENCE) {
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
    if (r.stable && r.confidence >= MIN_CONFIDENCE) {
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
  if (hv && Number.isFinite(Number(hv.rmssd)) && hv.stable === true && Number(hv.confidence ?? 0) >= MIN_CONFIDENCE) {
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
  return {
    cardio: { pulseRate: [{ value: pulse, stable: tSeconds > 8, confidence: tSeconds > 8 ? 85 : 30, timestamp: us }], hrv: [{ rmssd: 42 + 8 * Math.sin(tSeconds / 25), sdnn: 55, confidence: 80, stable: tSeconds > 20, timestamp: us }] },
    breathing: { rate: [{ value: breathing, stable: tSeconds > 12, confidence: tSeconds > 12 ? 82 : 25, timestamp: us }], upperTrace: trace },
  }
}

type Sdk = {
  on: (event: string, cb: (...args: never[]) => void) => unknown
  useCamera: (o: { deviceIndex?: number; width?: number; height?: number; fps?: number }) => unknown
  start: () => unknown
  stopAsync: () => Promise<void>
  destroy: () => Promise<void>
}
type SdkModule = {
  SmartSpectraSDK: new (o: { apiKey?: string; requestedMetrics?: number[]; enableTelemetry?: boolean; enableAccumulatedOutput?: boolean }) => Sdk
  breathingMetrics: readonly number[]; cardioMetrics: readonly number[]
  decodeMetrics: (buf: Buffer) => unknown
  ValidationCode: Record<string, number>; ProcessingStatus: Record<string, number>
}

export class VitalsBridge {
  state = emptyVitals()
  /** Called for every reading that passed the stability gate, so the caller can log it. */
  onReading: ((r: { at: number; pulse: number | null; breathing: number | null; hrvRmssd: number | null; confidence: number }) => void) | null = null
  private sdk: Sdk | null = null
  private demo: ReturnType<typeof setInterval> | null = null
  private baselineSamples: number[] = []
  private apiKey: () => string
  constructor(apiKey: () => string) { this.apiKey = apiKey }

  async start(opts: { cameraIndex?: number; demo?: boolean } = {}): Promise<VitalsState> {
    await this.stop()
    this.state = { ...emptyVitals(), status: 'starting', startedAt: Date.now(), source: opts.demo ? 'demo' : 'camera', guidance: opts.demo ? 'demo source' : 'starting camera…' }
    this.baselineSamples = []
    if (opts.demo) {
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
    // otherwise leave the SDK's thread pool behind and fill the log with its start-up chatter.
    const cams = listCameras()
    if (cams.checked && cams.devices.length === 0) {
      this.state.status = 'error'
      this.state.error = 'No camera device is present on this machine (nothing under /dev/video*). Plug in a USB webcam, check the camera privacy key or BIOS setting, or use the demo.'
      this.state.guidance = this.state.error
      return this.state
    }
    let mod: SdkModule
    try { mod = await import('@smartspectra/node-sdk') as unknown as SdkModule }
    catch (e) { this.state.status = 'unavailable'; this.state.error = `SmartSpectra SDK not available: ${(e as Error).message.slice(0, 160)}`; this.state.guidance = this.state.error; return this.state }
    const validationNames = Object.fromEntries(Object.entries(mod.ValidationCode).map(([k, v]) => [v, k.replace(/^k/, '')]))
    const statusNames = Object.fromEntries(Object.entries(mod.ProcessingStatus).map(([k, v]) => [v, k.replace(/^k/, '').toLowerCase()]))
    let sdk: Sdk | null = null
    try {
      sdk = new mod.SmartSpectraSDK({ apiKey: key, requestedMetrics: [...new Set([...mod.breathingMetrics, ...mod.cardioMetrics])], enableTelemetry: false, enableAccumulatedOutput: false })
      sdk.on('processingStatus', ((status: number) => { const name = statusNames[status] ?? `status ${status}`; this.state.status = name === 'running' ? 'running' : this.state.status === 'error' ? 'error' : 'starting'; this.state.validation = name }) as never)
      sdk.on('validationStatus', ((code: number, _ts: number, hint: string) => { this.state.validation = validationNames[code] ?? `code ${code}`; this.state.guidance = hint || (this.state.validation === 'Ok' ? 'Good measurement' : this.state.validation) }) as never)
      sdk.on('metrics', ((buf: Buffer) => { try { this.ingest(mod.decodeMetrics(buf) as DecodedMetrics) } catch (e) { this.state.guidance = `could not decode metrics: ${(e as Error).message}` } }) as never)
      sdk.on('error', ((code: number, message: string, retryable: boolean) => { this.state.status = 'error'; this.state.error = `${message} (${code}${retryable ? ', retryable' : ''})`; this.state.guidance = this.state.error }) as never)
      sdk.useCamera({ deviceIndex: opts.cameraIndex ?? 0, width: 1280, height: 720, fps: 30 })
      sdk.start()
      this.sdk = sdk
    } catch (e) {
      // A failed start must not leave a live native instance behind.
      if (sdk) { try { await sdk.destroy() } catch { /* never started */ } }
      const message = (e as Error).message.slice(0, 200)
      // "input is unavailable" is what the SDK says when it cannot open any camera at all.
      this.state.status = 'error'
      this.state.error = /input is unavailable/i.test(message) ? `${message} No camera could be opened at index ${opts.cameraIndex ?? 0}: this machine may have no webcam, or another app holds it. Try the demo, or run the service on the laptop with the camera.` : message
      this.state.guidance = this.state.error
    }
    return this.state
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
    this.state = { ...this.state, status: 'off', source: null, guidance: 'camera off' }
    return this.state
  }
}
