import { useEffect, useRef, useState } from 'react'
import { useArena } from '../lib/store'
import { ArenaSocket, deviceId } from '../lib/ws'
import { CONTROLS, KeyboardController, type KbState } from '../lib/keyboard'
import type { Seat } from '../protocol'

export const KB_NICK = 'Keyboard'

/** Lets the laptop play a seat with the keyboard: claims the open seat with a second (remote) socket.
 *  The remote socket hellos with this browser's stable device id, so after a page reload the seat we already hold is
 *  re-attached automatically instead of sitting claimed-but-idle until the release timer fires. */
export function KeyboardPlayer() {
  const seats = useArena((s) => s.seats)
  const match = useArena((s) => s.match)
  const [claimed, setClaimed] = useState<string | null>(null)
  const [kb, setKb] = useState<KbState | null>(null)
  const [linked, setLinked] = useState(true)
  const sock = useRef<ArenaSocket | null>(null)
  const ctrl = useRef<KeyboardController | null>(null)
  const me = deviceId()
  const openSeat = seats.find((s) => s.status === 'open' && s.join_url)
  const mine = seats.find((s) => s.status === 'claimed' && s.device_id === me)

  const claim = (seat: Seat | undefined, token: string | null) => {
    if (!seat || sock.current) return
    const s = new ArenaSocket({ role: 'remote', token, nickname: KB_NICK, url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=remote&device=${me}` })
    s.on('session.welcome', (env) => {
      const d = env.d as { seat_id?: string | null; reason?: string | null; __open?: boolean }
      if (d.__open) return
      setClaimed(d.seat_id ?? null)
      if (!d.seat_id) { ctrl.current?.detach(); ctrl.current = null; s.close(); sock.current = null }   // released or taken: offer the button again
    })
    s.on('__open', () => setLinked(true)); s.on('__close', () => setLinked(false))
    s.connect()
    sock.current = s
    const c = new KeyboardController(s, () => (useArena.getState().match?.sport ?? null), setKb)
    c.attach(); ctrl.current = c
  }
  useEffect(() => {
    const onEnter = (e: KeyboardEvent) => { if (e.key === 'Enter' && !sock.current && openSeat?.join_url) claim(openSeat, openSeat.join_url.split('tok=')[1]) }
    window.addEventListener('keydown', onEnter)
    return () => window.removeEventListener('keydown', onEnter)
  }, [openSeat?.join_url]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mine && !sock.current) claim(mine, null) }, [mine?.seat_id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { ctrl.current?.detach(); sock.current?.close() }, [])   // only on unmount

  if (!claimed) return openSeat ? <button className="kb-claim plank" onClick={() => claim(openSeat, openSeat.join_url!.split('tok=')[1])}><span className="art">⌨️</span><span className="name">Play with keyboard</span><span /><span className="sub">or press Enter</span></button> : null
  const sport = match?.sport ?? null
  const list = sport ? CONTROLS[sport] : []
  return (
    <div className="kb-hud">
      <div className="kb-title">Keyboard · {claimed} {linked ? '' : '· relinking'}</div>
      {sport === 'bowling' && kb && <div className="kb-meters"><span>aim {kb.aim.toFixed(1)}</span><span>spin {kb.spin}</span><span className="kb-charge"><span className="kb-fill" style={{ width: `${Math.round((kb.charge ?? 0) * 100)}%` }} /></span></div>}
      {sport === 'baseball' && kb && <div className="kb-meters"><span>height {Math.round(kb.height * 100)}%</span><span>{kb.last ?? ''}</span></div>}
      {sport === 'boxing' && kb && (
        <div className="kb-meters">
          <span className={kb.guard ? 'on' : ''}>{kb.guard ? 'GUARD UP' : 'guard down'}</span>
          <span className={kb.moving ? 'on' : ''}>{kb.moving < 0 ? '◀ moving' : kb.moving > 0 ? 'moving ▶' : 'planted'}</span>
          {kb.hookCharge !== null && <span className="kb-charge hook"><span className="kb-fill" style={{ width: `${Math.round(kb.hookCharge * 100)}%` }} /></span>}
          <span>{kb.last ?? ''}</span>
        </div>
      )}
      <div className="kb-keys">{list.map((c) => <span key={c.key}><kbd>{c.key}</kbd> {c.does}</span>)}{!sport && <span>Pick a game to see controls</span>}</div>
    </div>
  )
}
