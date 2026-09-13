import { describe, expect, it } from 'vitest'
import { KeyState } from '../../input/keys'
import { BOXING_KEYS, boxingCommand, boxingCommandP2, playerOneBindings } from './keymap'

describe('two-player boxing on one keyboard', () => {
  it('player 2 moves on the arrows and punches on U, and player 1 no longer reacts to those keys', () => {
    const k = new KeyState()
    k.onDown('ArrowUp'); k.onDown('ArrowLeft'); k.onDown('KeyU')
    const p2 = boxingCommandP2(k)
    expect(p2.forward).toBe(1); expect(p2.dodge).toBe('swayL'); expect(p2.punch).toBe('jab')
    const p1 = boxingCommand(k, playerOneBindings(BOXING_KEYS))
    expect(p1.forward).toBe(0); expect(p1.strafe).toBe(0); expect(p1.punch).toBeNull()
    // player 1's own keys still work alongside
    k.endFrame(); k.onDown('KeyA'); k.onDown('KeyJ')
    const p1b = boxingCommand(k, playerOneBindings(BOXING_KEYS))
    expect(p1b.strafe).toBe(-1); expect(p1b.punch).toBe('jab')
  })

  it('drops every player-2 key from player 1, including one rebound in Settings, and keeps the rest', () => {
    const b = playerOneBindings({ ...BOXING_KEYS, jab: ['KeyJ', 'KeyU'] })
    expect(b.jab).toEqual(['KeyJ'])
    expect(b.in).toEqual([]); expect(b.out).toEqual([])
    expect(b.left).toEqual(['KeyA']); expect(b.right).toEqual(['KeyD'])
    expect(b.block).toEqual(['Space', 'KeyS'])
    expect(BOXING_KEYS.left).toEqual(['KeyA', 'ArrowLeft']) // the one-player table itself is untouched
  })
})
