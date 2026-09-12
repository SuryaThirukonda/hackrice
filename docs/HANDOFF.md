# Handoff — Phone Wii Controller → 3D First-Person Game

Last updated: Sep 12, 2026

## Current playable matches (supersedes older slice notes below)

Main scene now uses `scripts/match_scene.gd`. World art remains in `sports.gd`.
Independent fixed-step rules are in `boxing_match.gd`, `golf_match.gd`, and
`bowling_match.gd`. The other branch and Python arena were not modified.

- Boxing: 3 x 90s rounds, health/stamina, reach, step-in bonus, 15% guarded
  damage, guard breaks, knockdowns/counts, KO and decision. Guard changes
  are reflected back to the phone (including exhaustion).
- Golf: three holes, putter/wedge/iron, flight/bounce/roll, water/OOB penalties,
  sand friction, cup capture, persistent lies, stroke cards, 10-stroke hole cap.
- Bowling: ten frames and bonus balls, strike/spare scoring, gutters, hook,
  sweeping aim lock, deterministic disc/pin collisions and rack resets.
- Golf/bowling now have automatic turns and playable local deterministic AI.
  A locks aim and starts motion capture. B cancels capture when active, otherwise
  toggles aim mode: D-pad left/right aims; up/down changes club or hook.
- Godot: Q/E aim, C club/hook, Z/X hook, Tab top view, Space test shot, Esc pause,
  R new match, B/G/N sport selection. Phone sport remains controlled by Godot.
- Punch correction: first deliberate forward punch after calibration teaches
  opponent-positive direction. Negative motion cannot re-arm; 100ms neutral
  after retraction suppresses the forward braking pulse. Recalibrate when
  changing grip. Golf/bowling sensor scoring remains unchanged.

Tests: `godot/tests/match_rules.tscn` (rules/course completion),
`godot/tests/controller_ui.tscn` (two WebSocket clients), and
`godot/tests/render_matches.tscn` (game viewport captures under `/tmp`).
Run with `HAP_CONTROLLER_PORT=19089 godot --headless --path godot res://tests/match_rules.tscn`.
Rendering test requires normal, non-headless Godot. This is an arcade adaptation,
not a port of the supplied betting/agent service or exact combat/dodge system.

## Goal (where we’re headed)

Build a **3D first-person** game that feels **Wii-like**:

- **Power** comes from real phone swings / punches (how hard you move).
- **Movement** uses the labeled touchscreen D-pad. Phone tilt no longer
  rotates the camera; motion continues to supply swing / punch power.
- Up to **two phones** as Player 1 / Player 2.
- Godot owns the 3D world; phones own motion sensing and gesture scoring.

This handoff is the bridge between the working **phone → Godot** vertical
slice and that first-person game.

## Latest controller revision

- Raised colorful gamepad UI: enlarged D-pad left, A/B only on the right;
  no center start button. Godot broadcasts its sport on changes and hello
  acknowledgements; phone sport selectors are removed.
- Boxing: A toggles block; B arms the one-use 10% power boost.
  Camera-mounted guard arms rise on both sides while blocking. Camera
  feedback is translation-only (steps and hits), preserving forward aim.
- Golf/bowling: A starts the existing motion countdown; B cancels it.
- Godot mode button switches Human vs AI / Human vs Human. Both join QR
  codes are available on the landing page. Boxing supports simultaneous
  humans on one shared first-person screen. Golf/bowling switch controller
  on Reset course after the shot result. AI golf/bowling remain placeholders.
- Motion scoring logic is preserved. Godot F3 diagnostics remain available.
- D-pad reads fresh receiver state directly and remains usable after shots.
  Regression test: `HAP_CONTROLLER_PORT=19089 godot --headless --path godot
  res://tests/controller_ui.tscn` checks real two-client WebSocket sport sync,
  four-way movement, release, fixed heading, and guard toggles.
- Local join-config.json supplies the current HTTPS quick-tunnel origin;
  quick tunnels are temporary and require the local services to stay running.

---

## What’s already done

### Architecture

| Layer | Role |
| --- | --- |
| `web/` controller (`/controller?player=1\|2`) | Safari DeviceMotion, local filtering, gesture detection, score UI |
| Vite proxy `/controller-ws` → `localhost:9080` | Same-origin WSS for phones over HTTPS tunnel |
| `godot/` `ControllerManager` autoload | TCP/WebSocket server, max 2 controllers, sequenced packets |
| Godot first-person range | Phone aim, physics golf shots, P1/P2 ball colors |

### First-person bridge completed (Sep 12, 2026)

- Godot now opens into a procedural 3D golf range with a first-person camera,
  targets, collision, HUD, and physics-driven golf balls.
- Phone orientation is calibrated into a screen-relative `stick: [x, y]`
  packet with deadzone, smoothing, clamping, and a 30 Hz send cap.
- Godot maps stick input to yaw/pitch and expires stale input after 250 ms.
- `golf_swing.power` controls launch impulse; P1/P2 shots have distinct colors.
- Arrow keys are the desktop/fake-stick fallback.

Original HackRice Python/React arena (“The House Always Plays”) is largely
untouched; this stack is a parallel phone → Godot path.

### Controller (phone)

- Sports: **golf**, **boxing**, **bowling**
- Golf / bowling: one-shot **Start Motion → 3s countdown → 2s capture → one score**
- Boxing: continuous Mixed 3D punches
- Power from motion (harder curve; strong swings land ~75–85); reverse stroke
  excluded from power
- Direction labels (`left/right/up/down/front/back`) reported **after** score,
  separate from power math
- P1 / P2 share the same detector config (parity)
- On-screen **Block** (toggle) and **Emergency Power (+10% next punch)** for
  boxing (Safari cannot read hardware volume buttons)
- Debug telemetry only with `&debug=1`; synthetic motion with `&fake=1`
- Docs: `docs/PHONE_CONTROLLER.md`, `docs/CONTROLLER_LATEST_CHANGES.md`,
  `docs/CONTROLLER_ACTION_BUTTONS.md`

### Godot receiver

- Port **9080**, IDs `controller_1` / `controller_2`
- Packet types: `hello`, `motion`, `gesture`, `ping`, `action`
- Signals for punch / golf / bowling gestures, block, emergency power
- Duplicate / stale `seq` + `eventId` rejection
- Boosted gestures can carry `emergencyBoostApplied: true` with final power

### How to run the current slice

```bash
godot --path godot
cd web && npm run dev -- --host
npx wrangler tunnel quick-start http://localhost:5173
```

Open on phones:

```text
https://YOUR-TUNNEL/controller?player=1
https://YOUR-TUNNEL/controller?player=2
```

---

## Plan for the future

### 1. 3D first-person game in Godot — first slice complete

- Replace / grow past the diagnostic cards into a real **FPS-style** (or
  first-person sports) scene: camera in the player’s head, world in 3D.
- Map existing gesture `power` into shot / punch / throw **strength**.
- Keep detection on the phone; Godot consumes compact events so latency stays
  low.

### 2. Wii-style power (keep / refine)

- Continue using phone swings as the power meter.
- Tune per sport (golf club, punch, bowl) once the 3D feel is in place.
- Emergency Power and Block become in-world verbs (block animation, power-up
  VFX), not just UI + signals.

### 3. Phone as “L-stick” for aim / cursor — implemented for camera look

**Intent:** use the phone like a left stick — continuous 2D input that moves
aim or an on-screen cursor, not only discrete direction labels after a swing.

**Approach to try:**

1. Stream a low-rate **stick vector** from the phone (e.g. device orientation
   or filtered tilt relative to a calibrated neutral pose).
2. New packet type or motion field, e.g. `stick: [x, y]` in `[-1, 1]`, sent
   every frame or at ~30–60 Hz while “aim mode” is active.
3. In Godot, apply that vector to:
   - first-person **look** (yaw/pitch), and/or
   - a **world cursor / reticle** (Wii-pointer-like), depending on the sport.
4. Calibrate “phone flat / held ready” as stick center; deadzone + smoothing
   so aim doesn’t jitter.
5. Keep **swing gestures** for commit + power; stick only for aiming until
   the player swings.

**Fallback if full stick feel is hard on Safari:**

- Touch virtual stick on the controller UI for aim, motion only for power; or
- Gyro for look, accelerometer peak still for power.

### 4. Suggested build order

1. ~~Minimal first-person Godot scene + camera that reacts to a fake stick.~~
2. ~~Phone: calibrate + publish continuous `stick` (or tilt) over WS.~~
3. ~~Wire stick → camera / reticle; wire existing `gesture.power` → shot strength.~~
4. ~~One sport end-to-end (golf) in 3D.~~
5. Next: formal turn-taking/scoring for P1/P2, then bowling/boxing scenes and
   shared arena polish.
6. ~~Connect OpenAI-generated lines + ElevenLabs TTS to Godot game events.~~

The commentary bridge calls `POST /api/commentary`. With both API keys it
generates and voices fresh play-by-play; with ElevenLabs only it voices the
offline fallback lines; without keys it still displays fallback subtitles.

### 5. Open questions

- Aim: head look vs. on-screen pointer vs. both?
- Stick source: orientation quaternion, gravity-tilt only, or touch stick?
- Same Wi-Fi LAN only, or always tunnel/proxy for demos?
- Keep web controller forever, or later native app for better sensors?

---

## Key paths

```text
hackrice/web/src/controller/     # phone UI + detectors + WS client
hackrice/godot/scripts/          # ControllerManager + diagnostic main
hackrice/godot/scenes/main.tscn
hackrice/docs/PHONE_CONTROLLER.md
hackrice/docs/CONTROLLER_ACTION_BUTTONS.md
hackrice/godot/README.md
```

## Don’t break

- Sequenced gestures / actions and duplicate rejection
- Same-origin WS proxy for HTTPS phones
- P1/P2 detector parity
- Power math independent of direction labels (until stick aim is intentional)

---

## One-line summary

**Today:** phones score Wii-style swings into Godot over WebSockets.  
**Next:** a 3D first-person game where swings set power and the phone acts as
an L-stick / cursor for aim.
