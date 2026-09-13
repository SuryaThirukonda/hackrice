/**
 * Button faces, drawn rather than written.
 *
 * A gamepad button with a text label is a selectable text node: on a phone, holding it down to block
 * or to steer pops the selection handles and the magnifier, and the "button" turns into highlighted
 * text mid-fight. These are paths and polygons only, with no `<text>` element anywhere, so there is
 * nothing to select. Meaning is carried by the `aria-label` on the button itself.
 *
 * Every glyph is `pointer-events: none` so a press always lands on the button, never on the artwork,
 * which matters for the D-pad's pointer capture.
 */
const SVG = (props: { children: React.ReactNode; size?: number }): React.ReactElement => (
  <svg viewBox="0 0 24 24" width={props.size ?? 22} height={props.size ?? 22} aria-hidden="true" focusable="false"
    style={{ pointerEvents: 'none', display: 'block' }} fill="none" stroke="currentColor" strokeWidth={2.4}
    strokeLinecap="round" strokeLinejoin="round">{props.children}</svg>
)

const TURN: Record<string, number> = { Up: 0, Right: 90, Down: 180, Left: 270 }

/** D-pad direction: a solid triangle, rotated per direction so one shape serves all four. */
export const Arrow = ({ dir }: { dir: 'Up' | 'Down' | 'Left' | 'Right' }): React.ReactElement => (
  <SVG size={20}>
    <polygon points="12,6 18.5,17 5.5,17" fill="currentColor" stroke="none" transform={`rotate(${TURN[dir]} 12 12)`} />
  </SVG>
)

/** The dead centre of the D-pad: decoration, not a control. */
export const Pip = (): React.ReactElement => (
  <SVG size={14}><rect x="8" y="8" width="8" height="8" rx="1.5" transform="rotate(45 12 12)" fill="currentColor" stroke="none" /></SVG>
)

/** A: guard up. */
export const Shield = (): React.ReactElement => (
  <SVG size={26}><path d="M12 3.2 19 6v5.6c0 4.3-2.9 7.6-7 9.2-4.1-1.6-7-4.9-7-9.2V6z" fill="currentColor" fillOpacity={0.25} /></SVG>
)

/** A, outside boxing: begin the capture window. */
export const Play = (): React.ReactElement => (
  <SVG size={26}><polygon points="9,6 19,12 9,18" fill="currentColor" stroke="none" /></SVG>
)

/** B: duck under the punch. */
export const Duck = (): React.ReactElement => (
  <SVG size={26}><path d="M5 8.5 12 15l7-6.5" /><path d="M5 15.5 12 22l7-6.5" opacity={0.45} /></SVG>
)

/** B, outside boxing: cancel. */
export const Cancel = (): React.ReactElement => (
  <SVG size={24}><path d="M6.5 6.5 17.5 17.5" /><path d="M17.5 6.5 6.5 17.5" /></SVG>
)

/** START: the usual power mark. */
export const Power = (): React.ReactElement => (
  <SVG size={20}><path d="M12 3.5v7.5" /><path d="M17.5 6.4a7.5 7.5 0 1 1-11 0" /></SVG>
)

/** START while the phone is asking for permission or calibrating. */
export const Busy = (): React.ReactElement => (
  <SVG size={20}>
    <circle cx="5" cy="12" r="1.9" fill="currentColor" stroke="none" opacity={0.35} />
    <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" opacity={0.7} />
    <circle cx="19" cy="12" r="1.9" fill="currentColor" stroke="none" />
  </SVG>
)

/** A, stop oscillation: square symbol */
export const Stop = (): React.ReactElement => (
  <SVG size={22}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></SVG>
)

/** B, arm & start countdown timer */
export const Timer = (): React.ReactElement => (
  <SVG size={24}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2" />
    <path d="M10 2h4" />
  </SVG>
)

