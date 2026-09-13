import { describe, expect, it } from 'vitest'
import { applyFace, applyMetrics, BASELINE_READINGS, CORE_WELLNESS_METRICS, demoMetrics, emptyVitals, FACE_WELLNESS_METRICS, listCameras, REQUESTED_WELLNESS_METRICS, toMs, VitalsBridge, type VitalsState } from './vitals'

const us = (ms: number): number => ms * 1000
const pulse = (value: number, at: number, stable = true, confidence = 90) => ({ cardio: { pulseRate: [{ value, stable, confidence, timestamp: us(at) }] } })

describe('vitals reducer', () => {
  it('requests only the wellness MVP metrics, never arterial-pressure or HRV models', () => {
    expect(CORE_WELLNESS_METRICS).toEqual([0, 2, 15])
    expect(FACE_WELLNESS_METRICS).toEqual([11, 12, 13, 14])
    expect(REQUESTED_WELLNESS_METRICS).toEqual([0, 2, 15, 11, 12, 13, 14])
    for (const face of FACE_WELLNESS_METRICS) expect(REQUESTED_WELLNESS_METRICS).toContain(face)
    expect(REQUESTED_WELLNESS_METRICS).not.toContain(16)
    expect(REQUESTED_WELLNESS_METRICS).not.toContain(17)
  })
  it('only shows a pulse the SDK calls stable and confident, but always shows the raw sensor value', () => {
    const s = emptyVitals()
    applyMetrics(s, pulse(71, 1_700_000_000_000, false, 90), 1_700_000_000_000)
    expect(s.pulse).toBeNull(); expect(s.rawPulse).toBe(71)
    applyMetrics(s, pulse(72, 1_700_000_001_000, true, 39), 1_700_000_001_000)
    expect(s.pulse).toBeNull()
    const got = applyMetrics(s, pulse(73, 1_700_000_002_000), 1_700_000_002_000)
    expect(s.pulse?.value).toBe(73); expect(got.pulse?.value).toBe(73); expect(s.pulseHistory).toHaveLength(1)
  })
  it('sets a resting baseline from a short window of usable readings, and no earlier', () => {
    expect(BASELINE_READINGS).toBe(2)
    const s = emptyVitals(); const samples: number[] = []; const t0 = 1_700_000_000_000
    applyMetrics(s, pulse(66, t0), t0, samples)
    expect(s.baselinePulse).toBeNull() // one usable reading is not a baseline
    applyMetrics(s, pulse(68, t0 + 1000), t0 + 1000, samples)
    expect(s.baselinePulse).toBe(67)
  })
  it('reads exertion and recovery against the baseline', () => {
    const s = emptyVitals(); const samples: number[] = []; const t0 = 1_700_000_000_000
    for (let i = 0; i < 12; i++) applyMetrics(s, pulse(66 + (i % 3), t0 + i * 1000), t0 + i * 1000, samples)
    expect(s.baselinePulse).toBe(66.5)
    applyMetrics(s, pulse(110, t0 + 13_000), t0 + 13_000, samples) // supported range ceiling
    expect(s.exertion).toBeCloseTo((43.5 / 50) * .65 + (43.5 / 50) * .35, 6)
    applyMetrics(s, pulse(92, t0 + 14_000), t0 + 14_000, samples)
    expect(s.exertion).toBeCloseTo(0.51 * 0.65 + 0.51 * 0.35, 6)
    // a minute later, back near rest: recovery is the drop since a minute ago
    applyMetrics(s, pulse(70, t0 + 75_000), t0 + 75_000, samples)
    expect(s.recovery).toBeGreaterThan(15)
  })
  it('reads face presence and expressions when the face metrics are on, and stays quiet when they are not', () => {
    const s = emptyVitals(); const now = 1_700_000_000_000
    expect(applyFace(s, { cardio: {} }, now)).toBe(false)
    expect(s.facePresent).toBeUndefined(); expect(s.faceUpdatedAt).toBeUndefined()
    expect(applyFace(s, {
      face: {
        landmarks: [{ value: [{ x: 0.5, y: 0.4 }], stable: true, timestamp: us(now) }],
        blinking: [{ detected: true, stable: true, timestamp: us(now) }],
        talking: [{ detected: false, stable: true, timestamp: us(now) }],
        expression: [{ stable: true, timestamp: us(now), scores: [{ type: 6, confidence: 30 }, { type: 5, confidence: 62.5 }] }],
      },
    }, now)).toBe(true)
    expect(s.facePresent).toBe(true); expect(s.validFace).toBe(true)
    expect(s.blinking).toBe(true); expect(s.talking).toBe(false)
    expect(s.dominantExpression).toBe('happy')
    expect(s.expressionProbs).toEqual({ happy: 0.625, neutral: 0.3 })
    expect(s.faceUpdatedAt).toBe(now)
    // an empty landmark set is a face that has left the frame, not a missing metric
    applyFace(s, { face: { landmarks: [{ value: [], stable: false, timestamp: us(now) }] } }, now + 1000)
    expect(s.facePresent).toBe(false); expect(s.validFace).toBe(false)
  })
  it('ignores expression types it does not recognise instead of inventing a label', () => {
    const s = emptyVitals(); const now = 1_700_000_000_000
    applyFace(s, { face: { expression: [{ stable: true, timestamp: us(now), scores: [{ type: 99, confidence: 90 }, { type: 'SAD', confidence: 40 }] }] } }, now)
    expect(s.dominantExpression).toBe('sad')
    expect(s.expressionProbs).toEqual({ sad: 0.4 })
  })
  it('keeps a bounded breathing waveform and reads breathing rate and HRV with the same gates', () => {
    const s = emptyVitals(); const t0 = 1_700_000_000_000
    for (let t = 0; t < 40; t++) applyMetrics(s, demoMetrics(t, t0 + t * 1000, () => 0.5), t0 + t * 1000)
    expect(s.breathing?.value).toBeGreaterThan(10)
    expect(s.hrv?.rmssd).toBeGreaterThan(30)
    expect(s.breathingTrace.length).toBeGreaterThan(50)
    expect(s.breathingTrace.length).toBeLessThanOrEqual(160) // fifteen seconds at ten a second
    expect(s.breathingTrace[0].at).toBeGreaterThanOrEqual(t0 + 39_000 - 15_000)
  })
  it('normalises SDK timestamps whether microseconds, milliseconds or garbage', () => {
    expect(toMs(1_700_000_000_000_000, 5)).toBe(1_700_000_000_000)
    expect(toMs(1_700_000_000_000, 5)).toBe(1_700_000_000_000)
    expect(toMs('nope', 5)).toBe(5); expect(toMs(0, 5)).toBe(5)
    expect(toMs({ toNumber: () => 1_700_000_000_000_000 }, 5)).toBe(1_700_000_000_000)
  })
})

describe('VitalsBridge', () => {
  it('runs the demo source without a camera and logs stable readings', async () => {
    const b = new VitalsBridge(() => '')
    const logged: number[] = []
    b.onReading = (r) => { if (r.pulse !== null) logged.push(r.pulse) }
    await b.start({ demo: true })
    expect(b.state.status).toBe('starting'); expect(b.state.source).toBe('demo')
    await new Promise((r) => setTimeout(r, 1200))
    expect(b.state.status).toBe('running'); expect(b.state.rawPulse).toBeGreaterThan(50)
    expect(b.state.facePresent).toBe(true); expect(b.state.dominantExpression).toBeTruthy()
    await b.stop()
    expect(b.state.status).toBe('off')
  })
  it('takes browser frames only once a custom-input reading has been started', async () => {
    const b = new VitalsBridge(() => '')
    const frame = Buffer.alloc(480 * 270 * 3)
    expect(b.pushFrame(frame, 480, 270, 1440, 1_000_000)).toBe(false)
    const s = await b.start({ input: 'custom' })
    // no key: the browser's frames are still refused, and never reach a native instance
    expect(s.source).toBe('custom'); expect(s.status).toBe('error')
    expect(b.pushFrame(frame, 480, 270, 1440, 1_000_000)).toBe(false)
    expect(b.framesAccepted).toBe(0)
    await b.stop()
  })
  it('sends browser frames in order and gives up on a failed session', () => {
    const b = new VitalsBridge(() => 'a-key')
    const sent: { stride: number; ts: number }[] = []
    const inject = b as unknown as { sdk: unknown; state: VitalsState }
    inject.sdk = { sendFrame: (_b: Uint8Array, _w: number, _h: number, stride: number, _f: number, ts: number) => { sent.push({ stride, ts }); return true } }
    inject.state = { ...emptyVitals(), status: 'running', source: 'custom' }
    const frame = new Uint8Array(12)
    expect(b.pushFrame(frame, 480, 270, 1440, 1000)).toBe(true)
    expect(b.pushFrame(frame, 480, 270, 1440, 1000)).toBe(false) // the SDK fails a session on a repeated timestamp
    expect(b.pushFrame(frame, 480, 270, 1440, 2000)).toBe(true)
    expect(b.framesAccepted).toBe(2)
    inject.state.status = 'error'
    expect(b.pushFrame(frame, 480, 270, 1440, 3000)).toBe(false)
    expect(sent).toEqual([{ stride: 1440, ts: 1000 }, { stride: 1440, ts: 2000 }])
  })
  it('still runs the demo when the caller asks for custom input in mock mode', async () => {
    const b = new VitalsBridge(() => '', 'mock')
    const s = await b.start({ input: 'custom' })
    expect(s.source).toBe('demo')
    await b.stop()
  })
  it('refuses a camera start without a key, without touching the SDK', async () => {
    const b = new VitalsBridge(() => '')
    const s = await b.start({})
    expect(s.status).toBe('error'); expect(s.error).toContain('PRESSAGE_KEY')
    await b.stop()
  })
  it('lists what the OS exposes, and on a machine with no device refuses to start the native runtime', async () => {
    const cams = listCameras()
    expect(typeof cams.checked).toBe('boolean')
    if (cams.checked && cams.devices.length === 0) {
      const b = new VitalsBridge(() => 'a-key')
      const s = await b.start({})
      expect(s.status).toBe('error'); expect(s.error).toContain('No camera device')
      await b.stop()
    }
  })
})
