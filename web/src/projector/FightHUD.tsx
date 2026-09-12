import { useEffect, useState } from 'react'
import { useArena } from '../lib/store'
import { KB_NICK } from './KeyboardPlayer'

interface F {
  id: string; name: string; hp: number; stamina: number; guard: boolean; state: string; knockdowns: number; landed: number; thrown: number
  x?: number; facing?: number; action?: string | null; phase?: string | null; progress?: number; fatigue?: number; dodge_ready?: boolean; open?: boolean; moving?: number
}
interface Ev { kind: string; who: string; type?: string; result?: string; ko?: boolean; action?: string; dir?: number; ms?: number }
interface BoxTick { fighters?: Record<string, F>; round?: number; clock_s?: number; round_s?: number; events?: Ev[]; distance?: number; reach?: { jab: number; hook: number } }

const STATE_LABEL: Record<string, string> = { windup: 'winding up', active: 'strike', recover: 'recover', block: 'guard', dodge: 'dodge', parry: 'parry', stagger: 'staggered', stunned: 'stunned', down: 'DOWN' }

function line(e: Ev, who: string): { text: string; cls: string } | null {
  switch (e.kind) {
    case 'punch': {
      const r = e.result
      const text = r === 'hit' ? `${who} lands a ${e.type}!` : r === 'blocked' ? `${who}'s ${e.type} is blocked` : r === 'parried' ? `${who}'s ${e.type} is PARRIED` : r === 'dodged' ? `${who}'s ${e.type} is dodged` : `${who}'s ${e.type} misses`
      return { text, cls: r === 'hit' ? 'hit' : r === 'parried' ? 'big' : '' }
    }
    case 'knockdown': return { text: e.ko ? `${who} is OUT!` : `${who} goes down!`, cls: 'big' }
    case 'parry': return e.result === 'success' ? { text: `${who} parries!`, cls: 'hit' } : { text: `${who} whiffs the parry`, cls: '' }
    case 'windup': return { text: `${who} winds up a ${e.type}`, cls: 'dim' }
    case 'gassed': return { text: `${who} is gassed`, cls: '' }
    case 'bell': return { text: 'DING DING', cls: 'big' }
    case 'react': return { text: `${who} reads it: ${e.action}`, cls: 'dim' }
    case 'rhythm': return { text: `${who} guards on the beat`, cls: 'dim' }
    default: return null
  }
}

export function FightHUD() {
  const tick = useArena((s) => s.tick) as BoxTick | null
  const match = useArena((s) => s.match)
  const seats = useArena((s) => s.seats)
  const [feed, setFeed] = useState<{ id: number; text: string; cls: string }[]>([])
  useEffect(() => {
    if (!tick?.events?.length) return
    const names = tick.fighters ?? {}
    const items = tick.events.map((e, i) => ({ e, i, l: line(e, names[e.who]?.name ?? e.who) })).filter((x) => x.l).map((x) => ({ id: Date.now() * 10 + x.i, text: x.l!.text, cls: x.l!.cls }))
    if (!items.length) return
    setFeed((f) => [...f, ...items].slice(-4))
    const id = setTimeout(() => setFeed((f) => f.slice(items.length)), 2500)
    return () => clearTimeout(id)
  }, [tick])
  if (!match || match.sport !== 'boxing' || !tick?.fighters) return null
  const fs = Object.values(tick.fighters)
  const [a, b] = fs
  const secs = Math.max(0, Math.ceil((tick.round_s ?? 30) - (tick.clock_s ?? 0)))
  const dist = tick.distance ?? 1
  const reach = tick.reach ?? { jab: 0.4, hook: 0.5 }
  const range = dist <= reach.jab ? 'in range' : dist <= reach.hook ? 'hook range' : 'out of reach'
  const keyboardSeat = !match.card && seats.some((s) => s.status === 'claimed' && s.nickname === KB_NICK)
  const bar = (f: F, side: 'l' | 'r') => {
    const fatigue = f.fatigue ?? 0
    const st = f.state
    const chip = STATE_LABEL[st]
    const prog = Math.round((f.progress ?? 0) * 100)
    return (
      <div className={`fhud-side ${side}`}>
        <div className="fhud-name">{f.name} {chip && <span className={`fhud-state ${st}`}>{f.action && (st === 'windup' || st === 'active') ? `${f.action} · ${chip}` : chip}</span>}</div>
        <div className="fhud-bar hp"><div className="fhud-fill" style={{ width: `${f.hp}%` }} /></div>
        <div className={`fhud-bar st ${fatigue > 0.5 ? 'tired' : ''}`}><div className="fhud-fill" style={{ width: `${f.stamina}%` }} /></div>
        {(st === 'windup' || st === 'active' || st === 'recover') && <div className="fhud-bar act"><div className={`fhud-fill ${st}`} style={{ width: `${prog}%` }} /></div>}
        <div className="fhud-meta">
          <span className={`fhud-guard ${f.guard ? 'on' : ''}`}>{f.open ? 'OPEN' : f.guard ? 'GUARD' : 'no guard'}</span>
          <span>{f.landed}/{f.thrown} landed · KD {f.knockdowns}</span>
          {fatigue > 0.5 && <span className="fhud-tired">tired</span>}
          {f.dodge_ready === false && <span className="fhud-dim">dodge cooling</span>}
        </div>
      </div>
    )
  }
  return (
    <div className="fhud">
      {a && bar(a, 'l')}
      <div className="fhud-mid"><div className="fhud-round">R{tick.round}</div><div className="fhud-clock">{secs}</div><div className={`fhud-range ${dist <= reach.jab ? 'in' : ''}`}>{range}</div></div>
      {b && bar(b, 'r')}
      <div className="fhud-feed">{feed.map((x) => <div key={x.id} className={x.cls}>{x.text}</div>)}</div>
      {keyboardSeat && <div className="fhud-hint"><kbd>J</kbd> jab <kbd>K</kbd> hook (hold) <kbd>Space</kbd> guard <kbd>P</kbd> parry <kbd>A</kbd><kbd>D</kbd> move <kbd>Q</kbd><kbd>E</kbd> dodge</div>}
    </div>
  )
}
