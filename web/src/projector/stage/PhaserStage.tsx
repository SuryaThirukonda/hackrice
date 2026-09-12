import { useEffect, useRef } from 'react'
import { createGame, type GameHandle } from '../../game'

/** Mounts the Phaser game (menu + sports) inside the projector's stage area. The game opens its own arena socket (role=game). */
export function PhaserStage() {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<GameHandle | null>(null)
  useEffect(() => {
    const el = host.current
    if (!el || handle.current) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    handle.current = createGame(el, `${proto}://${location.host}/ws?role=game&device=phaser-${Math.random().toString(36).slice(2, 8)}`)
    ;(window as unknown as { __game?: GameHandle }).__game = handle.current   // debug handle for the in-app browser
    return () => { handle.current?.destroy(); handle.current = null }
  }, [])
  return <div ref={host} className="phaser-host" />
}
