import { GAMES, type GameDef } from './games'
import './planks.css'

export function ChannelGrid({ onPick, compact = false }: { onPick?: (g: GameDef) => void; compact?: boolean }) {
  return (
    <div className="channel-grid" style={compact ? { gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 } : undefined}>
      {GAMES.map((g) => (
        <div key={g.id} className={`tile channel ${onPick ? 'selectable' : ''} ${g.ready ? '' : 'disabled'}`} role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined}
          onClick={() => g.ready && onPick?.(g)} onKeyDown={(e) => { if (e.key === 'Enter' && g.ready) onPick?.(g) }} style={compact ? { minHeight: 120, padding: 12 } : undefined}>
          <div className="art" style={{ background: g.color, width: compact ? 56 : 96, height: compact ? 56 : 96, fontSize: compact ? 28 : 46 }}>{g.art}</div>
          <div className="name" style={compact ? { fontSize: 18 } : undefined}>{g.name}</div>
          {!compact && <div className="sub">{g.sub}</div>}
        </div>
      ))}
    </div>
  )
}

/** The dashboard menu: a wooden sign with one plank per minigame on a jungle ground. */
export function PlankMenu({ onPick, title = 'Pick a game' }: { onPick?: (g: GameDef) => void; title?: string }) {
  return (
    <div className="jungle">
      <div className="vine tl" /><div className="vine br" />
      <div className="leaf" style={{ top: 30, left: 60, transform: 'rotate(-30deg)' }} /><div className="leaf" style={{ top: 70, right: 50, transform: 'rotate(200deg)' }} />
      <div className="leaf" style={{ bottom: 40, left: 120, transform: 'rotate(20deg)' }} /><div className="leaf" style={{ bottom: 60, right: 140, transform: 'rotate(150deg)' }} />
      <div className="sign">
        <div className="sign-title">{title}</div>
        {GAMES.map((g) => (
          <button key={g.id} className={`plank ${g.ready ? '' : 'disabled'}`} onClick={() => g.ready && onPick?.(g)} disabled={!g.ready}>
            <span className="art">{g.art}</span>
            <span className="name">{g.name}</span>
            <span />
            <span className="sub">{g.sub}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
