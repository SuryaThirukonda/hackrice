import { describe, expect, it } from 'vitest'
import { ScriptExecutor } from './executor'
import { HZ } from '../games/boxing/sim/constants'
import { INTERVAL_MS } from '../../server/tools'

describe('script executor', () => {
  it('fires one-shots at their tick and holds movement/block until changed', () => {
    const x = new ScriptExecutor()
    x.load({ steps: [{ at_ms: 0, do: 'in' }, { at_ms: 500, do: 'cross' }, { at_ms: 600, do: 'block_on' }, { at_ms: 1200, do: 'idle' }] }, 100)
    expect(x.command(100)).toMatchObject({ forward: 1, punch: null, block: false })
    expect(x.command(100 + Math.round(0.5 * HZ) - 1).punch).toBeNull()
    expect(x.command(100 + Math.round(0.5 * HZ)).punch).toBe('cross')
    expect(x.command(100 + Math.round(0.5 * HZ) + 1).punch).toBeNull()
    expect(x.command(100 + Math.round(0.7 * HZ))).toMatchObject({ block: true, forward: 1 })
    expect(x.command(100 + Math.round(1.3 * HZ))).toMatchObject({ block: false, forward: 0 })
  })
  it('guards while a script is late, and resumes when a new script arrives', () => {
    const x = new ScriptExecutor()
    expect(x.isLate(0)).toBe(true)
    expect(x.command(0)).toMatchObject({ block: true, forward: 0 })
    x.load({ steps: [{ at_ms: 0, do: 'jab' }] }, 10)
    expect(x.command(10).punch).toBe('jab')
    const span = Math.round((INTERVAL_MS / 1000) * HZ)
    expect(x.isLate(10 + span - 1)).toBe(false)
    expect(x.isLate(10 + span + 1)).toBe(true)
    expect(x.command(10 + span + 12).block).toBe(true)
  })
})
