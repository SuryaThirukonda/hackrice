# Handoff — Phone Wii Controller → 3D First-Person Game

Last updated: Sep 12, 2026

## Goal (where we’re headed)

Build a **3D first-person** game that feels **Wii-like**:

- **Power** comes from real phone swings / punches (how hard you move).
- **Aim / look** uses the phone like a controller **left stick** — tilt or
  nudge the phone to move a cursor / camera, similar to pointing or nudging
  aim on a Wii remote + stick hybrid.
- Up to **two phones** as Player 1 / Player 2.
- Godot owns the 3D world; phones own motion sensing and gesture scoring.

This handoff is the bridge between the working **phone → Godot** vertical
slice and that first-person game.

---

## What’s already done

### Architecture

| Layer | Role |
| --- | --- |
| `web/` controller (`/controller?player=1\|2`) | Safari DeviceMotion, local filtering, gesture detection, score UI |
| Vite proxy `/controller-ws` → `localhost:9080` | Same-origin WSS for phones over HTTPS tunnel |
| `godot/` `ControllerManager` autoload | TCP/WebSocket server, max 2 controllers, sequenced packets |
| Godot diagnostic scene | Shows connection, gestures, block, emergency power |

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

### 1. 3D first-person game in Godot

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

### 3. Phone as “L-stick” for aim / cursor (next big control piece)

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

1. Minimal first-person Godot scene + camera that reacts to a fake stick.
2. Phone: calibrate + publish continuous `stick` (or tilt) over WS.
3. Wire stick → camera / reticle; wire existing `gesture.power` → shot strength.
4. One sport end-to-end (golf or boxing) in 3D.
5. Second player, polish, then bowling / shared arena polish.

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
