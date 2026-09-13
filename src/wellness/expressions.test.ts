import { describe, expect, it } from 'vitest'
import { ExpressionAggregator } from './expressions'
import { placeOverlay, boxingOccupied } from '../ui/SafeArea'
import { consumerValidation } from '../camera/validationCopy'

describe('expression aggregation', () => {
  it('ignores missing frames and only summarizes with enough coverage', () => {
    const a = new ExpressionAggregator()
    for (let i = 0; i < 10; i++) a.sample(1, false, null)
    expect(a.summary().dominant).toBeNull()
    for (let i = 0; i < 20; i++) a.sample(1, true, { happiness: 0.6, neutral: 0.4 })
    const s = a.summary()
    expect(s.coverage).toBeGreaterThan(0.5)
    expect(s.dominant).toBe('happiness')
    expect(s.distribution.happiness).toBeGreaterThan(0.5)
  })
})

describe('safe area placement', () => {
  it('places Tempo Sense outside boxing HUD bounds', () => {
    const occ = boxingOccupied(1280, 720)
    const r = placeOverlay(1280, 720, occ, 168, 92)
    for (const b of Object.values(occ)) {
      const hit = !(r.x + r.w < b.x || b.x + b.w < r.x || r.y + r.h < b.y || b.y + b.h < r.y)
      expect(hit).toBe(false)
    }
  })
})

describe('ready-up validation copy', () => {
  it('maps Presage codes to consumer guidance', () => {
    expect(consumerValidation('NoFaceFound', '')).toBe('Move into frame')
    expect(consumerValidation('Ok', 'Good measurement')).toBe('Looking good')
  })
})
