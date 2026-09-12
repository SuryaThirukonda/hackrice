import { GAMES, type GameDef } from './games'

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
