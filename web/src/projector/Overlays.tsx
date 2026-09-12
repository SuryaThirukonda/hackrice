import { useEffect, useState } from 'react'
import { useArena } from '../lib/store'

export function LeaderboardStrip() {
  const rows = useArena((s) => s.leaderboard)
  return (
    <div className="tile strip">
      <span className="strip-title">Rail</span>
      {rows.length === 0 && <span className="strip-empty">Scan to bet and get 500 chips</span>}
      {rows.slice(0, 6).map((r, i) => <span key={r.device_id} className="strip-row"><b>{i + 1}</b> {r.nickname} <span className="chips">{r.chips}</span>{r.titles.map((t) => <span key={t} className="chip">{t}</span>)}</span>)}
    </div>
  )
}

export function Subtitle() {
  const decisions = useArena((s) => s.decisions)
  const voice = useArena((s) => s.voice)
  const match = useArena((s) => s.match)
  const [line, setLine] = useState<{ who: string; text: string } | null>(null)
  useEffect(() => {
    const last = decisions[decisions.length - 1] as { line?: string; agent_id?: string } | undefined
    if (last?.line) setLine({ who: match?.opponent.name ?? 'The House', text: last.line })
  }, [decisions, match])
  useEffect(() => { if (voice?.text) setLine({ who: voice.speaker === 'opponent' ? (match?.opponent.name ?? 'The House') : voice.speaker.replace('_', ' '), text: voice.text }) }, [voice, match])
  useEffect(() => { if (!line) return; const id = setTimeout(() => setLine(null), 6000); return () => clearTimeout(id) }, [line])
  if (!line) return null
  return <div className="subtitle"><b>{line.who}:</b> {line.text}</div>
}





export function StudyingMeter() {
  const studying = useArena((s) => s.studying)
  const match = useArena((s) => s.match)
  if (!match || match.phase === 'ended') return null
  const st = studying[`house:${match.sport}`] as { level?: number; n?: number } | undefined
  const level = st?.level ?? 0
  return (
    <div className="studying">
      <div className="studying-label">{match.opponent.name} is studying you</div>
      <div className="studying-bar"><div className="studying-fill" style={{ width: `${Math.round(level * 100)}%` }} /></div>
    </div>
  )
}


// ---- M10 market overlays: sponsor warn/applied, crate auction, card vote, bump pairing ------------------------------

interface MoveInfo { id: string; label: string; target: 'house' | 'human'; sport?: string | null }
interface PairingInfo { id: string; a: string; b: string; label: string }

function useNow(active: boolean, ms = 100) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!active) return; setNow(Date.now()); const id = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(id) }, [active, ms])
  return now
}

function targetName(target: string | undefined, match: { opponent: { name: string }; players?: Record<string, string> } | null): string {
  if (target === 'house') return match?.opponent.name ?? 'the House'
  return match?.players ? Object.values(match.players)[0] : 'the player'
}

/** "X bought Y for the House" with a countdown until it lands, then a short "applied" flash. */
export function SponsorBanner() {
  const sponsor = useArena((s) => s.sponsor) as { kind?: string; buyer?: string; label?: string; target?: string; applies_at_ts?: number } | null
  const match = useArena((s) => s.match)
  const socket = useArena((s) => s.socket)
  const [show, setShow] = useState<typeof sponsor>(null)
  useEffect(() => {
    if (!sponsor || (sponsor.kind !== 'sponsor.warn' && sponsor.kind !== 'sponsor.applied')) return
    setShow(sponsor)
    const id = window.setTimeout(() => setShow(null), sponsor.kind === 'sponsor.warn' ? 8000 : 2600)
    return () => window.clearTimeout(id)
  }, [sponsor])
  const now = useNow(show?.kind === 'sponsor.warn')
  if (!show) return null
  const who = targetName(show.target, match)
  const secs = Math.max(0, ((show.applies_at_ts ?? 0) - (now + (socket?.offsetMs ?? 0))) / 1000)
  if (show.kind === 'sponsor.warn') return <div className={`mk-banner warn ${show.target}`}><span className="mk-tag">Sponsor</span><span>{show.buyer} bought <b>{show.label}</b> for {who}</span><span className="mk-count">{secs.toFixed(1)}s</span></div>
  return <div className={`mk-banner applied ${show.target}`}><span className="mk-tag">Live</span><span><b>{show.label}</b> is in play for {who}, courtesy of {show.buyer}</span></div>
}

/** Crate auction: open with a countdown and sealed-bid count; then the winner. */
export function CrateBanner() {
  const crate = useArena((s) => s.crate) as { move: MoveInfo; closes_ts: number; n_bids: number } | null
  const result = useArena((s) => s.crateResult) as { winner: string | null; amount?: number; move?: MoveInfo; reason?: string; n_bids?: number } | null
  const match = useArena((s) => s.match)
  const socket = useArena((s) => s.socket)
  const [shown, setShown] = useState<typeof result>(null)
  useEffect(() => { if (!result) return; setShown(result); const id = window.setTimeout(() => setShown(null), 3500); return () => window.clearTimeout(id) }, [result])
  const now = useNow(Boolean(crate))
  if (crate) {
    const secs = Math.max(0, Math.ceil((crate.closes_ts - (now + (socket?.offsetMs ?? 0))) / 1000))
    return <div className="mk-banner crate"><span className="mk-tag">Crate</span><span><b>{crate.move.label}</b> for {targetName(crate.move.target, match)} · sealed bids on the rail</span><span className="chip">{crate.n_bids} bid{crate.n_bids === 1 ? '' : 's'}</span><span className="mk-count">{secs}s</span></div>
  }
  if (shown) return <div className="mk-banner crate done"><span className="mk-tag">Crate</span><span>{shown.winner ? <><b>{shown.winner}</b> wins {shown.move?.label ?? 'the crate'} for {shown.amount} chips</> : `Crate closed: ${shown.reason ?? 'no bids'}`}</span></div>
  return null
}

/** Bump pairing: "Bump phones now" with a countdown, then the result. */
export function PairingPrompt() {
  const pairing = useArena((s) => s.pairing) as { kind: string; text?: string; until_ts?: number; ok?: boolean; reason?: string; amount?: number; a?: string; b?: string; seat_id?: string } | null
  const socket = useArena((s) => s.socket)
  const [shown, setShown] = useState<typeof pairing>(null)
  useEffect(() => {
    if (!pairing) return
    setShown(pairing)
    const ms = pairing.kind === 'pair.prompt' ? Math.max(500, (pairing.until_ts ?? 0) - (socket?.serverNow() ?? Date.now())) : 3200
    const id = window.setTimeout(() => setShown(null), ms)
    return () => window.clearTimeout(id)
  }, [pairing, socket])
  const now = useNow(shown?.kind === 'pair.prompt')
  if (!shown) return null
  if (shown.kind === 'pair.prompt') {
    const secs = Math.max(0, Math.ceil(((shown.until_ts ?? 0) - (now + (socket?.offsetMs ?? 0))) / 1000))
    return <div className="mk-banner pair"><span className="mk-tag">Pair</span><span><b>{shown.text ?? 'Bump phones now'}</b></span><span className="mk-count">{secs}s</span></div>
  }
  const text = shown.ok ? (typeof shown.amount === 'number' ? `${shown.a} passed ${shown.amount} chips to ${shown.b}` : shown.seat_id ? `${shown.b} takes seat ${shown.seat_id}` : `${shown.a} and ${shown.b} paired`) : `No pairing: ${shown.reason ?? 'no bump'}`
  return <div className={`mk-banner pair ${shown.ok ? 'done' : 'fail'}`}><span className="mk-tag">Pair</span><span>{text}</span></div>
}

/** Stack of the three market banners; sits under the phase banner. */
export function MarketBanners() {
  return <div className="mk-banners"><SponsorBanner /><CrateBanner /><PairingPrompt /></div>
}

/** Card vote over the plank menu when no match is live: two pairings, live tally, then the winner. */
export function CardVoteSplash() {
  const card = useArena((s) => s.card) as { pairings: PairingInfo[]; tally: Record<string, number>; closes_ts?: number; done?: boolean; winner?: PairingInfo } | null
  const socket = useArena((s) => s.socket)
  const [showDone, setShowDone] = useState(false)
  useEffect(() => {
    if (!card?.done) { setShowDone(false); return }
    setShowDone(true)
    const id = window.setTimeout(() => setShowDone(false), 6000)
    return () => window.clearTimeout(id)
  }, [card])
  const now = useNow(Boolean(card && !card.done), 250)
  if (!card) return null
  if (card.done) {
    if (!showDone || !card.winner) return null
    return <div className="card-splash"><div className="cs-kicker">Fight Night</div><div className="cs-title">{card.winner.label}</div><div className="cs-sub">The rail has spoken. Ring walk in a moment.</div></div>
  }
  const total = Object.values(card.tally ?? {}).reduce((a, b) => a + b, 0)
  const secs = Math.max(0, Math.ceil(((card.closes_ts ?? 0) - (now + (socket?.offsetMs ?? 0))) / 1000))
  return (
    <div className="card-splash">
      <div className="cs-kicker">Fight Night · the rail picks the card</div>
      <div className="cs-pairs">
        {card.pairings.map((p) => { const v = card.tally?.[p.id] ?? 0; return (
          <div key={p.id} className="cs-pair">
            <div className="cs-names"><span>{p.label.split(' vs ')[0]}</span><span className="cs-vs">vs</span><span>{p.label.split(' vs ')[1] ?? ''}</span></div>
            <div className="cs-bar"><div className="cs-fill" style={{ width: `${total ? Math.round((v / total) * 100) : 0}%` }} /></div>
            <div className="cs-votes">{v} vote{v === 1 ? '' : 's'}</div>
          </div>
        ) })}
      </div>
      <div className="cs-sub">Vote on your phone · closes in <b>{secs}s</b></div>
    </div>
  )
}
