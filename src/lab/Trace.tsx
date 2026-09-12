/**
 * A rolling strip chart of one scalar over the last few seconds, with the detector's trigger drawn
 * across it. The trigger line is the whole point: a swing that does not cross it produces nothing in
 * the game, and seeing that is the difference between "the controller is broken" and "swing harder".
 */
const W = 520, H = 132, PAD = 6

export function Trace({ values, threshold, ceiling, color }: {
  values: number[]
  threshold: number
  ceiling: number
  color: string
}): React.ReactElement {
  // The scale always contains the trigger and the full-power mark, so the lines never leave the box,
  // and it grows past them when a swing overshoots rather than clipping the peak.
  const top = Math.max(ceiling, threshold * 1.4, ...values, 1)
  const y = (value: number): number => H - PAD - (value / top) * (H - PAD * 2)
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0
  const points = values.map((value, i) => `${PAD + i * step},${y(value)}`).join(' ')
  const area = values.length > 1 ? `${PAD},${H - PAD} ${points} ${PAD + (values.length - 1) * step},${H - PAD}` : ''

  return <svg className="trace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
    aria-label={`trace, trigger at ${threshold}`}>
    <rect x="0" y="0" width={W} height={H} rx="8" fill="rgba(255,255,255,0.03)" />
    {area && <polygon points={area} fill={color} fillOpacity="0.14" />}
    {values.length > 1 && <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />}
    <line x1={PAD} x2={W - PAD} y1={y(threshold)} y2={y(threshold)} stroke="#ffb347" strokeWidth="1.5" strokeDasharray="6 5" />
    <line x1={PAD} x2={W - PAD} y1={y(ceiling)} y2={y(ceiling)} stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="2 6" />
  </svg>
}
