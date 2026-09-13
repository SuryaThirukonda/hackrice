import { describe, expect, it } from 'vitest'
import { applyMetrics, demoMetrics, emptyVitals, toMs, VitalsBridge } from './vitals'

const us = (ms: number): number => ms * 1000
const pulse = (value: number, at: number, stable = true, confidence = 90) => ({ cardio: { pulseRate: [{ value, stable, confidence, timestamp: us(at) }] } })

describe('vitals reducer', () => {
  it('only shows a pulse the SDK calls stable and confident, but always shows the raw sensor value', () => {
    const s = emptyVitals()
    applyMetrics(s, pulse(71, 1_700_000_000_000, false, 90), 1_700_000_000_000)
    expect(s.pulse).toBeNull(); expect(s.rawPulse).toBe(71)
    applyMetrics(s, pulse(72, 1_700_000_001_000, true, 40), 1_700_000_001_000)
    expect(s.pulse).toBeNull()
    const got = applyMetrics(s, pulse(73, 1_700_000_002_000), 1_700_000_002_000)
    expect(s.pulse?.value).toBe(73); expect(got.pulse?.value).toBe(73); expect(s.pulseHistory).toHaveLength(1)
  })
  it('sets a resting baseline from the first stable readings and reads exertion and recovery against it', () => {
    const s = emptyVitals(); const samples: number[] = []; const t0 = 1_700_000_000_000
    for (let i = 0; i < 12; i++) applyMetrics(s, pulse(66 + (i % 3), t0 + i * 1000), t0 + i * 1000, samples)
    expect(s.baselinePulse).toBe(67)
    applyMetrics(s, pulse(117, t0 + 13_000), t0 + 13_000, samples) // 50 over baseline: full load
    expect(s.exertion).toBeCloseTo(1, 6)
    applyMetrics(s, pulse(92, t0 + 14_000), t0 + 14_000, samples)
    expect(s.exertion).toBeCloseTo(0.5 * 0.65 + 0.5 * 0.35, 6)
    // a minute later, back near rest: recovery is the drop since a minute ago
    applyMetrics(s, pulse(70, t0 + 75_000), t0 + 75_000, samples)
    expect(s.recovery).toBeGreaterThan(15)
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
    await b.stop()
    expect(b.state.status).toBe('off')
  })
  it('refuses a camera start without a key, without touching the SDK', async () => {
    const b = new VitalsBridge(() => '')
    const s = await b.start({})
    expect(s.status).toBe('error'); expect(s.error).toContain('PRESSAGE_KEY')
    await b.stop()
  })
})
