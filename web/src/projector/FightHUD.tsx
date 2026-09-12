import { useEffect, useState } from 'react'
import { useArena } from '../lib/store'

interface F { id: string; name: string; hp: number; stamina: number; guard: boolean; state: string; knockdowns: number; landed: number; thrown: number }

export function FightHUD() {
  const tick = useArena((s) => s.tick) as { fighters?: Record<string, F>; round?: number; clock_s?: number; round_s?: number; events?: { kind: string; who: string; type?: string; result?: string; ko?: boolean }[] } | null
  const match = useArena((s) => s.match)
  const [feed, setFeed] = useState<{ id: number; text: string; cls: string }[]>([])
  useEffect(() => {
    if (!tick?.events?.length) return
    const names = tick.fighters ?? {}
    const items = tick.events.map((e, i) => {
      const who = names[e.who]?.name ?? e.who
      const text = e.kind === 'punch' ? `${who} ${e.type} ${e.result === 'hit' ? 'lands!' : e.result}` : e.kind === 'knockdown' ? (e.ko ? `${who} is OUT!` : `${who} goes down!`) : e.kind === 'parry' ? (e.result === 'success' ? `${who} parries!` : `${who} whiffs the parry`) : e.kind === 'telegraph' ? `${who} winds up a ${e.type}` : e.kind === 'gassed' ? `${who} is gassed` : e.kind
      return { id: Date.now() + i, text, cls: e.kind === 'knockdown' ? 'big' : e.result === 'hit' || e.result === 'success' ? 'hit' : '' }
    })
    setFeed((f) => [...f, ...items].slice(-4))
    const id = setTimeout(() => setFeed((f) => f.slice(items.length)), 2500)
    return () => clearTimeout(id)
  }, [tick])
  if (!match || match.sport !== 'boxing' || !tick?.fighters) return null
  const fs = Object.values(tick.fighters)
  const [a, b] = fs
  const secs = Math.max(0, Math.ceil((tick.round_s ?? 30) - (tick.clock_s ?? 0)))
  const bar = (f: F, side: 'l' | 'r') => (
    <div className={`fhud-side ${side}`}>
      <div className="fhud-name">{f.name} <span className={`fhud-state ${f.state}`}>{f.state !== 'idle' ? f.state : ''}</span></div>
      <div className="fhud-bar hp"><div className="fhud-fill" style={{ width: `${f.hp}%` }} /></div>
      <div className="fhud-bar st"><div className="fhud-fill" style={{ width: `${f.stamina}%` }} /></div>
      <div className="fhud-meta">{f.landed}/{f.thrown} landed · KD {f.knockdowns}</div>
    </div>
  )
  return (
    <div className="fhud">
      {a && bar(a, 'l')}
      <div className="fhud-mid"><div className="fhud-round">R{tick.round}</div><div className="fhud-clock">{secs}</div></div>
      {b && bar(b, 'r')}
      <div className="fhud-feed">{feed.map((x) => <div key={x.id} className={x.cls}>{x.text}</div>)}</div>
    </div>
  )
}
