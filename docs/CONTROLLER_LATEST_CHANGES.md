# Phone Controller — Latest Changes

## Current controls

The normal phone interface is score-first. Acceleration, rotation, detector
state, sensor frequency, and RTT remain implemented but are visible only when
`&debug=1` is added to the controller URL.

### Golf and bowling

- Tap **Start Motion**.
- Wait through the three-second countdown.
- Perform one motion during the two-second `GO` window.
- The best complete motion is sent once and displayed as the score.
- Swing is the default direction profile; Up/Down, Left/Right, and Mixed 3D
  remain selectable.

### Boxing

- Boxing uses continuous Mixed 3D punch detection.
- **Block** is a simple toggle button. Tap once to start blocking and tap again
  to stop.
- **Emergency Power (+10%)** arms a one-use boost. The next detected punch score
  is multiplied by `1.10`, rounded, capped at `100`, and then the boost clears.
- Golf and bowling show reserved placeholders for these two extra controls.

Physical iPhone volume buttons are not used because Safari does not expose
their presses to JavaScript. See `CONTROLLER_ACTION_BUTTONS.md` for the
button rewrite notes.

## Direction tracking

Every completed motion reports a normalized vector, dominant axis, and one of
six labels: left, right, up, down, front, or back. Direction reporting is kept
separate from the score calculation. The existing positive-stroke rule still
prevents the return stroke from increasing power.

## Player parity

Player 1 and Player 2 both instantiate the same `MotionProcessor` and use the
same configuration in `web/src/controller/config.ts`. Controller identity only
changes the WebSocket ID and Godot player slot; it cannot change sensitivity or
score mechanics.

## Godot actions

The phone sends sequenced `action` packets for:

- `block_start`
- `block_end`
- `emergency_power`

Godot exposes:

- `controller_action(controller_id, action, payload)`
- `block_changed(controller_id, blocking)`
- `emergency_power(controller_id)`

Boosted gesture packets include `emergencyBoostApplied: true`, while their
`power` field already contains the final 10% boost.

## Test URLs

```text
https://YOUR-TUNNEL/controller?player=1
https://YOUR-TUNNEL/controller?player=2
```

Add `&fake=1` for desktop synthetic controls and `&debug=1` for technical
telemetry.
