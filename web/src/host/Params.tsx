import { useEffect, useState } from 'react'

/** Generic config editor: numeric leaves under a chosen section (or one tier's params), each bound to a dotted config path
 *  that `host.set_param {path, value}` understands (list indexes as numbers: tiers.bowling.tiers.0.params.lane_sigma). */
type Json = Record<string, unknown>
type Leaf = { path: string; label: string; value: number | boolean }

export const QUICK: { path: string; label: string; min: number; max: number; step: number }[] = [
  { path: 'motion.swing.omega_arm_dps', label: 'swing arm ω (°/s)', min: 30, max: 300, step: 5 },
  { path: 'motion.swing.a_sat_ms2', label: 'swing a_sat (m/s²)', min: 15, max: 60, step: 1 },
  { path: 'motion.punch.a_fwd_ms2', label: 'punch a_fwd (m/s²)', min: 4, max: 30, step: 0.5 },
  { path: 'market.windows.betting_s', label: 'betting window (s)', min: 0.2, max: 30, step: 0.2 },
  { path: 'market.windows.between_s', label: 'between turns (s)', min: 0.2, max: 10, step: 0.2 },
]

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) ? cur[Number(k)] : (cur as Json)[k]
  }
  return cur
}

export function leaves(obj: unknown, prefix: string, opts: { arrays?: boolean; depth?: number } = {}): Leaf[] {
  const out: Leaf[] = []
  const walk = (v: unknown, p: string, depth: number) => {
    if (typeof v === 'number' || typeof v === 'boolean') { out.push({ path: p, label: p.slice(prefix.length + 1) || p, value: v }); return }
    if (v === null || typeof v !== 'object' || depth > (opts.depth ?? 6)) return
    if (Array.isArray(v)) { if (opts.arrays) v.forEach((x, i) => walk(x, `${p}.${i}`, depth + 1)); return }
    for (const [k, x] of Object.entries(v as Json)) walk(x, p ? `${p}.${k}` : k, depth + 1)
  }
  walk(obj, prefix, 0)
  return out
}

function NumberField({ leaf, onCommit }: { leaf: Leaf; onCommit: (path: string, value: number | boolean) => void }) {
  const [text, setText] = useState(String(leaf.value))
  useEffect(() => { setText(String(leaf.value)) }, [leaf.value])
  if (typeof leaf.value === 'boolean') {
    return <label className="param"><span className="pname" title={leaf.path}>{leaf.label}</span><button className={`pill ${leaf.value ? 'on' : ''}`} onClick={() => onCommit(leaf.path, !leaf.value)}>{leaf.value ? 'on' : 'off'}</button></label>
  }
  const commit = () => { const n = Number(text); if (Number.isFinite(n) && n !== leaf.value) onCommit(leaf.path, n) }
  return (
    <label className="param">
      <span className="pname" title={leaf.path}>{leaf.label}</span>
      <input type="number" step="any" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
    </label>
  )
}

export function Params({ config, onSet }: { config: Json | null; onSet: (path: string, value: number | boolean) => void }) {
  const [section, setSection] = useState('motion')
  const [sport, setSport] = useState('bowling')
  const [tierIx, setTierIx] = useState(0)
  const [filter, setFilter] = useState('')
  if (!config) return <div className="sub">Waiting for host.config…</div>
  const sections = Object.keys(config).sort()
  const tiers = (getPath(config, `tiers.${sport}.tiers`) as Json[] | undefined) ?? []
  let base = section
  if (section === 'tiers') base = `tiers.${sport}.tiers.${Math.min(tierIx, Math.max(0, tiers.length - 1))}.params`
  else if (section === 'game') base = `game.${sport}`
  const items = leaves(getPath(config, base), base, { arrays: section === 'tiers' }).filter((l) => !filter || l.path.includes(filter))
  return (
    <div>
      <div className="row">
        <span className="sub">Section</span>
        {sections.map((s) => <button key={s} className={`pill ${s === section ? 'on' : ''}`} onClick={() => setSection(s)}>{s}</button>)}
        {(section === 'tiers' || section === 'game') && <>
          <span className="sub">Sport</span>
          {['bowling', 'baseball', 'boxing'].map((s) => <button key={s} className={`pill ${s === sport ? 'on' : ''}`} onClick={() => { setSport(s); setTierIx(0) }}>{s}</button>)}
        </>}
        {section === 'tiers' && <>
          <span className="sub">Tier</span>
          {tiers.map((t, i) => <button key={String(t.id)} className={`pill ${i === tierIx ? 'on' : ''}`} onClick={() => setTierIx(i)}>{String(t.name ?? t.id)}</button>)}
        </>}
        <input placeholder="filter paths" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ minWidth: 140, flex: 0 }} />
      </div>
      <div className="crumb">{base.split('.').map((k, i) => <span key={i}>{i > 0 && <b> › </b>}{k}</span>)}</div>
      <div className="params">
        {items.map((l) => <NumberField key={l.path} leaf={l} onCommit={onSet} />)}
        {!items.length && <div className="sub">No numeric leaves here.</div>}
      </div>
    </div>
  )
}
