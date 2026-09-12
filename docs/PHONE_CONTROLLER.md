# Phone Wii Remote

Current match update: Godot automatically selects the sport; no phone selector.
Boxing learns forward from the first deliberate punch after calibration, scores
only the forward peak, and suppresses recoil (including return braking). Keep
the same grip; recalibrate if you change it. A toggles block, B boosts.
For golf/bowling, A locks aim and starts the motion countdown. B cancels an
active countdown or toggles aim mode while idle. D-pad left/right adjusts aim,
up/down selects club/hook in aim mode; otherwise it moves. Godot handles turns.
These mappings supersede the historical control descriptions below.

The `/controller` page turns up to two iPhones into low-latency motion
controllers for the Godot first-person golf range. Gesture detection and
calibrated tilt processing run on the phone. Compact stick and gesture events
are sent immediately to Godot.

## Start the complete test setup

Both phones and the Mac must be on the same Wi-Fi network.

1. Start the Godot receiver:

   ```bash
   godot --path godot
   ```

   Allow incoming connections if macOS asks. The golf range listens on local
   port `9080`; arrow keys can test first-person aim without a phone.

2. Start the controller website:

   ```bash
   cd web
   npm install
   npm run dev -- --host
   ```

   Vite serves the page on port `5173` and proxies `/controller-ws` to Godot.

3. Give the phones an HTTPS URL. iPhone Safari requires a secure context for
   motion sensors:

   ```bash
   npx wrangler tunnel quick-start http://localhost:5173
   ```

4. Open these URLs in Safari using the HTTPS hostname printed by Wrangler:

   ```text
   https://YOUR-TUNNEL/controller?player=1
   https://YOUR-TUNNEL/controller?player=2
   ```

5. On each phone:
   - Select its player and sport.
   - Tap **Enable Motion** and grant the iOS permission.
   - Tap **Connect**. The matching Godot card should show connected.
   - Hold the phone in a comfortable neutral aiming pose, tap **Calibrate**,
     and keep it still for about 1.2 seconds.
   - Tilt from that neutral pose to aim the first-person camera. A deadzone and
     smoothing suppress hand jitter.
   - For golf or bowling, tap **Start Motion**, wait through the three-second
     countdown, then move during the two-second `GO` window. The best complete
     motion is sent once and shown as the attempt score.
   - Boxing stays continuous in Mixed 3D mode so combinations work. Each
     completed punch in any outward direction produces one score.

Do not open the controller in an iframe or an in-app browser. If motion access
was previously denied, enable **Settings → Safari → Motion & Orientation
Access**, reload the page, and tap the button again.

## Extra controller buttons

iPhone Safari does not expose presses of the physical volume buttons to web
pages. The controller therefore provides two large on-screen equivalents:

- Boxing `VOL +`: hold to emit `block_start`; release to emit `block_end`.
- Boxing `VOL −`: emit one `emergency_power` action.
- Golf and bowling: reserved placeholders for later game-specific actions.

These actions are sequenced and sent over the controller WebSocket separately
from motion scores. Godot exposes `controller_action`, `block_changed`, and
`emergency_power` signals for gameplay scripts.

## Test without phones

With Godot and Vite running, open two desktop tabs:

```text
http://localhost:5173/controller?player=1&fake=1
http://localhost:5173/controller?player=2&fake=1
```

On each tab, enable motion, connect, calibrate during the quiet lead-in, select
the desired sport, and use the synthetic Jab, Hook, or Swing buttons. For golf
and bowling, trigger Swing during the `GO` capture window. This
exercises the same detector, WebSocket, controller-ID, and Godot signal path.

## Data and latency

Each browser sensor event is processed immediately. Calibrated screen-relative
tilt is sent as a `stick: [x, y]` vector in `[-1, 1]` at up to 30 Hz. This aim
channel is independent of the optional raw telemetry switch. The receiver
discards stale stick state after 250 ms so interrupted streams cannot leave the
camera drifting.

The visible telemetry UI
refreshes at 10 Hz independently of sensor processing.

Confirmed gestures are sent once as small JSON messages containing:

- `controllerId`, monotonically increasing `seq`, and unique `eventId`
- `punch`, `golf_swing`, or `bowling_swing`
- gameplay power from 0–100
- normalized direction
- peak acceleration, peak rotation, and duration

Raw filtered telemetry remains available but is hidden from the normal
score-first interface. Add `&debug=1` to the controller URL to show the
acceleration, rotation, sensor frequency, detector state, RTT, and a **Debug
telemetry** switch that sends motion at up to 30 Hz. Gestures are never
buffered for replay after a reconnect.

Device axes are rotated into the current screen orientation before detection.
The phone offers Up/Down, Left/Right, Swing, and Mixed 3D direction profiles.
Boxing defaults to Mixed 3D; golf and bowling default to Swing. The detector
locks onto the initial outward direction and excludes the opposite return
stroke from peak acceleration, peak rotation, and power.

## Tuning

All browser-side thresholds and weights are in
`web/src/controller/config.ts`. Tune these values with real phones:

- EMA filtering strength
- calibration duration and noise limits
- punch acceleration, release, duration, cooldown, and power range
- golf rotation arm threshold, duration, cooldown, and power weights
- bowling rotation/acceleration thresholds, duration, and power weights
- the nonlinear power-curve exponent (normal strong motions should land around
  75–85; reaching 100 requires both acceleration and rotation near their caps)

Synthetic tests establish deterministic behavior, but they cannot establish
whether a physical gesture feels right. Record soft, medium, and hard gestures
from both phones before locking the values for a demo.

## Troubleshooting

- **The page loads but motion stays off:** use the HTTPS tunnel URL in Safari
  and tap Enable Motion; a plain LAN `http://` URL is not sufficient on iOS.
- **Connect keeps retrying:** start Godot first and confirm its diagnostic
  header says port 9080 is online.
- **Controller already in use:** close or disconnect the other tab/phone that
  claimed that player, then retry.
- **No Godot reaction:** complete calibration, match the selected sport to the
  motion being tested, and confirm the phone flash says the event was sent.
- **High RTT:** keep all devices on the same Wi-Fi, disable VPNs, and avoid
  congested guest networks. The tunnel secures the page and forwards the
  WebSocket to the Mac; measure the displayed RTT on the actual demo network.
